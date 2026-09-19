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

export function hasConfiguredUserOwnership(note: unknown, userId: string): boolean {
  if (!note || typeof note !== "object") return false;
  const author = (note as { author?: { id?: unknown; urlname?: unknown } }).author;
  const identifiers = [author?.id, author?.urlname].filter(
    (identifier) => identifier !== undefined && identifier !== null && String(identifier) !== ""
  );
  return identifiers.length > 0 && identifiers.every((identifier) => String(identifier) === userId);
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
