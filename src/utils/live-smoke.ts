type LiveSmokeEnvironment = {
  NOTE_LIVE_TESTS?: string;
  NOTE_LIVE_DRAFT_TESTS?: string;
};

export function isLiveSmokeEnabled(environment: LiveSmokeEnvironment): boolean {
  return environment.NOTE_LIVE_TESTS === "true";
}

export function isLiveDraftSmokeEnabled(environment: LiveSmokeEnvironment): boolean {
  return isLiveSmokeEnabled(environment) && environment.NOTE_LIVE_DRAFT_TESTS === "true";
}

export function hasConfiguredUserOwnership(note: unknown, userId: string): boolean {
  if (!note || typeof note !== "object") return false;
  const author = (note as { author?: { id?: unknown; urlname?: unknown } }).author;
  return [author?.id, author?.urlname].some(
    (identifier) => String(identifier ?? "") === userId
  );
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
