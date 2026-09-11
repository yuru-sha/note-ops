import assert from "node:assert/strict";
import test from "node:test";
import { MVP_TOOL_NAMES } from "../build/tools/mvp-tools.js";
import { convertMarkdownToNoteHtml, looksLikeHtml } from "../build/utils/markdown-converter.js";

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
