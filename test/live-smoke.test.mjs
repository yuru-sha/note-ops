import assert from "node:assert/strict";
import test from "node:test";
import { runLiveSmoke } from "./live-smoke.mjs";
import { formatNote } from "../build/utils/formatters.js";
import {
  assertCurrentUserMatchesConfiguredUser,
  resolveXsrfToken,
} from "../build/utils/auth.js";

const readEnvironment = {
  NOTE_LIVE_TESTS: "true",
  NOTE_USER_ID: "owner",
  NOTE_LIVE_NOTE_ID: "note-1",
  NOTE_SESSION_V5: "session-only",
};

test("live smoke allows session-only credentials through read checks", async () => {
  const calls = [];

  await runLiveSmoke({
    environment: readEnvironment,
    configuredUserId: "owner",
    getXsrfToken: () => null,
    invokeOperation: async (name, input) => {
      calls.push([name, input]);
      if (name === "get-my-notes") {
        assertCurrentUserMatchesConfiguredUser(
          { data: { user: { id: "123", urlname: "owner" } } },
          "owner"
        );
        return { notes: [] };
      }
      return { id: "note-1", author: { id: "123", urlname: "owner" } };
    },
  });

  assert.deepEqual(
    calls.map(([name]) => name),
    ["get-my-notes", "get-note"]
  );
});

test("live smoke verifies ownership from the formatted get-note response", async () => {
  const runWithDetail = (detail) =>
    runLiveSmoke({
      environment: readEnvironment,
      configuredUserId: "owner",
      verifiedUserIdentifiers: ["123", "owner"],
      invokeOperation: async (name) =>
        name === "get-my-notes" ? { notes: [] } : detail,
    });

  await runWithDetail(
    formatNote({ author: { id: "123", urlname: "owner" } }, "owner", true, true, "note-1")
  );
  await assert.rejects(
    runWithDetail(
      formatNote({ author: { id: "123", urlname: "other" } }, "owner", true, true, "note-1")
    ),
    /article detail is not owned by NOTE_USER_ID/
  );
  await assert.rejects(
    runWithDetail(formatNote({}, "owner", true, true, "note-1")),
    /article detail is not owned by NOTE_USER_ID/
  );
});

test("live smoke uses an XSRF token captured during authenticated reads before writing", async () => {
  const calls = [];
  let capturedXsrfToken = null;

  await runLiveSmoke({
    environment: {
      ...readEnvironment,
      NOTE_LIVE_DRAFT_TESTS: "true",
    },
    configuredUserId: "owner",
    verifiedUserIdentifiers: ["owner"],
    getXsrfToken: () => capturedXsrfToken,
    invokeOperation: async (name, input) => {
      calls.push([name, input]);
      if (name === "get-my-notes" && input.status === "all") {
        capturedXsrfToken = resolveXsrfToken(null, "captured-from-authenticated-response", null);
        return { notes: [] };
      }
      if (name === "get-note" && input.noteId === "note-1") {
        return { id: "note-1", author: { id: "owner" } };
      }
      if (name === "post-draft-note") return { noteId: "draft-1", noteKey: "n-draft-1" };
      if (name === "get-note") return { id: "draft-1" };
      if (name === "get-my-notes")
        return { notes: [{ id: "draft-1", isDraft: true }], hasNextPage: false };
      return { success: true };
    },
  });

  assert.ok(calls.some(([name]) => name === "post-draft-note"));
});

test("live smoke stops before draft writes without a configured or captured XSRF token", async () => {
  const calls = [];

  await assert.rejects(
    runLiveSmoke({
      environment: {
        ...readEnvironment,
        NOTE_LIVE_DRAFT_TESTS: "true",
        NOTE_LIVE_EYECATCH_TESTS: "true",
      },
      configuredUserId: "owner",
      verifiedUserIdentifiers: ["owner"],
      getXsrfToken: () => null,
      invokeOperation: async (name, input) => {
        calls.push([name, input]);
        if (name === "get-my-notes") return { notes: [] };
        return { id: "note-1", author: { id: "owner" } };
      },
    }),
    /no write was made/
  );

  assert.deepEqual(
    calls.map(([name]) => name),
    ["get-my-notes", "get-note"]
  );
});
