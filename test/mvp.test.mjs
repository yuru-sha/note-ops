import assert from "node:assert/strict";
import test from "node:test";
import { MVP_TOOL_NAMES, buildNoteListQuery } from "../build/tools/mvp-tools.js";
import {
  extractNotePayload,
  normalizeNoteListResponse,
  noteBelongsToUser,
  noteOwnership,
} from "../build/utils/note-normalizers.js";
import { convertMarkdownToNoteHtml, looksLikeHtml } from "../build/utils/markdown-converter.js";
import { createErrorResponse, handleApiError } from "../build/utils/error-handler.js";
import { formatNote } from "../build/utils/formatters.js";

test("MVP exposes only note management tools", () => {
  assert.deepEqual([...MVP_TOOL_NAMES], [
    "get-my-notes",
    "get-note",
    "post-draft-note",
    "edit-note",
    "open-note-editor",
  ]);
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
  assert.equal(buildNoteListQuery(2, 20, "all"), "limit=20&page=2");
  assert.equal(buildNoteListQuery(2, 20, "draft"), "limit=20&page=2&status=draft");
});
