# Copilot review instructions

- Review every change against `SPEC.md` and `AGENTS.md`; treat `SPEC.md` as the contract for the default server.
- Keep the default surface narrow: local MCP stdio, the six tools listed in `SPEC.md`, and the existing API, authentication, error-handling, and Markdown utilities.
- Check authenticated list/read/write paths for configured-user identity and target-note ownership. Require fail-closed behavior for missing, mismatched, or conflicting identity or ownership, and require XSRF protection for draft and eyecatch writes.
- Check that writes remain draft saves or draft eyecatch metadata. Treat publication, comments, likes, body-image uploads, integrations, HTTP/n8n, and browser automation as out of scope unless `SPEC.md` is updated.
- Check URL encoding for note IDs and keys, redacted errors and logs, and validation before network requests at trust boundaries.
- Prefer small, focused changes that reuse existing code. Review tests for meaningful offline coverage and run `npm test`; credential-gated live note.com checks are separate.
- Report only actionable findings with severity, file, line, impact, and a concrete fix. Do not request merge or release as part of the review.
