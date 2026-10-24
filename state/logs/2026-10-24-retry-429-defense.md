# 2026-10-24 — Stop amplifying 429s + dev API census — agent

Branch: `main` (direct; standing owner instruction).
Goal: owner report — mstdn.ca 429s on "anything and everything"
(300-bucket, `remaining: 0`, 2-min reset; website fine), sudden onset
after a day of heavy testing. No background loop found (quiet when
idle; no polling timers; streaming has backoff; single QueryClient).

## Decided

- The self-sustaining mechanism: every query ran `retry: 2` with no
  status filter, so each throttled request became three. Once the
  bucket went hot, ordinary use held it down indefinitely. Fix the
  amplifier; hunt the initiator separately with data.
- No volume loop in code: mention/hover/profile fan-out is real but
  bounded and cached; feed lifetimes sane (30s/5min).

## Did

- `packages/fedi/src/core/errors.ts`: `httpStatusOf` (reads
  `.status`, mirrors `params.status`; 0/absent → null) +
  `isNonRetryableStatus` (401/403/404/410/422/429).
- `src/state/queries/retry.ts`: `retryPolicy(attempts?)` — same caps
  as the raw numbers, but never retries non-retryable statuses.
  Applied at every `retry:` site (Provider default, feeds, threads,
  conversations, notifications, chat, recommendations).
- `packages/fedi/src/mastodon/client.ts`: `toApiError` preserves
  429 headers in params (`retryAfter`, `retryAfterMs`,
  `rateLimitRemaining`, `rateLimitReset`); new `retryAfterMs`
  (delta-seconds or HTTP-date).
- Both transports: dev-only `[fedi-api]` console lines (one per
  request + one per non-2xx) for the next incident's census. Silent
  in tests/prod (`__DEV__` + non-test env).
- Tests: `errors.test.ts` (status extraction, policy table,
  retry-after parsing), `retry.test.ts` (caps, never-429, still-5xx,
  false), `toApiError` header preservation cases.

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- Full suite green with this + the hover work (see companion log).
- Live throttling cleared or not: owner to confirm; `[fedi-api]`
  lines name the hammer if it returns.

## Next

- If 429s persist under light use: paste repeating `[fedi-api]`
  paths → targeted fix. Push `main`.
