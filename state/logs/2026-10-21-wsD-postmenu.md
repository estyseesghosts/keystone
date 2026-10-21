# 2026-10-21 — WS-D post menu C16 + mute/block/report + translations — subagent

Branch: `pD-postmenu` (from `main@eb37e02`)
Goal: wire the post-menu C16 rows with honest gating (report + boost re-read new; translations verify + retry/error).

Did:

- `src/components/Post/menuModel.ts`: report row is now live — hidden for
  own posts (v1 `canModerate` parity), disabled with reason when signed out
  (`Sign in to do this.`) or unconnected, otherwise a confirm spec that
  requires a comment. `confirm` gains optional `commentLabel` + `run(comment?)`
  (delete/block confirms unchanged — they fall through to the item `run`).
  `UserActionHandlers` gains `onReport(comment)`. Mute/mute-boosts/block
  relation labels, clip row, and all disabled-with-reason rows untouched.
- `src/components/Post/PostMenu.tsx`: confirm dialog renders a `TextField`
  when `commentLabel` is set; the action stays disabled until non-empty and
  the comment is passed to the confirm `run` (else item `run`, as before).
  Failures toast; never inert.
- `src/screens/PostHandlers.tsx`: provider `userFor` now supplies `onReport`
  (`reportAccount` + `Report sent` toast, empty reason refused with a toast,
  failures toast). Boost-visibility flips now re-read `relationships` after a
  successful toggle and write the cache (`relationshipQueryKey`), so undo
  labels flip the same way controller-owned mute/block do via invalidation.
- `src/components/Settings/MutesSection.tsx`: mastodon placeholder reason
  `Not wired yet — the backend has no list endpoint.` →
  `This server has no repost-mute list.` (the list genuinely has no endpoint
  on that family; two-way search + list unmute already landed in W4).
- Locales: `lingui extract --clean --locale en && lingui compile`; new
  strings are en-source (`Report {handle}?`, `Reason`, repost-mute reason;
  extractor also picked up 4 pre-existing en strings missing from the catalog).
- v1 reference consulted read-only (behavior only, nothing copied):
  `~/Local Documents/Keystone/frontend/src/components/NoteMenu.tsx`
  (`canModerate`, report confirm + required comment, relation re-read after
  modify, `surfaceLimited`/disabled rows). No Bluesky source needed.

Decided (proposed, coordinator owns `docs/DECISIONS.md` — NOT written):

- Report routes through `UserActionHandlers.onReport` (not a top-level
  handler) because `LivePostCard` already calls `handlers.userFor?.(...)` —
  this wires report with zero `PostCard.tsx` edits (WS-A owns that file).
- `MASTO_SCOPES` left untouched: `write:reports` is absent, so granular-only
  Mastodon tokens 403 report honestly via toast. Adding the scope would mark
  every stored Mastodon session `needsUpgrade`; propose as a follow-up line.
- No live report attempt: reports are non-retractable moderation tickets and
  the rig has a single user — unit-proven UI→backend instead.
- Mastodon boost flip without a follow edge stays a refusal (no silent
  follow): `setBoostVisibility` throws `errors.unsupported.boostVisibility`,
  surfaced by toast.

Tests / verification (paste commands + results):

- `node_modules/.bin/tsc --project ./tsconfig.check.{ios,android,web}.json`
  → all three exit 0, empty output.
- `node_modules/.bin/oxlint --quiet src` → clean. `node_modules/.bin/eslint`
  (7 touched files) → clean.
- `NODE_ENV=test node_modules/.bin/jest --forceExit --testTimeout=20000`
  → **128 suites / 1537 tests pass** (baseline 127/1521: +1 suite
  `PostHandlers.test.tsx`, +16 tests, 0 failed).
- New tests: `menuModel.test.ts` report hidden/disabled/wired+comment;
  `PostMenu` comment-required confirm (disabled-until-text, passes comment)
  + plain-confirm regression; live `PostCard` translate failure→toast→retry
  (mock sequencing note: the mount auto-fetch consumes the first rejection,
  so the fixture rejects twice then resolves); live report confirm→
  `reportAccount('other','spam')`, no-reporter reason, own-post hidden;
  `PostHandlers.test.tsx` provider mute/boost/report/empty-reason/failure.
- Live Akkoma `:4000` (temp `scripts/fedi-wsd-probe.ts`, deleted after run):
  `login ok`; `caps.translation supported`; `target FAIL — no second account
  on rig` (single user, empty federated timeline — mute/block/boost
  round-trips live IMPOSSIBLE); `rel.selfread ok rows=1` (re-read mechanic
  live); `translate.refusal ok — honest: ApiError: Translation is not
  enabled` (rig advertises translation, refuses per-call — the app toasts
  exactly this; see screenshot).
- Helium (`:9222` vs expo `:8088`, persisted akk1):
  `state/logs/assets-wsD/home.png` (signed-in feed),
  `state/logs/assets-wsD/menu.png` (open post menu: Translate live,
  bookmark/clip disabled with reasons),
  `state/logs/assets-wsD/translate-toast.png` (tapping Translate toasts
  `Translation is not enabled` — end-to-end per-post error path).
- Misskey-family live DOWN (`:3101`/`:3102` refused) → misskey-only paths
  (clip flow, `users/report-abuse` wire) unit-proven, `not verified` live.

Deviations (files touched outside the slice + why):

- `src/components/Post/PostMenu.tsx` — not in the ownership list verbatim,
  but the spec's "report/clip dialog+toast wiring" requires the comment
  field in the confirm dialog; minimal hunk, no behavior change otherwise.
- `src/locale/**` — regenerated by `lingui extract/compile` (required for
  the new strings; en-only, other locales fall back per convention).
- `src/screens/PostHandlers.test.tsx` — new test file (allowed: "your new
  tests"). No `PostCard.tsx` edit (forbidden) — none needed.
- WS-E proximity: my hunks avoid `menuModel.ts:134` (copy-profile-url);
  closest hunks are the confirm-type block (~line 27), `UserActionHandlers`
  (~line 44), `reportRow` (~line 155), group3 (~line 222). Merge with WS-E
  should be clean (distinct regions).

Next:

- Coordinator: tick WS-D boxes in `docs/V2_GAPS.md`, append proposed
  DECISIONS lines (report-via-`userFor`; `write:reports` scope follow-up;
  single-user rig blocks live mute/block), merge-risk note (WS-E same file,
  distinct hunks).
- Follow-ups (not WS-D): live mute/block/report round-trip needs a second
  rig user; `write:reports` scope proposal; Misskey-family live still down.

STATUS: complete.
