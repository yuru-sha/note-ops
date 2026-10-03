# Observed note.com endpoint map

Source: [note非公式APIを徹底調査｜2026年版エンドポイント一覧完全版](https://note.com/marie_222/n/n6a10366298b0), stated last updated 2026-09-14. This is a third-party observation, not an official API contract. Revalidate against the live UI before implementation. “Observed” does not mean supported by note-ops or authorized for use.

## Authentication and identity

| Method and path | Observed purpose and caveats |
|---|---|
| `POST /api/v1/sessions/sign_in` | Email/password session login; the survey reports reCAPTCHA v3 became necessary in May 2026 and missing tokens can yield a success-like response without a session cookie. Do not bypass CAPTCHA. |
| `GET /api/v2/current_user` | Authenticated identity; `/api/v2/current_user/email` may expose additional personal data. Use the least data needed and verify against configured identity. |
| `POST /api/v3/graphql/auth` | Issues/refreshes a short-lived GraphQL JWT cookie from an existing session; GraphQL dashboard calls need it as a bearer token or may silently behave anonymously. |

## Articles and draft lifecycle

| Method and path | Observed purpose and caveats |
|---|---|
| `GET /api/v3/notes/{key}` | Article detail. `?draft=true&draft_reedit=false` reportedly returns editor-view fields, including `note_draft` when available; it can be null after publishing. |
| `POST /api/v1/text_notes` | Creates an empty note reservation and returns numeric `id` plus `n...` key. |
| `POST /api/v1/text_notes/draft_save?id={numeric_id}` | Saves title/body as a draft. Publish metadata such as hashtags and magazine/circle associations may be silently ignored. This is the write path used by the MVP. |
| `PUT /api/v1/text_notes/{numeric_id}` | Publish or update a published article using a full payload. Out of scope for note-ops MVP. Do not call to save an ordinary draft. |
| `POST /api/v2/notes/{key}/change_status` | Observed unpublish transition; may be rejected for paid or associated content. Out of scope. |
| `DELETE /api/v1/text_notes/draft_delete?id={numeric_id}` | Deletes a draft. Destructive and out of scope. |
| `DELETE /api/v1/notes/{numeric_id}` | Soft-deletes a published article. Destructive and out of scope. |
| `POST /api/v1/image_upload/note_eyecatch` | One-step multipart eyecatch upload associated by numeric draft ID. Existing `set-note-eyecatch` owns the limited, validated use in this repository. |
| `POST /api/v3/images/upload/presigned_post` then S3 multipart POST | Two-stage body-image upload. Out of scope for the current server. Treat returned presigned fields as secrets. |

## Search, creator pages, archives, hashtags

| Method and path / operation | Observed purpose and caveats |
|---|---|
| `GET /api/v3/searches?context=...&q=...&size=...&start=...` | Cross-resource search. Contexts include `note`, `user`, `magazine`, `hashtag`, `circle`, and `noteForSale`; sort values include `popular`, `hot`, `new`. Reported page size max is about 20. Not in the six-tool surface. |
| `GET /api/v2/creators/{urlname}` | Creator profile and counts. |
| `GET /api/v2/creators/{urlname}/contents?kind=note&page=...` | Creator contents, but reportedly omits items hidden from the creator top page. |
| `GET /api/v2/creators/{urlname}/archives` | Year/month counts; can enumerate months with content. |
| GraphQL `CreatorAllNotesPageQuery` | `creatorNotesConnectionByUrlname`; cursor-paged public creator listing, also omits creator-top-hidden items. |
| GraphQL `CreatorArchivesPageQuery` | `noteArchivesConnectionByUrlname`; month-specific archive includes items omitted from creator listing. Pair with REST archive summary to discover months. |
| GraphQL `CreatorLikesPageQuery` | `noteLikesConnectionByUrlname`; creator's liked articles. Survey warns `first > 100` may return 500. |
| `GET /api/v2/hashtags/{tag}` | Hashtag metadata and related hashtags. A v1 sibling reportedly has a different response shape. |
| `GET /api/v3/hashtags/{tag}/notes?order=...&page=...` | Hashtag article listing. `order` observed as `popular`, `new`, or `hot`; 50 per page. |
| GraphQL `POST https://graphql.note.com/graphql` | Shared GraphQL endpoint with `operationName`, `query`, and `variables`. Article listing has moved toward GraphQL; endpoint choice may vary by page and can change. |

## Other observed read surfaces

| Method and path / operation | Observed purpose and caveats |
|---|---|
| `GET /api/v1/stats/pv?filter=all&page=1&sort=pv` | Legacy per-article PV listing; not the newer impression metric and may require parameters to avoid server errors. Analytics are outside the MVP. |
| GraphQL `dashboardSummary`, `dashboardMetricChart`, `dashboardNoteListConnection` | Dashboard metrics including impressions and page views. Requires authenticated GraphQL bearer token; data is for the signed-in account. Analytics are outside the MVP. |
| `GET /api/v3/notes/{key}/note_comments` | Comment listing. Older v1 comment reads reportedly became empty; v3 returns `data` as an array. Comments are outside the MVP. |

## Write headers and payload observations

The survey describes ordinary authenticated writes using session cookies and
XSRF/CSRF protection. Specific write families may need additional headers or
payload fields. For example, v3 comment writes reportedly require
`X-Note-Client-Code`, an AST-shaped `comment`, and `acknowledgement: false`.
These are observational details only; they do not authorize implementing
comments or synthesizing identity values. Never copy secret header values into
docs, fixtures, test output, or logs.

Several update APIs reportedly require full payloads, and some return opaque
500 responses on schema mismatch. A 2xx response may also silently ignore
unsupported fields. For any newly scoped write, verify the exact UI action,
required fields, ownership, idempotency, and post-write state before proposing
code. Do not infer success from HTTP status alone.

## Confidence labels

- **Survey observation**: explicitly reported by the linked author, not checked
  in this repository or guaranteed current.
- **Re-observed**: verified against the current note.com UI during this task;
  add the date and a redacted evidence description when applicable.
- **Inferred / unknown**: the source itself marks a detail as tentative or
  unverified. Do not turn it into an implementation assumption.
