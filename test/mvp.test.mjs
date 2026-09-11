import assert from "node:assert/strict";
import test from "node:test";
import { MVP_TOOL_NAMES } from "../build/tools/mvp-tools.js";
import { convertMarkdownToNoteHtml, looksLikeHtml } from "../build/utils/markdown-converter.js";
import { createErrorResponse, handleApiError } from "../build/utils/error-handler.js";

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
