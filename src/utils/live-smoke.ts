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
