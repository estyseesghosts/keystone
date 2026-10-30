# Errors and retry

`packages/fedi` is Lingui-free: failures carry stable `{code, params}` and
the UI localizes. `FediError` carries `{code, params}`
(`core/errors.ts:120`); `ApiError` adds the HTTP `status`
(`core/errors.ts:139`); the Mastodon transport throws the raw
`MastoHttpError` (status + body + request context) and the backend adapts
it at the boundary. The full code union is `FEDI_ERROR_CODES`
(`core/errors.ts:24`), pinned by a union test — codes only ever add.

## Predicates (the support/auth boundary)

- `isUnsupportedError` — 404/405 (absent endpoint) only. Misskey:
  `misskey/client.ts:485`; Mastodon: `mastodon/client.ts` (via
  `toApiError` adaptation at the boundary — raw transport errors read
  false by design).
- `isPermissionError` — 403 scope-shaped (`PERMISSION_DENIED` and kin),
  i.e. sign in again with the current scopes. Misskey:
  `misskey/client.ts:492`; Mastodon equivalent in `mastodon/client.ts`.
  Auth/timeout/5xx are never support or permission evidence and always
  rethrow.
- `isRateLimitError` — HTTP 429 (`mastodon/client.ts:99`).
- `isNonRetryableStatus` (`core/errors.ts:183`) — callers consult it before
  retrying.

## Status-by-status behavior

| Situation                        | Handling                                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200 with JSON                    | Adapted normally                                                                                                                                                                 |
| 204 / empty 2xx                  | Resolves `undefined` — never blind `response.json()` (`core/http.ts:254`, `misskey/client.ts:24`, `misskey/client.ts:392`)                                                       |
| 202                              | Media upload processing (Mastodon `POST /api/v2/media` → poll `GET /api/v1/media/:id`; Akkoma answers 202 synchronously with the final body)                                     |
| 206                              | Mastodon home timeline regenerating — read normally                                                                                                                              |
| 400 `UNAVAILABLE`                | Note-search policy denial, not a missing endpoint                                                                                                                                |
| 400/422 from `notes/create` etc. | Validation errors surfaced with server text                                                                                                                                      |
| 401/403                          | Auth or scope failure: re-verify (401 drops dead sessions), re-auth prompt on `PERMISSION_DENIED`; never masked as "not found"                                                   |
| 404/405                          | Absent endpoint → honest unsupported state (hidden/disabled with reason)                                                                                                         |
| 410                              | Deleted/inaccessible status (`getStatus`) → unavailable state                                                                                                                    |
| 429                              | Surfaced with `Retry-After` / `X-RateLimit-*` (`mastodon/client.ts:44`, `parseRateLimit` at `:234`); `retryAfterMs` parses delta-seconds or HTTP-date (`mastodon/client.ts:109`) |
| 5xx / network / timeout          | Retryable; never "unsupported". Timeouts carry `errors.network.timeout*` with the deadline in seconds                                                                            |

## Strict Misskey-family servers (never send unknown fields)

Strict servers answer 400 on unknown or empty/default fields; Misskey 500s anonymous
`users/search`. The standing rule: send only documented params —
`{limit, sinceId, untilId}` plus endpoint-specific ids, never
`includeMyRenotes`/`sinceDate`-style extras. The upload path omits nullish
fields rather than sending defaults (`misskey/client.ts:330`). Unknown
`POST` paths on Misskey-family answer 404 with a non-JSON body — the
client keeps the HTTP status on the thrown error so callers can probe
support via 404.

## Idempotency

- Mastodon `POST /api/v1/statuses` honors `Idempotency-Key` (server returns
  the original on dup, ~1h window): one key per logical post attempt, kept
  across retries of that attempt (`mastodon/statusActions.ts:130`,
  `mastodon/compose.ts:200` `attemptKeyFor`).
- Misskey writes have no idempotency key: the submit path serializes
  per-note queues (e.g. Misskey-family `notes/like` toggle) and re-reads after
  writes instead of rendering optimistically.
- Upload timeouts/stalls (`errors.network.timeoutUpload`,
  `misskey/client.ts:392`, `mastodon/endpoints.ts:1413`) warn the file may
  already be stored — check before retrying, never blindly resend.

## Reason codes

UI gates carry stable reason codes alongside human text: `gate.*`
(`noSession`, `self`, `blockedByTarget`, `noLists` — `core/graph.ts:80`)
and the `errors.*` union above. Follow-up pointer: remaining fedi-side
reason-code work (X9.7) is a tracked owner decision in `state/STATE.md`.

## Coverage

| Area                                            | Status    | Evidence                                                     |
| ----------------------------------------------- | --------- | ------------------------------------------------------------ |
| Typed errors + predicates + 204/empty tolerance | Supported | `core/errors.ts`, `core/http.ts:254`, `misskey/client.ts:24` |
| 429 headers + `retryAfterMs`                    | Supported | `mastodon/client.ts:44`, `:109`, `:234`                      |
| Unknown-field discipline on strict servers      | Supported | `misskey/client.ts:330`, `noteBody.ts` field picking         |
| Idempotency keys (Mastodon create)              | Supported | `statusActions.ts:130`, `compose.ts:200`                     |
| Reason codes on gates                           | Supported | `core/graph.ts:80`, `FEDI_ERROR_CODES`                       |

Gaps: no automatic retry with backoff in the transport (callers own retry
policy using the predicates above); no offline queue.

## Sources

- `packages/fedi/src/core/errors.ts:24` (codes), `:120` (`FediError`), `:139` (`ApiError`), `:183` (non-retryable)
- `packages/fedi/src/core/http.ts:254` (empty bodies), `:333` (deadline)
- `packages/fedi/src/misskey/client.ts:24` (204/empty/errors), `:330` (upload field discipline), `:485` (unsupported), `:492` (permission)
- `packages/fedi/src/mastodon/client.ts:44` (`RateLimitInfo`), `:99` (429), `:109` (`retryAfterMs`), `:234` (`parseRateLimit`)
- `packages/fedi/src/mastodon/endpoints.ts:183` (`isAbsent`), `statusActions.ts:130` (idempotency)
- `packages/fedi/src/core/graph.ts:80` (gate codes)
