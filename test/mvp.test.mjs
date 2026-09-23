import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  MVP_TOOL_NAMES,
  registerMvpTools,
  buildNoteListQuery,
  buildEyecatchFormData,
  draftNoteKey,
  eyecatchMimeType,
  assertEyecatchContents,
  assertEyecatchDimensions,
  isDraftNote,
  noteKeyFromPayload,
  noteKeyFromCreateResponse,
  buildNoteDetailEndpoint,
  noteKeyForId,
  assertEyecatchSize,
} from "../build/tools/mvp-tools.js";
import { env } from "../build/config/environment.js";
import {
  extractNotePayload,
  normalizeNoteListResponse,
  noteBelongsToUser,
  noteOwnership,
} from "../build/utils/note-normalizers.js";
import { convertMarkdownToNoteHtml, looksLikeHtml } from "../build/utils/markdown-converter.js";
import { createErrorResponse, handleApiError } from "../build/utils/error-handler.js";
import { formatNote } from "../build/utils/formatters.js";
import { noteApiRequest } from "../build/utils/api-client.js";
import {
  hasConfiguredUserOwnership,
  hasUnpublishedDraft,
  hasLiveSmokeAuthentication,
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

function registerHandlers(request) {
  const handlers = new Map();
  registerMvpTools(
    {
      tool(name, _description, _schema, handler) {
        handlers.set(name, handler);
      },
    },
    request
  );
  return handlers;
}

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentInstructions = readFileSync(join(repositoryRoot, "AGENTS.md"), "utf8");
const readme = readFileSync(join(repositoryRoot, "README.md"), "utf8");
const readmeJa = readFileSync(join(repositoryRoot, "README.ja.md"), "utf8");
const spec = readFileSync(join(repositoryRoot, "SPEC.md"), "utf8");
const workflowSkill = readFileSync(
  join(repositoryRoot, "skills/note-management-workflow/SKILL.md"),
  "utf8"
);

function pngHeader(width, height) {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function jpegHeader(width, height) {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08, 0x00, 0x00, 0x00, 0x00]);
  header.writeUInt16BE(height, 7);
  header.writeUInt16BE(width, 9);
  return header;
}

function gifHeader(width, height) {
  const header = Buffer.alloc(10);
  header.write("GIF89a", 0, "ascii");
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  return header;
}

function webpHeader(kind, width, height) {
  const header = Buffer.alloc(kind === "VP8 " ? 30 : kind === "VP8L" ? 25 : 30);
  header.write("RIFF", 0, "ascii");
  header.write("WEBP", 8, "ascii");
  header.write(kind, 12, "ascii");
  if (kind === "VP8 ") {
    header.set([0x9d, 0x01, 0x2a], 23);
    header.writeUInt16LE(width, 26);
    header.writeUInt16LE(height, 28);
  } else if (kind === "VP8L") {
    const encodedWidth = width - 1;
    const encodedHeight = height - 1;
    header[20] = 0x2f;
    header[21] = encodedWidth & 0xff;
    header[22] = ((encodedWidth >> 8) & 0x3f) | ((encodedHeight & 0x03) << 6);
    header[23] = (encodedHeight >> 2) & 0xff;
    header[24] = (encodedHeight >> 10) & 0x0f;
  } else {
    header.writeUIntLE(width - 1, 24, 3);
    header.writeUIntLE(height - 1, 27, 3);
  }
  return header;
}

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

test("project instructions match the six-tool MVP contract", () => {
  assert.match(agentInstructions, /six-tool MVP contract/i);
  assert.doesNotMatch(agentInstructions, /five-tool MVP contract/i);
  assert.match(agentInstructions, /draft-save path/i);
  assert.match(agentInstructions, /draft metadata path/i);
  assert.match(
    agentInstructions,
    /configured-user identity before authenticated list, read, create-draft, or edit-draft operations/i
  );
  assert.match(
    agentInstructions,
    /target-note ownership for `get-note`, `edit-note`, and `set-note-eyecatch`; fail closed when identity or ownership is unavailable, mismatched, or conflicting/i
  );
  assert.match(agentInstructions, /require an XSRF token for draft and eyecatch writes/i);
});

test("eyecatch documentation makes the draft-only boundary explicit", () => {
  assert.match(readmeJa, /`set-note-eyecatch`[^\n]*自分の下書き[^\n]*タイトル画像/);
  assert.match(readmeJa, /タイトル画像は、認証済みの自分の下書きに対して/);
  assert.match(readmeJa, /1280x670px/);
  assert.match(
    readme,
    /`set-note-eyecatch` \| Set a local image as the title image for my draft \| Update draft metadata \|/
  );
  assert.match(readme, /actual dimensions of 1280x670 pixels/);
  assert.match(spec, /\| `set-note-eyecatch` \| .*configured user's own draft.* \| Draft metadata update \|/i);
  assert.match(spec, /actual 1280x670 pixel dimensions/i);
  assert.match(
    workflowSkill,
    /5\.\s+If an eyecatch image is requested for the configured user's own draft,\s+use\s+`set-note-eyecatch` after the draft\s+exists\./i
  );
  assert.doesNotMatch(readmeJa, /タイトル画像は、認証済みの自分の記事に対して/);
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

test("API requests replace case-insensitive multipart headers and retain JSON defaults", async () => {
  const requests = [];
  const fetcher = async (_url, options) => {
    requests.push(options);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const form = buildEyecatchFormData("123", "cover.png", "image/png", Buffer.from("image"));

  await noteApiRequest(
    "/v1/image_upload/note_eyecatch",
    "POST",
    form,
    false,
    { origin: "https://editor.note.com", referer: "https://editor.note.com/" },
    fetcher
  );
  await noteApiRequest("/v1/text_notes/draft_save", "POST", { body: "<p>本文</p>" }, false, undefined, fetcher);

  const header = (headers, name) => {
    const matches = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
    assert.equal(matches.length, 1);
    return matches[0][1];
  };
  assert.equal(header(requests[0].headers, "origin"), "https://editor.note.com");
  assert.equal(header(requests[0].headers, "referer"), "https://editor.note.com/");
  assert.equal(header(requests[1].headers, "origin"), "https://note.com");
  assert.equal(header(requests[1].headers, "referer"), "https://note.com/");
  assert.equal(header(requests[1].headers, "content-type"), "application/json");
});

test("Eyecatch handler keeps ownership, draft, and XSRF guards before upload", async () => {
  const originalUserId = env.NOTE_USER_ID;
  const originalXsrfToken = env.NOTE_XSRF_TOKEN;
  const imagePath = join(repositoryRoot, "test-articles/images/test-image-1280x670.png");
  const uploadEndpoints = [];
  const fetchRequests = [];
  const fetcher = async (_url, options) => {
    fetchRequests.push(options);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  env.NOTE_USER_ID = "owner";
  env.NOTE_XSRF_TOKEN = "";

  const run = async ({ user = { id: "123", urlname: "owner" }, status = "draft", xsrf = null }) => {
    setActiveSessionCookie("session");
    if (xsrf) setActiveXsrfToken(xsrf);
    assertCurrentUserMatchesConfiguredUser({ data: { user: { id: "123", urlname: "owner" } } }, "owner");
    const request = async (endpoint, method, body, requireAuth, customHeaders) => {
      if (endpoint.startsWith("/v3/notes/")) {
        return { data: { note: { id: "123", key: "n123", status, user } } };
      }
      assert.equal(requireAuth, true);
      uploadEndpoints.push(endpoint);
      return noteApiRequest(endpoint, method, body, false, customHeaders, fetcher);
    };
    return registerHandlers(request).get("set-note-eyecatch")({ noteId: "n123", imagePath });
  };

  try {
    assert.equal((await run({ user: { id: "999", urlname: "other" }, xsrf: "xsrf" })).isError, true);
    assert.equal((await run({ status: "published", xsrf: "xsrf" })).isError, true);
    assert.equal((await run({ xsrf: null })).isError, true);
    const success = await run({ xsrf: "xsrf" });
    assert.equal(success.isError, undefined);
    assert.deepEqual(uploadEndpoints, ["/v1/image_upload/note_eyecatch"]);
    assert.equal(fetchRequests.length, 1);
    const header = (name) => {
      const matches = Object.entries(fetchRequests[0].headers).filter(
        ([key]) => key.toLowerCase() === name
      );
      assert.equal(matches.length, 1);
      return matches[0][1];
    };
    assert.equal(header("origin"), "https://editor.note.com");
    assert.equal(header("referer"), "https://editor.note.com/");
  } finally {
    env.NOTE_USER_ID = originalUserId;
    env.NOTE_XSRF_TOKEN = originalXsrfToken;
    setActiveSessionCookie("");
  }
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

test("Eyecatch validation requires the documented source dimensions", () => {
  const validImage = readFileSync(
    join(repositoryRoot, "test-articles/images/test-image-1280x670.png")
  );
  const mismatchedImage = readFileSync(join(repositoryRoot, "test-articles/images/test-image.png"));
  assert.doesNotThrow(() => assertEyecatchDimensions(validImage, "image/png"));
  assert.throws(() => assertEyecatchDimensions(mismatchedImage, "image/png"), /1280.*670/);

  const forgedPng = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(forgedPng);
  forgedPng.writeUInt32BE(1280, 16);
  forgedPng.writeUInt32BE(670, 20);
  assert.throws(() => assertEyecatchDimensions(forgedPng, "image/png"), /1280.*670/);

  for (const [mimeType, valid, mismatched] of [
    ["image/jpeg", jpegHeader(1280, 670), jpegHeader(1279, 670)],
    ["image/gif", gifHeader(1280, 670), gifHeader(1279, 670)],
    ["image/webp", webpHeader("VP8 ", 1280, 670), webpHeader("VP8 ", 1279, 670)],
    ["image/webp", webpHeader("VP8L", 1280, 670), webpHeader("VP8L", 1279, 670)],
    ["image/webp", webpHeader("VP8X", 1280, 670), webpHeader("VP8X", 1279, 670)],
  ]) {
    assert.doesNotThrow(() => assertEyecatchContents(valid, mimeType));
    assert.doesNotThrow(() => assertEyecatchDimensions(valid, mimeType));
    assert.throws(() => assertEyecatchDimensions(mismatched, mimeType), /1280.*670/);
  }
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
  for (const documentation of [readme, readmeJa, spec]) {
    assert.match(
      documentation,
      /(?:NOTE_USER_ID.*(?:認証情報|authentication source)|(?:認証対象|authenticated operations).*NOTE_USER_ID)/i
    );
    assert.match(documentation, /NOTE_ALL_COOKIES.*NOTE_XSRF_TOKEN/i);
    assert.match(documentation, /get-note.*(?:所有|ownership)/i);
    assert.match(documentation, /失敗|fails? closed/i);
  }
  assert.match(readmeJa, /セッション応答のXSRFトークン/);
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

test("Read-only live smoke accepts session authentication without XSRF", () => {
  assert.equal(hasLiveSmokeAuthentication({ NOTE_SESSION_V5: "session" }), true);
  assert.equal(hasLiveSmokeAuthentication({ NOTE_SESSION_V5: "session", NOTE_XSRF_TOKEN: "" }), true);
  assert.equal(hasLiveSmokeAuthentication({ NOTE_USER_ID: "owner" }), false);
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
  assert.equal(
    hasConfiguredUserOwnership({ author: { id: "owner", urlname: "other" } }, "owner"),
    false
  );
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

test("KaTeX display blocks keep delimiters and line breaks outside paragraphs", () => {
  const html = convertMarkdownToNoteHtml(`$$
\\begin{array}{lrr}
\\text{項目} & \\text{レンズA} & \\text{レンズB} \\\\
\\hline
\\text{質量} & 994\\,\\mathrm{g} & 995\\,\\mathrm{g}
\\end{array}
$$`);

  assert.equal(
    html,
    "$$<br>\\begin{array}{lrr}<br>\\text{項目} & \\text{レンズA} & \\text{レンズB} \\\\<br>\\hline<br>\\text{質量} & 994\\,\\mathrm{g} & 995\\,\\mathrm{g}<br>\\end{array}<br>$$"
  );

  const surroundedHtml = convertMarkdownToNoteHtml("intro\n$$\nx + y\n$$\nend");
  assert.match(surroundedHtml, /<p[^>]*>intro<\/p>\$\$<br>x \+ y<br>\$\$<p[^>]*>end<\/p>/);

  const placeholderLikeText = convertMarkdownToNoteHtml("__DISPLAY_MATH_0__");
  assert.match(placeholderLikeText, /<p[^>]*>__DISPLAY_MATH_0__<\/p>/);
});

test("Draft responses preserve note.com keys", () => {
  assert.equal(draftNoteKey("179921781", "n318f64f66b50"), "n318f64f66b50");
  assert.equal(draftNoteKey("123"), "n123");
  for (const alias of ["key", "note_key", "noteKey"]) {
    assert.equal(noteKeyFromPayload({ [alias]: "n318f64f66b50" }), "n318f64f66b50");
  }
});

test("Numeric note IDs resolve to keys from the authenticated list fixture", () => {
  const { notes } = normalizeNoteListResponse({
    data: {
      contents: [
        {
          type: "note",
          note: {
            id: 179921781,
            key: "n318f64f66b50",
            noteDraft: { name: "保存済み下書き" },
          },
        },
      ],
      total_count: 1,
    },
  });

  assert.equal(noteKeyForId(notes, "179921781"), "n318f64f66b50");
  assert.equal(noteKeyForId(notes, "404"), undefined);
});

test("Draft create responses and detail reads use the note key contract", () => {
  assert.equal(
    noteKeyFromCreateResponse({ data: { text_note: { id: 179921781, key: "n318f64f66b50" } } }),
    "n318f64f66b50"
  );
  assert.equal(
    buildNoteDetailEndpoint("n318f64f66b50", 123),
    "/v3/notes/n318f64f66b50?draft=true&draft_reedit=false&ts=123"
  );
  assert.match(buildNoteDetailEndpoint("n/key", 123), /%2F/);
});

test("get-note resolves a numeric ID before the detail request", async () => {
  const originalUserId = env.NOTE_USER_ID;
  env.NOTE_USER_ID = "owner";
  assertCurrentUserMatchesConfiguredUser(
    { data: { user: { id: "123", urlname: "owner" } } },
    "owner"
  );
  const requests = [];
  const request = async (endpoint, method) => {
    requests.push({ endpoint, method });
    if (endpoint.startsWith("/v2/note_list/contents")) {
      return {
        data: {
          contents: [
            { type: "note", note: { id: 179921781, key: "n318f64f66b50", user: { id: "123", urlname: "owner" } } },
          ],
          total_count: 1,
        },
      };
    }
    if (endpoint.startsWith("/v3/notes/n318f64f66b50")) {
      return { data: { note: { id: 179921781, key: "n318f64f66b50", name: "記事", user: { id: "123", urlname: "owner" } } } };
    }
    throw new Error(`unexpected endpoint: ${endpoint}`);
  };

  try {
    const response = await registerHandlers(request).get("get-note")({ noteId: "179921781" });
    assert.equal(response.isError, undefined);
    const result = JSON.parse(response.content[0].text);
    assert.equal(result.id, 179921781);
    assert.equal(result.editUrl, "https://editor.note.com/notes/n318f64f66b50/edit/");
    assert.equal(requests.filter(({ method }) => method === "GET").length, 2);
    assert.ok(requests.some(({ endpoint }) => endpoint.startsWith("/v3/notes/n318f64f66b50")));
    assert.ok(!requests.some(({ endpoint }) => endpoint.startsWith("/v3/notes/179921781")));
  } finally {
    env.NOTE_USER_ID = originalUserId;
    setActiveSessionCookie("");
  }
});

test("open-note-editor resolves numeric IDs to canonical editor URLs", async () => {
  const originalUserId = env.NOTE_USER_ID;
  env.NOTE_USER_ID = "owner";
  assertCurrentUserMatchesConfiguredUser(
    { data: { user: { id: "123", urlname: "owner" } } },
    "owner"
  );
  const requests = [];
  const request = async (endpoint, method) => {
    requests.push({ endpoint, method });
    assert.equal(method, "GET");
    return {
      data: {
        contents: [
          { type: "note", note: { id: 179921781, key: "n318f64f66b50", user: { id: "123", urlname: "owner" } } },
        ],
        total_count: 1,
      },
    };
  };

  try {
    const response = await registerHandlers(request).get("open-note-editor")({ noteId: "179921781" });
    assert.equal(response.isError, undefined);
    assert.equal(
      JSON.parse(response.content[0].text).editUrl,
      "https://editor.note.com/notes/n318f64f66b50/edit/"
    );
    assert.equal(requests.length, 1);
    assert.match(requests[0].endpoint, /^\/v2\/note_list\/contents\?/);
  } finally {
    env.NOTE_USER_ID = originalUserId;
    setActiveSessionCookie("");
  }
});

test("open-note-editor reports an actionable error for an unmapped numeric ID", async () => {
  const originalUserId = env.NOTE_USER_ID;
  env.NOTE_USER_ID = "owner";
  assertCurrentUserMatchesConfiguredUser(
    { data: { user: { id: "123", urlname: "owner" } } },
    "owner"
  );

  try {
    const response = await registerHandlers(async () => ({ data: { contents: [], total_count: 0 } }))
      .get("open-note-editor")({ noteId: "404" });
    assert.equal(response.isError, true);
    assert.match(response.content[0].text, /note key.*設定ユーザーの一覧/);
  } finally {
    env.NOTE_USER_ID = originalUserId;
    setActiveSessionCookie("");
  }
});

test("post-draft-note reads the created key from the draft list without retrying writes", async () => {
  const originalUserId = env.NOTE_USER_ID;
  env.NOTE_USER_ID = "owner";
  assertCurrentUserMatchesConfiguredUser(
    { data: { user: { id: "123", urlname: "owner" } } },
    "owner"
  );
  const requests = [];
  const request = async (endpoint, method, body) => {
    requests.push({ endpoint, method, body });
    if (endpoint.startsWith("/v2/creators/owner")) return { data: { id: "123" } };
    if (endpoint.startsWith("/v1/text_notes?")) return { data: { id: "179921781" } };
    if (endpoint.startsWith("/v1/text_notes/draft_save")) return {};
    if (endpoint.startsWith("/v2/note_list/contents")) {
      return {
        data: {
          notes: {
            contents: [
              { type: "note", note: { id: 179921781, key: "n318f64f66b50", user: { id: "123", urlname: "owner" } } },
            ],
            total_count: 1,
          },
        },
      };
    }
    throw new Error(`unexpected endpoint: ${endpoint}`);
  };

  try {
    const response = await registerHandlers(request).get("post-draft-note")({
      title: "保存テスト",
      body: "本文",
    });
    const result = JSON.parse(response.content[0].text);
    assert.equal(response.isError, undefined);
    assert.equal(result.noteId, "179921781");
    assert.equal(result.noteKey, "n318f64f66b50");
    assert.equal(requests.filter(({ method }) => method === "POST").length, 2);
    const draftSave = requests.find(({ endpoint }) => endpoint.startsWith("/v1/text_notes/draft_save"));
    assert.match(draftSave.body.body, /^<p name="[^"]+" id="[^"]+">本文<\/p>$/);
    assert.equal(draftSave.body.body.length, draftSave.body.body_length);
    assert.equal(draftSave.body.name, "保存テスト");
    assert.deepEqual(draftSave.body.tags, []);
    assert.equal(draftSave.body.index, false);
    assert.equal(draftSave.body.is_lead_form, false);
  } finally {
    env.NOTE_USER_ID = originalUserId;
    setActiveSessionCookie("");
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
