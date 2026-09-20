import {
  hasConfiguredUserOwnership,
  hasUnpublishedDraft,
  hasLiveSmokeAuthentication,
  isLiveDraftSmokeEnabled,
  isLiveEyecatchSmokeEnabled,
  isLiveSmokeEnabled,
} from "../build/utils/live-smoke.js";
import { env } from "../build/config/environment.js";
import { registerMvpTools } from "../build/tools/mvp-tools.js";
import { redactSensitiveValues } from "../build/utils/safe-logging.js";
import { getActiveXsrfToken, getVerifiedConfiguredUserIdentifiers } from "../build/utils/auth.js";
import { fileURLToPath, pathToFileURL } from "node:url";

const testEyecatchPath = fileURLToPath(
  new URL("../test-articles/images/test-image.png", import.meta.url)
);

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

export async function runLiveSmoke({
  environment = process.env,
  configuredUserId,
  invokeOperation,
  getXsrfToken = getActiveXsrfToken,
  verifiedUserIdentifiers,
} = {}) {
  const userId = configuredUserId || environment.NOTE_USER_ID;
  if (!userId) {
    throw new Error("NOTE_USER_ID is required; no request was made.");
  }
  if (!environment.NOTE_LIVE_NOTE_ID) {
    throw new Error("NOTE_LIVE_NOTE_ID is required for the detail read; no request was made.");
  }

  if (!hasLiveSmokeAuthentication(environment)) {
    throw new Error("Set NOTE_SESSION_V5, NOTE_ALL_COOKIES, or NOTE_EMAIL and NOTE_PASSWORD.");
  }
  if (
    isLiveDraftSmokeEnabled(environment) &&
    environment.NOTE_ALL_COOKIES &&
    !environment.NOTE_XSRF_TOKEN
  ) {
    throw new Error("Draft smoke with NOTE_ALL_COOKIES also requires NOTE_XSRF_TOKEN.");
  }

  if (!invokeOperation) throw new Error("Live smoke requires an invoke operation.");
  const list = await step("article list", () =>
    invokeOperation("get-my-notes", { page: 1, perPage: 20, status: "all" })
  );
  if (!Array.isArray(list.notes)) {
    throw new Error("The article list response did not contain a notes array.");
  }
  const trustedUserIdentifiers =
    verifiedUserIdentifiers || getVerifiedConfiguredUserIdentifiers();

  const detail = await step("article detail", () =>
    invokeOperation("get-note", { noteId: environment.NOTE_LIVE_NOTE_ID })
  );
  if (!hasConfiguredUserOwnership(detail, userId, trustedUserIdentifiers)) {
    throw new Error("The article detail is not owned by NOTE_USER_ID.");
  }
  console.log("Authenticated identity and configured-user ownership checks passed.");

  if (!isLiveDraftSmokeEnabled(environment)) {
    console.log("Draft smoke skipped: set NOTE_LIVE_DRAFT_TESTS=true to opt in.");
    return;
  }
  if (!environment.NOTE_XSRF_TOKEN && !getXsrfToken()) {
    throw new Error(
      "Draft smoke requires an XSRF token before any write request; no write was made."
    );
  }

  const runId = new Date().toISOString();
  const title = `[note-ops live smoke ${runId}]`;
  const body = `note-ops authenticated live smoke ${runId}`;
  const created = await step("draft creation", () =>
    invokeOperation("post-draft-note", {
      title,
      body,
      tags: ["note-ops-live-smoke"],
    })
  );
  if (!created.noteId) throw new Error("Draft creation returned no note ID.");

  const draftDetailReference = created.noteKey || created.noteId;
  const createdDetail = await step("draft detail verification", () =>
    invokeOperation("get-note", { noteId: draftDetailReference })
  );
  if (String(createdDetail.id) !== String(created.noteId)) {
    throw new Error("The created draft detail did not match the saved note ID.");
  }

  await step("draft editing", () =>
    invokeOperation("edit-note", {
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
      invokeOperation("get-my-notes", { page, perPage: 100, status: "draft" })
    );
    verified = hasUnpublishedDraft(drafts.notes, String(created.noteId));
    if (verified || !drafts.hasNextPage) break;
    page += 1;
  }
  if (!verified) {
    throw new Error("The smoke-test draft was not found as an unpublished draft.");
  }
  console.log("Authenticated draft creation, editing, and unpublished-draft verification passed.");
  console.log(
    "The smoke-test draft is retained for manual cleanup; delete only the draft created by this run."
  );

  if (!isLiveEyecatchSmokeEnabled(environment)) {
    console.log("Eyecatch smoke skipped: set NOTE_LIVE_EYECATCH_TESTS=true to opt in.");
    return;
  }

  const draftReference = created.noteId;
  await step("eyecatch upload", () =>
    invokeOperation("set-note-eyecatch", {
      noteId: draftReference,
      imagePath: testEyecatchPath,
    })
  );
  const updated = await step("eyecatch verification", () =>
    invokeOperation("get-note", { noteId: draftDetailReference })
  );
  if (typeof updated.eyecatchUrl !== "string" || !updated.eyecatchUrl) {
    throw new Error("The smoke-test draft detail did not contain an eyecatch URL.");
  }

  page = 1;
  verified = false;
  while (!verified) {
    const drafts = await step(`eyecatch draft verification page ${page}`, () =>
      invokeOperation("get-my-notes", { page, perPage: 100, status: "draft" })
    );
    verified = hasUnpublishedDraft(drafts.notes, String(created.noteId));
    if (verified || !drafts.hasNextPage) break;
    page += 1;
  }
  if (!verified) {
    throw new Error("The smoke-test draft was not still unpublished after eyecatch upload.");
  }
  console.log("Eyecatch upload, read-back, and unpublished-draft verification passed.");
}

async function main() {
  const handlers = registerHandlers();
  return runLiveSmoke({
    configuredUserId: env.NOTE_USER_ID,
    invokeOperation: (name, input) => invoke(handlers, name, input),
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (!isLiveSmokeEnabled(process.env)) {
    console.log("Live smoke skipped: set NOTE_LIVE_TESTS=true to opt in.");
  } else {
    main().catch((error) => {
      console.error(`Live smoke failed: ${redactSensitiveValues(error)}`);
      console.error(
        "No credentials or full response bodies were printed. Check the named operation and its environment variables."
      );
      process.exitCode = 1;
    });
  }
}
