# 2026-10-21 — WS-F Mastodon correctness (grouped actors + filters UI) — subagent

Branch: `pF-mastodon` (base `main@28fc236`, merged WS-A/B/C/D/E)
Goal: WS-F per `docs/V2_GAPS.md`: MD1 grouped-actor fidelity (`adaptV2Notification`
for real `notification_groups` envelopes), Filters settings CRUD on
`Backend.filters` wired to `filterModerated`, sanitizer share (consume WS-B).

## Starting state (prior attempts)

Two prior WS-F attempts died on infra with no commits, but the worktree
held uncommitted work: 22 modified tracked files + 3 untracked scaffolds
(`packages/fedi/test/mastodon-grouped.test.ts`,
`src/components/Settings/FiltersSection.test.tsx`, `state/logs/assets-wsF/`
with 7 PNGs). I adopted the tracked modifications and both test files
(they are coherent and consistent with the new code), kept the assets dir
and re-shot every PNG myself this session. The probe script the attempt
used was gone; I wrote my own and deleted it after the run (outside file
ownership). Nothing was taken on faith — see verification below.

## Did

- **MD1 grouped-actor fidelity (adopted + verified).**
  `mastodon/adapt.ts`: `adaptV2Notification` takes a `statuses` map and
  branches on `group_key` into `adaptV2Group` — group key is the row id,
  `sample_account_ids` resolve against the envelope `accounts` (unknown
  ids stay id-only actors, never invented profiles), `status_id` resolves
  against `statuses` (unknown → null post, row kept), server
  `notifications_count` preserved in `ext.groupedCount` (new
  `NotificationExt.groupedCount` in `core/models.ts`), group-level emoji
  fans out only for reaction-kind groups. Flat rows (`account_id` +
  packed `status`) unchanged.
  `mastodon/endpoints.ts`: `fetchV2NotificationRows` reads both envelopes
  (`notifications` expanded flat + real `notification_groups`), returns the
  `statuses` map; still resolves null for anything else (array bodies) and
  throws only on 404/405 — flat-v1 fallback preserved. `backend.ts`
  comment updated; all 20 existing adapter tests stay green (2 updated to
  the new behavior: w4 + w8 grouped-envelope tests now assert in-place
  adaptation with no v1 call).
  Fixture `fixtures/mastodon/notification-grouped-v2.json` expanded to a
  full real-shape envelope (3 groups: favourite-100 count 12, follow-5
  with an unpacked sample, emoji_reaction with group ⭐) + manifest entry
  (`synthesised`, `unverified` — no grouped-capable server on the rig).
- **Filters UI (adopted + verified).** `FiltersSection.tsx`: list/add/
  phrase-edit/remove on `Backend.filters` with loading/empty/error states;
  Misskey family (no `filters` member) keeps the honest placeholder.
  Edit is beyond v1 parity (v1 `FiltersSettings` is list/add/remove only)
  — in-spec, CRUD means update too. Default create contexts
  `['home','notifications','public','thread']` match v1 exactly.
- **`filterModerated` wiring (adopted + fixed).** `moderation.ts`:
  `serverFilterWordsOf` maps hide-action (`irreversible`) phrases to
  single-keyword literal AND groups (bare strings would compile as
  Misskey `/regex/`; warn-action phrases skipped — soft words with no
  badge UI, W4 discipline), unioned into `hardMutedWords` via a new
  `serverFiltersQueryKey`. `muteCheckOf` falls back to `plain` when no MFM
  source (vanilla Mastodon/Akkoma `pleroma.content`; Misskey unchanged —
  `plain` is `""` there). **My fix:** the final `useMemo` omitted
  `serverPhrases` from deps — the React Compiler freezes stale memos
  (WS-C finding), so server phrases arriving after the id sets would never
  apply. Added with a comment.
- **"N others" from real envelopes (my gap-fix, see Deviations).**
  `NotificationRow` computed `extraCount` from `actors.length - 1`, so a
  count-12 group with 3 samples read "and 2 others". Now prefers
  `ext.groupedCount` (`max(actors-1, total-1)`), flat rows unchanged.
  New test `NotificationRow-grouped-wsf.test.tsx` (3): 12-total group →
  "and 11 others"; no count → actor-list fallback; inconsistent envelope
  never understates. Existing `NotificationRow.test.tsx` untouched and
  still green.
- **Sanitizer share:** consumed WS-B as-is (`bullet`/`heading`/`invisible`
  nodes untouched). No gap found: invisible spans render zero-width and
  are excluded from matching text, bullets/headings flow through
  `plainTextOf` into the word-mute haystack correctly. Nothing to rework.

## Decided (proposals for `docs/DECISIONS.md` — coordinator owns the file)

- 2026-10-21 WS-F: `useModerationRules` memo deps must include
  `serverPhrases` (React Compiler freezes stale memos; WS-C selector
  discipline generalizes to dep arrays).
- 2026-10-21 WS-F: grouped "N others" counts off `ext.groupedCount`
  (server total), floored by the packed actors; flat rows keep the
  actor-list count.
- 2026-10-21 WS-F: create defaults to warn-action (v1 + Mastodon-web
  parity); only hide-action phrases filter feeds. Warn = soft words with
  no badge UI (F16), never dropped.
- 2026-10-21 WS-F: web-against-Akkoma filter WRITES fail honestly —
  Akkoma has no `POST /api/v2/filters` (Phoenix 404 page carries no CORS
  headers → opaque TypeError) and the `isUnsupportedError` boundary
  deliberately never treats network failures as absent (contract §1,
  W8/MD12). Native/node unaffected (readable 404 → v1 fallback). Revisit
  if Akkoma ships v2 filter writes or CORS on error pages.

## Tests / verification (exact commands + results)

- `./node_modules/.bin/tsc -p tsconfig.check.ios.json` → exit 0
- `./node_modules/.bin/tsc -p tsconfig.check.android.json` → exit 0
- `./node_modules/.bin/tsc -p tsconfig.check.web.json` → exit 0
- `./node_modules/.bin/eslint` on all touched files (incl.
  `keystone/no-hardcoded-color`) → clean; `./node_modules/.bin/oxlint
  --quiet src packages/fedi` → clean.
- `NODE_ENV=test ./node_modules/.bin/jest --forceExit
  --testTimeout=20000` → **138 suites / 1638 tests pass** (baseline
  135/1619 + 3 suites/+19: `mastodon-grouped` 8, `FiltersSection` 3,
  `NotificationRow-grouped-wsf` 3, `moderation.test.ts` +5).
- Live Akkoma :4000 probe (esbuild-bundled script, deleted after):
  `login ok; list 0; create id=2 phrase=wsfprobe…; createRoundTrips ok;
  update …-edited ok; post <id>; serverWords [["…-edited"]];
  probePostInTimeline ok; livePhraseFilters ok ([["…-edited"]]);
  selfExempt ok; postCleanup ok; deleteRoundTrips ok;
  v2GroupedEnvelope: Akkoma answers v2 with 404 (flat fallback)`.
  **All live rows green.** Orphan filter from a crashed first run + the
  `dbgcheck` curl row both deleted — rig filters `[]` after.
- Helium web-visual (CDP :9222 open; expo :8088 started for this tree,
  left running): signed in akk1 via Login UI (server needed explicit
  `http://` scheme — bare host fails detection, pre-existing behavior);
  `06-filters.png` = live empty state; `07-filter-create-error.png` =
  UI create surfacing the honest CORS-walled failure (see Decided);
  settings index shows the Word filters row. Full set in
  `state/logs/assets-wsF/` (all 7 re-shot this session).
- Grouped-envelope live probe → `not verified` (Akkoma 404s the v2
  endpoint; unit-proven with the real-envelope fixture instead).
  Misskey-family live → `not verified` (:3101/:3102 down, unchanged).
  iOS/TalkBack → `not verified` (still blocked, per STATE).

## Deviations (files touched outside the slice list + why)

- `src/components/Notification/NotificationRow.tsx` (not in the WS-F
  file list): one additive expression — `extraCount` prefers
  `ext.groupedCount`. Required by the acceptance line "grouped
  notifications show 'N others' from real envelopes"; without it the
  adapter's preserved count never reaches the screen. Existing tests
  untouched and green; no new strings (no locale recompile).
- `src/components/Notification/NotificationRow-grouped-wsf.test.tsx`
  (new), `scripts/fedi-wsf-probe.ts` (created, run, DELETED),
  `state/logs/assets-wsF/*.png` (re-shot, incl. renaming the
  misleading `07-filter-created.png` → `07-filter-create-error.png`).
- Adopted (not authored): all 22 tracked modifications + the two
  untracked test scaffolds from the first attempt; verified by the full
  runs above, not by trust.
- Untouched as ordered: `state/STATE.md`, `docs/*`, `RichText.tsx`,
  `PostCard.tsx`, `PostQuote.tsx`, `body.ts`, `menuModel.ts`,
  `Navigation.tsx`, `routes.ts`, emoji files. `scripts/helium.mjs` used
  read-only (no edits).

## V1 + Bluesky references consulted (behavior only, no verbatim code)

- `~/Local Documents/Keystone/frontend/src/routes/Settings.tsx:1566-1649`
  (`FiltersSettings`: list/add/remove, default contexts, honest
  no-`filters` fallback — edit is the v2 addition).
- `~/Local Documents/Keystone/frontend/src/components/NotificationRow.tsx:214-269`
  (`GroupedNotificationRow`: up-to-3 names + "and N others"; v1 has no
  Mastodon `notification_groups` handling — confirms the gap is real).
- `~/Local Documents/Keystone/frontend/src/mastodon/backend.ts:770-818`
  (v1 filters: v2-only, no v1 fallback — v2's `withFilterFallback` is
  already ahead of v1).
- `~/Local Documents/Keystone/frontend/src/core/backend.ts:454-461`
  (`Filter`/`FiltersApi` shapes match the ported contract).

## Next

1. Coordinator: tick the three WS-F boxes in `docs/V2_GAPS.md` (MD1,
   Filters UI, sanitizer-share), append the four proposed DECISIONS
   lines, review/merge `pF-mastodon`. Suggested V2_GAPS ticks: MD1 box →
   "DONE 2026-10-21 (WS-F): `adaptV2Group` … unit-proven, live-probe
   needs a v2 server"; Filters boxes → "DONE 2026-10-21 (WS-F): CRUD +
   `filterModerated` wiring, Akkoma round-trip green (web-create
   CORS-limited, honest error)"; sanitizer box → "DONE 2026-10-21 (WS-F):
   consumed WS-B, no rework".
2. Follow-ups (not this WS): web-UI filter writes against Akkoma (needs
   server-side v2 writes or CORS on error pages, or a product call on
   falling back inside the UI — not recommended); grouped-envelope live
   proof against a real v2 server; explicit per-column sessionId threading
   into `PostQuote`/`User.tsx`/`Notifications.tsx` (WS-C proposal, open).
3. Expo :8088 (this tree) left RUNNING for owner review; Helium tab left
   open; rig filters `[]` clean.

STATUS: complete.
