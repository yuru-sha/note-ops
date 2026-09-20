import { noteOwnership } from "./note-normalizers.js";

type LiveSmokeEnvironment = {
  NOTE_LIVE_TESTS?: string;
  NOTE_LIVE_DRAFT_TESTS?: string;
  NOTE_LIVE_EYECATCH_TESTS?: string;
  NOTE_SESSION_V5?: string;
  NOTE_ALL_COOKIES?: string;
  NOTE_EMAIL?: string;
  NOTE_PASSWORD?: string;
};

export function isLiveSmokeEnabled(environment: LiveSmokeEnvironment): boolean {
  return environment.NOTE_LIVE_TESTS === "true";
}

export function isLiveDraftSmokeEnabled(environment: LiveSmokeEnvironment): boolean {
  return isLiveSmokeEnabled(environment) && environment.NOTE_LIVE_DRAFT_TESTS === "true";
}

export function isLiveEyecatchSmokeEnabled(environment: LiveSmokeEnvironment): boolean {
  return isLiveDraftSmokeEnabled(environment) && environment.NOTE_LIVE_EYECATCH_TESTS === "true";
}

export function hasLiveSmokeAuthentication(environment: LiveSmokeEnvironment): boolean {
  return Boolean(
    environment.NOTE_SESSION_V5 ||
      environment.NOTE_ALL_COOKIES ||
      (environment.NOTE_EMAIL && environment.NOTE_PASSWORD)
  );
}

export function hasConfiguredUserOwnership(
  note: unknown,
  userId: string,
  trustedUserIdentifiers?: readonly string[]
): boolean {
  return noteOwnership(note, userId, trustedUserIdentifiers || [userId]) === true;
}

export function hasUnpublishedDraft(notes: unknown, noteId: string): boolean {
  return (
    Array.isArray(notes) &&
    notes.some((note) => {
      const candidate = note as { id?: unknown; isDraft?: unknown };
      return String(candidate.id ?? "") === noteId && candidate.isDraft === true;
    })
  );
}
