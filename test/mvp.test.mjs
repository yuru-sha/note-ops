import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  MVP_TOOL_NAMES,
  buildNoteListQuery,
  buildEyecatchFormData,
  draftNoteKey,
  eyecatchMimeType,
  assertEyecatchContents,
  isDraftNote,
  noteKeyFromPayload,
  assertEyecatchSize,
} from "../build/tools/mvp-tools.js";
import {
  extractNotePayload,
  normalizeNoteListResponse,
  noteBelongsToUser,
  noteOwnership,
} from "../build/utils/note-normalizers.js";
import { convertMarkdownToNoteHtml, looksLikeHtml } from "../build/utils/markdown-converter.js";
import { createErrorResponse, handleApiError } from "../build/utils/error-handler.js";
import { formatNote } from "../build/utils/formatters.js";
import {
  hasConfiguredUserOwnership,
  hasUnpublishedDraft,
  isLiveSmokeEnabled,
  isLiveDraftSmokeEnabled,
  isLiveEyecatchSmokeEnabled,
} from "../build/utils/live-smoke.js";
import {
  assertCurrentUserMatchesConfiguredUser,
  extractXsrfTokenFromSetCookie,
  getActiveXsrfToken,
  resolveXsrfToken,
  setActiveSessionCookie,
  setActiveXsrfToken,
} from "../build/utils/auth.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentInstructions = readFileSync(join(repositoryRoot, "AGENTS.md"), "utf8");
const readme = readFileSync(join(repositoryRoot, "README.md"), "utf8");
const spec = readFileSync(join(repositoryRoot, "SPEC.md"), "utf8");
const workflowSkill = readFileSync(
  join(repositoryRoot, "skills/note-management-workflow/SKILL.md"),
  "utf8"
);

test("MVP exposes only note management tools", () => {
  assert.deepEqual([...MVP_TOOL_NAMES], [
    "get-my-notes",
    "get-note",
    "post-draft-note",
    "edit-note",
    "set-note-eyecatch",
    "open-note-editor",
  ]);
});

test("Eyecatch uploads use the note API multipart contract", async () => {
  const form = buildEyecatchFormData("123", "cover.png", "image/png", Buffer.from("image"));
  assert.equal(form.get("note_id"), "123");
  assert.equal(form.get("width"), "1280");
  assert.equal(form.get("height"), "670");
  const file = form.get("file");
  assert.equal(file.name, "cover.png");
  assert.equal(file.type, "image/png");
  assert.equal(file.size, 5);
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [...Buffer.from("image")]);
});

test("Eyecatch validation accepts supported formats and rejects unsafe sizes", () => {
  assert.equal(eyecatchMimeType("cover.PNG"), "image/png");
  assert.equal(eyecatchMimeType("cover.webp"), "image/webp");
  assert.throws(() => eyecatchMimeType("cover.svg"), /PNG.*JPEG.*GIF.*WebP/);
  assert.doesNotThrow(() =>
    assertEyecatchContents(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x62]),
      "image/png"
    )
  );
  assert.throws(
    () => assertEyecatchContents(Buffer.from("not-an-image"), "image/png"),
    /内容が拡張子と一致/
  );
  assert.doesNotThrow(() => assertEyecatchSize(10 * 1024 * 1024));
  assert.throws(() => assertEyecatchSize(10 * 1024 * 1024 + 1), /10MB/);
  assert.equal(isDraftNote({ status: "draft" }), true);
  assert.equal(isDraftNote({ isDraft: true }), true);
  assert.equal(isDraftNote({ noteDraft: {} }), true);
  assert.equal(isDraftNote({ status: "published" }), false);
  assert.equal(isDraftNote({}), false);
});

test("note workflow skill documents the safe six-tool contract", () => {
  const allowedTools = [
    "get-my-notes",
    "get-note",
    "post-draft-note",
    "edit-note",
    "set-note-eyecatch",
    "open-note-editor",
  ];
  const toolSection = workflowSkill.match(
    /The only permitted note-management MCP tools are:\n\n((?:- `[^`]+`\n?)+)/
  )?.[1];
  assert.ok(toolSection);
  assert.deepEqual(
    [...toolSection.matchAll(/`([^`]+)`/g)].map(([, tool]) => tool),
    allowedTools
  );
  assert.match(workflowSkill, /explicit confirmation/i);
  assert.ok(
    workflowSkill.indexOf("explicit confirmation") < workflowSkill.indexOf("post-draft-note")
  );
  assert.match(workflowSkill, /MCP server remains the execution boundary/i);
  for (const boundary of ["publish", "comment", "like", "body images", "other users"]) {
    assert.match(workflowSkill, new RegExp(boundary, "i"));
  }
});

test("note workflow skill is discoverable from project instructions", () => {
  assert.match(agentInstructions, /skills\/note-management-workflow\/SKILL\.md/);
  assert.match(agentInstructions, /before using the MCP workflow/i);
});

test("documentation states authentication and ownership boundaries", () => {
  for (const documentation of [readme, spec]) {
    assert.match(
      documentation,
      /(?:NOTE_USER_ID.*(?:認証情報|authentication source)|(?:認証対象|authenticated operations).*NOTE_USER_ID)/i
    );
    assert.match(documentation, /NOTE_ALL_COOKIES.*NOTE_XSRF_TOKEN/i);
    assert.match(documentation, /get-note.*(?:所有|ownership)/i);
    assert.match(documentation, /失敗|fails? closed/i);
  }
  assert.match(readme, /セッション応答のXSRFトークン/);
  assert.match(readme, /NOTE_ALL_COOKIES.*live draft smoke.*NOTE_XSRF_TOKEN/i);
  assert.match(spec, /draft and eyecatch writes include an XSRF token.*when available/i);
});

test("Live smoke tests require both explicit opt-in flags", () => {
  assert.equal(isLiveSmokeEnabled({ NOTE_LIVE_TESTS: "true" }), true);
  assert.equal(isLiveSmokeEnabled({ NOTE_LIVE_TESTS: "1" }), false);
  assert.equal(
    isLiveDraftSmokeEnabled({ NOTE_LIVE_TESTS: "true", NOTE_LIVE_DRAFT_TESTS: "true" }),
    true
  );
  assert.equal(
    isLiveDraftSmokeEnabled({ NOTE_LIVE_TESTS: "true", NOTE_LIVE_DRAFT_TESTS: "false" }),
    false
  );
  assert.equal(
    isLiveEyecatchSmokeEnabled({
      NOTE_LIVE_TESTS: "true",
      NOTE_LIVE_DRAFT_TESTS: "true",
      NOTE_LIVE_EYECATCH_TESTS: "true",
    }),
    true
  );
  assert.equal(
    isLiveEyecatchSmokeEnabled({ NOTE_LIVE_TESTS: "true", NOTE_LIVE_EYECATCH_TESTS: "true" }),
    false
  );
});

test("Live draft verification requires the created note in the draft list", () => {
  assert.equal(
    hasUnpublishedDraft(
      [{ id: "123", isDraft: true }, { id: "456", isDraft: false }],
      "123"
    ),
    true
  );
  assert.equal(hasUnpublishedDraft([{ id: "123", isDraft: false }], "123"), false);
  assert.equal(hasUnpublishedDraft([{ id: "456", isDraft: true }], "123"), false);
});

test("Live article verification requires the configured user as author", () => {
  assert.equal(hasConfiguredUserOwnership({ author: { urlname: "owner" } }, "owner"), true);
  assert.equal(hasConfiguredUserOwnership({ author: { id: "123" } }, "123"), true);
  assert.equal(hasConfiguredUserOwnership({ author: { urlname: "other" } }, "owner"), false);
  assert.equal(hasConfiguredUserOwnership({}, "owner"), false);
});

test("Markdown is converted without double-wrapping HTML", () => {
  const html = convertMarkdownToNoteHtml("# Title\n\n- item");
  assert.match(html, /<h2[^>]*>Title<\/h2>/);
  assert.match(html, /<ul[^>]*><li[^>]*>item<\/li><\/ul>/);
  assert.equal(looksLikeHtml("<p>already converted</p>"), true);

  const richHtml = convertMarkdownToNoteHtml(
    "```ts\nconst x = 1 < 2;\n```\n\n[docs](https://example.com)"
  );
  assert.match(richHtml, /<pre[^>]*><code[^>]*>const x = 1 &lt; 2;<\/code><\/pre>/);
  assert.match(richHtml, /<a href="https:\/\/example\.com"[^>]*>docs<\/a>/);
});

test("Draft responses preserve note.com keys", () => {
  assert.equal(draftNoteKey("179921781", "n318f64f66b50"), "n318f64f66b50");
  assert.equal(draftNoteKey("123"), "n123");
  for (const alias of ["key", "note_key", "noteKey"]) {
    assert.equal(noteKeyFromPayload({ [alias]: "n318f64f66b50" }), "n318f64f66b50");
  }
});

test("Authentication secrets are redacted from errors and logs", () => {
  const secretMessage =
    'Cookie: _note_session_v5=session-secret; XSRF-TOKEN=xsrf-secret NOTE_EMAIL=owner@example.com NOTE_PASSWORD=password-secret';
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const response = handleApiError(new Error(secretMessage), "記事取得");
    assert.doesNotMatch(response.content[0].text, /session-secret|xsrf-secret|owner@example.com|password-secret/);
  } finally {
    console.error = originalError;
  }
  assert.doesNotMatch(logged.join("\n"), /session-secret|xsrf-secret|owner@example.com|password-secret/);
  assert.match(createErrorResponse(secretMessage).content[0].text, /REDACTED/);
});

test("Authenticated current-user identity must match the configured user", () => {
  assert.doesNotThrow(() =>
    assertCurrentUserMatchesConfiguredUser(
      { data: { user: { id: "123", urlname: "owner" } } },
      "owner"
    )
  );
  assert.throws(
    () =>
      assertCurrentUserMatchesConfiguredUser(
        { data: { user: { id: "456", urlname: "other" } } },
        "owner"
      ),
    /NOTE_USER_ID/
  );
  assert.throws(
    () => assertCurrentUserMatchesConfiguredUser({ data: {} }, "owner"),
    /current-user/
  );
  assert.throws(
    () =>
      assertCurrentUserMatchesConfiguredUser(
        { data: { id: "owner", user: { id: "456", urlname: "other" } } },
        "owner"
      ),
    /NOTE_USER_ID|複数あり一致を確認できません/
  );
  assert.throws(
    () =>
      assertCurrentUserMatchesConfiguredUser(
        {
          data: {
            user: { id: "123", urlname: "owner" },
            current_user: { id: "456", urlname: "owner" },
          },
        },
        "owner"
      ),
    /複数あり一致を確認できません/
  );
});

test("XSRF tokens are extracted from the named cookie", () => {
  assert.equal(
    extractXsrfTokenFromSetCookie(
      "_note_session_v5=session-secret; Path=/, XSRF-TOKEN=xsrf%2Dsecret; Path=/"
    ),
    "xsrf-secret"
  );
  assert.equal(extractXsrfTokenFromSetCookie("_note_session_v5=session-secret; Path=/"), null);
  assert.equal(
    resolveXsrfToken("existing-xsrf", null, "_note_session_v5=session-secret; Path=/"),
    "existing-xsrf"
  );
});

test("Changing the active session discards the previous XSRF token", () => {
  setActiveXsrfToken("old-xsrf");
  setActiveSessionCookie("_note_session_v5=new-session");
  assert.equal(getActiveXsrfToken(), null);
});

test("Note responses are normalized across authenticated API shapes", () => {
  const response = {
    data: {
      notes: {
        contents: [
          { type: "note", note: { id: 12, name: "記事", key: "n-key" } },
        ],
        total_count: 4,
      },
    },
  };

  assert.deepEqual(normalizeNoteListResponse(response), {
    notes: [{ id: 12, name: "記事", key: "n-key" }],
    total: 4,
  });
  assert.deepEqual(extractNotePayload({ data: { note: { id: 12 } } }), { id: 12 });
  assert.equal(noteBelongsToUser({ user: { urlname: "owner" } }, "owner"), true);
  assert.equal(noteBelongsToUser({ user: { urlname: "other" } }, "owner"), false);
  assert.equal(noteOwnership({ id: 12 }, "owner"), "unknown");
});

test("Note ownership rejects conflicting identity fields", () => {
  const verifiedUserIdentifiers = ["123", "owner"];
  assert.equal(
    noteOwnership(
      { user: { id: "123", urlname: "other" } },
      "123",
      verifiedUserIdentifiers
    ),
    false
  );
  assert.equal(
    noteOwnership(
      { user: { id: "123", urlname: "owner" } },
      "owner",
      verifiedUserIdentifiers
    ),
    true
  );
});

test("Draft fields and note-list queries match note.com response shapes", () => {
  const formatted = formatNote({
    id: "12",
    name: "Draft",
    body: "",
    user: { urlname: "owner" },
    note_draft: { body: "<p>draft body</p>", updated_at: "2026-09-12" },
  });

  assert.equal(formatted.body, "<p>draft body</p>");
  assert.equal(formatted.hasDraftContent, true);
  assert.equal(formatted.lastUpdated, "2026-09-12");

  const authorShaped = formatNote({ author: { id: "123", urlname: "owner" } });
  assert.equal(authorShaped.author.id, "123");
  assert.equal(authorShaped.author.urlname, "owner");

  assert.equal(buildNoteListQuery(2, 20, "all"), "limit=20&page=2");
  assert.equal(buildNoteListQuery(2, 20, "draft"), "limit=20&page=2&status=draft");
});
