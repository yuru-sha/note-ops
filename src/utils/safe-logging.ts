const sensitiveAssignments =
  /\b(?:NOTE_SESSION_V5|NOTE_XSRF_TOKEN|NOTE_GQL_AUTH_TOKEN|NOTE_ALL_COOKIES|NOTE_EMAIL|NOTE_PASSWORD|password|passwd|pwd|token)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^,;\s}]+)/gi;
const sensitiveCookies =
  /\b(?:_note_session_v5|XSRF-TOKEN|note_gql_auth_token|x-xsrf-token)\s*=\s*[^;\s,}]+/gi;
const emailAddresses = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export function redactSensitiveValues(value: unknown): string {
  return String(value)
    .replace(sensitiveAssignments, "$1[REDACTED]")
    .replace(sensitiveCookies, (match) => match.replace(/=.*/, "=[REDACTED]"))
    .replace(emailAddresses, "[REDACTED_EMAIL]");
}
