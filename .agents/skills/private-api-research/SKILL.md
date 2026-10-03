---
name: private-api-research
description: Research undocumented or unofficial web APIs and make safe, evidence-based implementation decisions. Apply the target project's own architecture and authorization rules before changing code.
---

# Private API research and implementation decisions

Use this skill when a project depends on an undocumented web API or reverse-
engineered behavior. The process is reusable; endpoint details, credentials,
and allowed operations are always service- and project-specific. An observed
request is not an official contract or authorization to reproduce it.

## Establish the project boundary first

1. Read the repository's agent instructions, public specification, API client,
   authentication/authorization code, and any workflow or verification skills.
2. Identify the supported public surface and the smallest behavior the request
   needs. Do not add adjacent endpoints or capabilities just because they were
   discovered.
3. Preserve the project's existing identity, ownership, consent, validation,
   error-redaction, and write-confirmation checks. If the request exceeds them,
   explain the specific scope change and stop before implementing it.
4. Prefer the existing client and established calls. Do not create a second
   authentication path or bypass a project's supported interface.

## Evidence and revalidation

- Start with the referenced first-hand survey or current official web UI. Treat
  third-party endpoint catalogs as dated observations; check their update date,
  caveats, and change history.
- Re-observe the relevant UI flow using a normal, authorized user session.
  Prefer harmless reads. Inspect only the specific Network request needed.
- Record method, route, non-secret query and payload shape, required header
  names, status, and redacted response shape. Never retain raw credential-
  bearing request dumps, browser storage, or full response bodies.
- Label findings as **re-observed**, **source-only**, **inferred**, or
  **unknown**, with an observation date when available. Do not present an
  inference as a contract. When evidence conflicts, stop and report it.
- Revalidate the route, pagination, response schema, authentication, and
  write behavior before implementation. Re-check after service changes; do not
  assume an old observation remains valid.

## Authentication and secrets

- Use only an authorized, project-supported credential source. Never print,
  log, commit, or store passwords, session cookies, CSRF/XSRF values, bearer or
  CAPTCHA tokens, authorization headers, or unredacted credential-bearing
  traffic.
- Do not automate or bypass CAPTCHA, MFA, access controls, rate limits, or
  ownership checks. If the supported session is unavailable or expired, stop
  and request an authorized reauthentication path.
- Log operation names and status codes only. Return actionable but redacted
  errors; avoid full response bodies in diagnostics.

## Write boundaries

- Treat non-GET requests as mutations until proven otherwise. Do not probe
  destructive or externally visible actions on real user data.
- Prefer reads and explicitly designated test objects. Before any write,
  confirm target ownership, exact effect, required anti-CSRF protections, and
  an authorized confirmation path under the project rules.
- Never retry a write automatically after timeout or server error; it may have
  succeeded. Reconcile with an authorized read before deciding next steps.
- Do not replay captured writes, rotate identities, evade throttling, or expand
  a project's public API surface without explicit scope authorization and the
  required specification and contract updates.

## Implementation and verification

1. Make the smallest change through existing project abstractions.
2. Add an offline regression check for changed behavior and preserve public
   contracts. Follow repository-specific test instructions.
3. Run the documented local checks. Keep offline test results separate from
   live-service verification; never claim the live API works based on mocks or
   offline tests.
4. For live checks, use only the authorized account and a designated test
   object; capture redacted evidence and confirm the resulting state with a
   read. Do not publish or trigger irreversible actions as verification.

## Project-specific reference

This checkout has a service-specific endpoint catalog at
[references/endpoints.md](references/endpoints.md). Its note.com facts do not
apply to other services. The note-ops contract is `docs/SPEC.md`; the server
continues to expose exactly its six registered tools unless a separately
approved change updates that specification and its contract checks. Existing
article workflows and MCP verification are governed by
`skills/note-management-workflow/SKILL.md` and
`.agents/skills/verify-note-ops/SKILL.md` respectively.
