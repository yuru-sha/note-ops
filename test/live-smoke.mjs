import {
  hasConfiguredUserOwnership,
  hasUnpublishedDraft,
  isLiveDraftSmokeEnabled,
  isLiveSmokeEnabled,
} from "../build/utils/live-smoke.js";
import { env } from "../build/config/environment.js";
import { registerMvpTools } from "../build/tools/mvp-tools.js";
import { redactSensitiveValues } from "../build/utils/safe-logging.js";

if (!isLiveSmokeEnabled(process.env)) {
  console.log("Live smoke skipped: set NOTE_LIVE_TESTS=true to opt in.");
  process.exit(0);
}

function registerHandlers() {
  const handlers = new Map();
  registerMvpTools({
    tool(name, _description, _schema, handler) {
      handlers.set(name, handler);
    },
  });
  return handlers;
}

async function invoke(handlers, name, input) {
  const response = await handlers.get(name)(input);
  const text = response?.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error(`${name} returned no diagnostic`);
  if (response.isError) throw new Error(text);
  return JSON.parse(text);
}

async function step(label, operation) {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`${label}: ${redactSensitiveValues(error)}`);
  }
}

async function main() {
  if (!env.NOTE_USER_ID) {
    throw new Error("NOTE_USER_ID is required; no request was made.");
  }
  if (!process.env.NOTE_LIVE_NOTE_ID) {
    throw new Error("NOTE_LIVE_NOTE_ID is required for the detail read; no request was made.");
  }

  const hasSession = Boolean(process.env.NOTE_SESSION_V5 && process.env.NOTE_XSRF_TOKEN);
  const hasLogin = Boolean(process.env.NOTE_EMAIL && process.env.NOTE_PASSWORD);
  if (!hasSession && !hasLogin && !process.env.NOTE_ALL_COOKIES) {
    throw new Error(
      "Set NOTE_SESSION_V5 and NOTE_XSRF_TOKEN, NOTE_ALL_COOKIES, or NOTE_EMAIL and NOTE_PASSWORD."
    );
  }
  if (isLiveDraftSmokeEnabled(process.env) && process.env.NOTE_ALL_COOKIES && !process.env.NOTE_XSRF_TOKEN) {
    throw new Error("Draft smoke with NOTE_ALL_COOKIES also requires NOTE_XSRF_TOKEN.");
  }

  const handlers = registerHandlers();
  const list = await step("article list", () =>
    invoke(handlers, "get-my-notes", { page: 1, perPage: 20, status: "all" })
  );
  if (!Array.isArray(list.notes)) {
    throw new Error("The article list response did not contain a notes array.");
  }

  const detail = await step("article detail", () =>
    invoke(handlers, "get-note", { noteId: process.env.NOTE_LIVE_NOTE_ID })
  );
  if (!hasConfiguredUserOwnership(detail, env.NOTE_USER_ID)) {
    throw new Error("The article detail is not owned by NOTE_USER_ID.");
  }
  console.log("Authenticated identity and configured-user ownership checks passed.");

  if (!isLiveDraftSmokeEnabled(process.env)) {
    console.log("Draft smoke skipped: set NOTE_LIVE_DRAFT_TESTS=true to opt in.");
    return;
  }

  const runId = new Date().toISOString();
  const title = `[note-ops live smoke ${runId}]`;
  const body = `note-ops authenticated live smoke ${runId}`;
  const created = await step("draft creation", () =>
    invoke(handlers, "post-draft-note", {
      title,
      body,
      tags: ["note-ops-live-smoke"],
    })
  );
  if (!created.noteId) throw new Error("Draft creation returned no note ID.");

  await step("draft editing", () =>
    invoke(handlers, "edit-note", {
      noteId: created.noteKey || created.noteId,
      title: `${title} edited`,
      body: `${body} edited`,
      tags: ["note-ops-live-smoke"],
    })
  );

  let page = 1;
  let verified = false;
  while (!verified) {
    const drafts = await step(`draft verification page ${page}`, () =>
      invoke(handlers, "get-my-notes", { page, perPage: 100, status: "draft" })
    );
    verified = hasUnpublishedDraft(drafts.notes, String(created.noteId));
    if (verified || !drafts.hasNextPage) break;
    page += 1;
  }
  if (!verified) {
    throw new Error("The smoke-test draft was not found as an unpublished draft.");
  }
  console.log(
    "Authenticated draft creation, editing, and unpublished-draft verification passed."
  );
  console.log(
    "The smoke-test draft is retained for manual cleanup; delete only the draft created by this run."
  );
}

main().catch((error) => {
  console.error(`Live smoke failed: ${redactSensitiveValues(error)}`);
  console.error("No credentials or full response bodies were printed. Check the named operation and its environment variables.");
  process.exitCode = 1;
});
