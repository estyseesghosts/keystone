# Live server checks — owner-run checklist (repair program 2026-10-25, slice X12.1)

Agents could not reach the rig (Misskey `:3101` / Sharkey `:3102` refused
connections from the agent environment), so every live-server assertion is
`not verified (owner live-tests externally)`. Each item names its originating
slice + session log. Mark each `[ ]` → `[x]` with server version + result.

Rig: Misskey `http://127.0.0.1:3101`, Sharkey `http://127.0.0.1:3102`,
Mastodon-family per `docs/setup.md`. Start with §0 (fixture capture), which
refreshes the synthesised fixtures several checks below depend on.

## 0. Fixture capture — run first

- Source: X5.6 (`state/logs/2026-10-25-repair25-x5.6.md`); command text from
  `docs/setup.md` §8 "Recording fixtures".
- Steps — run exactly (read-only unless `--include-writes`, which creates
  then deletes its own probe posts; never commit a token):

```bash
cd /Users/terezi/keystone2
node scripts/fedi-capture.ts --dry-run   # no network: in-process stub, temp dir (this is what CI runs)
TOKEN="$(cat ~/.keystone-misskey-token)"
node scripts/fedi-capture.ts --family misskey --origin http://127.0.0.1:3101 --token "$TOKEN"
node scripts/fedi-capture.ts --family sharkey --origin http://127.0.0.1:3102 --token "$TOKEN"
node scripts/fedi-capture.ts --family mastodon --origin https://mastodon.example --token "$TOKEN" \
  --poll-status-id <status-with-hidden-totals-poll> --quote-status-id <status-with-nested-quote> \
  --include-writes
```

- Expected: fixtures land in `packages/fedi/test/fixtures/<family>/` with
  `source: recorded` + server version + date in `manifest.json`; redaction
  golden holds (no `Bearer`, token, email, or IPv4 literal survives; reaction
  map keys like `:name@host:` survive by construction). Review the diff before
  tests consume it — a recorded page reflects the owner's account state
  (notifications go to `notifications-recorded.json` /
  `notifications-grouped-recorded.json`, never clobbering existing rows).
  `FEDI_CAPTURE_TOKEN` works instead of `--token`.
- Live probes beyond capture: `pnpm smoke` (read-only baseline) and
  `pnpm probe:w4 / probe:w5 / probe:w8 / probe:wsc` (authed Akkoma `:4000`
  probes) — see `docs/setup.md` §9 (X11.1).

## Misskey / Sharkey

### 1. Wrapper-row lists (Followers / Following / Muted / Blocked)
- Source: X5.1 (`state/logs/2026-10-25-repair25-x5.1.md`).
- Steps: on the rig (`:3101` + `:3102`), open each of the four screens, page
  past the first page, follow/unfollow from a row.
- Expected: rows render, paging continues, follow/unfollow works; then record
  real fixtures via §0.

### 2. `users/search` offset semantics + Sharkey short-page tails
- Source: X5.2 (`state/logs/2026-10-25-repair25-x5.2.md`).
- Steps: search users on both `:3101` and `:3102`; page to the tail.
- Expected: offset/second-page behavior matches the shipped `pageOf`/cursor
  fixtures; short final pages on Sharkey terminate (no loop, no dupes).

### 3. Reaction packed-map keys
- Source: X5.3 (`state/logs/2026-10-25-repair25-x5.3.md`); capture X5.6.
- Steps: record fixtures for a note with colon-wrapped AND bare reaction
  keys (§0), replacing the synthesised bare/colon pair.
- Expected: lookup order (exact key → bare `name@host` → `name`) resolves
  both shapes against the live maps.

### 4. `notes/edit` shape — `editId`, envelope, clear semantics
- Source: X5.4 (`state/logs/2026-10-25-repair25-x5.4.md`).
- Steps: edit a post on Sharkey; watch the wire body + response.
- Expected: param is `editId` (never `noteId`); response is the
  `{createdNote}` envelope; `fileIds: []` / `poll: null` clear; the
  unauthenticated-probe interpretation matches the shipped behavior.

### 5. `i/revoke-token` with `{i, token}` + `movedTo` URI shape
- Source: X5.5 (`state/logs/2026-10-25-repair25-x5.5.md`).
- Steps: revoke a session token against live Misskey + Sharkey; move an
  account and read the `movedTo` shape.
- Expected: revoke posts `{i, token}` (token id rides options, never the
  session shape); moved-account URIs adapt as shipped; then record real
  fixtures via §0.

## Mastodon

### 6. Notification dismiss — v1 + v2 grouped (4.3+)
- Source: X4.1 (`state/logs/2026-10-25-repair25-x4.1.md`).
- Steps (Mastodon 4.3+ account with grouped notifications; Akkoma for the
  no-v2 leg):
  1. Dismiss a grouped row → row disappears, no "not on this server" caption
     (API census: one v1 404 + one v2 DELETE).
  2. Dismiss a flat row → single v1 POST, row disappears.
  3. Akkoma: dismiss a flat row → single v1 POST, no v2 attempt.
  4. Dismiss an already-gone row (404) → removed locally, no error wall.
  5. Notifications of type `status` ("posted a new note") and e.g.
     `severed_relationships` (translated generic, never the raw token).
- Expected: all five behave as above.

### 7. `resolve=true` search
- Source: X4.2 (`state/logs/2026-10-25-repair25-x4.2.md`).
- Steps (Mastodon authed session):
  1. Paste a remote post URL / `@user@host` into search → results appear
     (census shows `resolve=true`); plain word search sends no `resolve`.
  2. Same queries signed out / token-less → no `resolve` param.
  3. `@`-autocomplete while typing → suggestions, no `resolve`.
  4. Profile Featured/"pinned" tab → `pinned=true` on
     `/api/v1/accounts/:id/statuses`.
  5. Plain Mastodon server with NodeInfo blocked → family `mastodon`,
     evidence `instance-v2-shape`.
- Expected: `resolve` sent only for URL/handle shapes on authed sessions.

### 8. Hidden-total polls
- Source: X4.3 (`state/logs/2026-10-25-repair25-x4.3.md`).
- Steps (Mastodon rig):
  1. Create a `hide_totals` poll, keep it open → options read "Hidden until
     closed" (no zeros/bars); vote → still hidden; close → counts appear.
  2. Poll with `:custom:` option title + `poll.emojis` → glyph renders,
     unknown code stays literal.
  3. Cached open poll left past its deadline → reads closed without refetch.
  4. Composer: restored/redraft sub-5-minute poll → "Polls must stay open at
     least 5 minutes on this server.", no request sent.
  5. Misskey/Sharkey polls → counts always shown (unchanged).
- Expected: all five behave as above.

### 9. Read markers — GET/POST round-trip
- Source: X4.4 (`state/logs/2026-10-25-repair25-x4.4.md`).
- Steps: on the Mastodon rig, read `GET /api/v1/markers?timeline[]=notifications`
  (derivation true/false/unknown) then mark read and re-read.
- Expected: round-trip persists; mark-read hides with a reason on
  marker-less servers (typed `errors.unsupported.markers`).

### 10. Notification requests + policy (4.3+)
- Source: X4.5 (`state/logs/2026-10-25-repair25-x4.5.md`).
- Steps:
  1. Mastodon 4.3+ with filtered notifications: entry shows with pending
     badge; expanding lists request rows with packed accounts; accept merges
     (row gone, badge recounts), dismiss drops it.
  2. Toggle one policy switch, Save → `PATCH /api/v2/notifications/policy`
     carries only defined `filter_*` fields.
  3. Older Mastodon / Akkoma: entry hidden with "not on this server"; every
     filtered item still visible in the main list. Misskey: Misskey reason
     line, no entry.
  4. Second launch on an unsupported origin → no repeat probe (verdict cached
     per origin per launch).
- Expected: all four behave as above.

### 11. Streaming handshake (subprotocol auth)
- Source: X3.4 (`state/logs/2026-10-25-repair25-x3.4.md`); repair §X3.4 step 7.
- Steps: run the `stream-connect` row of `scripts/fedi-smoke.ts` (`pnpm smoke`)
  against the rig; confirm the logged mechanism reads
  `subprotocol … (no token in URL)` (Mastodon) vs `same-origin ?i=` (Misskey).
- Expected: handshake succeeds with `Sec-WebSocket-Protocol` bearer; NO
  token-in-URL fallback exists by design (privacy). Device-side checks are
  `device-checks.md` §20.

### 12. Nested-quote shape (live 4.5+) + Akkoma Link continuation
- Source: X4.4 (`state/logs/2026-10-25-repair25-x4.4.md`).
- Steps: fetch a nested quote on live Mastodon 4.5+ (the fixture is
  synthesised/unverified); page a cross-origin Akkoma list to its `Link`
  continuation.
- Expected: quote resolves through the shipped `resolveQuoteUri` + TTL path;
  Akkoma continuation replays without invented cursors.

---

# Appendix — owner-only items (no agent action possible)

## A. Skipped on purpose: release signing + App Links
- Source: repair.md "Scope decisions" + coverage matrix (security H1).
- iOS/Android release signing was skipped by owner decision; everything
  needing a signing identity is therefore also skipped: App Links /
  Universal Links, `assetlinks.json`, entitlements. Do not touch signing
  config. MiAuth `keystone://` interception on Android is a recorded accepted
  risk (ADR 0012) whose real fix needs App Links — i.e. this decision.

## B. `app.config.js` identifiers (placeholders — owner to confirm)
- Source: X11.1 (`state/logs/2026-10-25-repair25-x11.1.md` §X12.1 entry).
- Current values (`app.config.js:22-29,49`): name `Keystone`, slug
  `keystone`, scheme `keystone`, iOS `bundleIdentifier` / Android `package`
  `app.keystone.dev`. See `TODO(D3, owner)` at `app.config.js:8-9`.
- Owner action: confirm all five before any store/TestFlight build. Blocks
  store builds only; dev builds unaffected. Do not invent identifiers.

## C. Owner decisions D1–D10 — outcomes
- Source: repair.md "Owner decisions" table + `docs/DECISIONS.md` tail.
| ID | Outcome |
|----|---------|
| D1 | ANSWERED by owner: commit both `ios/` + `android/` (X0.4 applied). |
| D2 | Default stands (owner silent): web tokens stay `localStorage`-backed, dev-grade; CSP/header guidance in `docs/web-hosting.md` (X2.3). Web not release-ready without it. |
| D3 | Default recorded (X1.2): removing the active session activates the most-recently-used remaining one; none left → signed-out. |
| D4 | Deferred in-program (X4.4): keep `avatar_static`; animated avatars need model+adapt+pref+UI, over budget. |
| D5 | Default shipped (X2.5): link previews `tap` / `auto-public` / `off`, default `tap`; auto only for public posts with opt-in. |
| D6 | Default shipped (X2.5): `privacyShield` opt-in, default off; Android `FLAG_SECURE` out of scope. |
| D7 | Accepted risk + ADR 0012 (X2.3): MiAuth callback mitigations shipped; real fix needs App Links (§A). |
| D8 | YES, built (X4.5): notification requests/policy behind probe-backed capability. |
| D9 | Default shipped (X7.4): strip-EXIF-by-default + compress-by-default both ON at post time; per-upload Keep-original opt-out (warns, esp. on known GPS); videos never re-encoded. |
| D10 | Pinned per SDK 57 `bundledNativeModules.json` (X3.2): `@react-native-community/netinfo@12.0.1`. |
- D2–D10 were owner-silent: defaults apply unless the owner says otherwise
  (`state/STATE.md` blockers).

## D. `pnpm audit` acceptances (X11.1 — owner to accept or override)
- Source: X11.1 (`state/logs/2026-10-25-repair25-x11.1.md` Step 1; full
  verbatim output there). `pnpm audit` → exit 1, 3 findings, all transitive
  dev-toolchain, no override applied:
- 1. **node-forge GHSA-86w9-cpqp-85rv (high)**, `<=1.4.0`, patched: none —
     reachable only via `@expo/cli` (dev-machine CLI, never bundled);
     unfixable short of an Expo SDK upgrade (ADR 0008 pins SDK 57).
     Documented + accepted.
- 2. **zod GHSA-mrhx-c7xc-m3w5 (high)** — advisory is zod-v4-only code
     (`$ZodArray`); the tree is zod-v3-only (`3.25.76`), so the vulnerable
     code is absent. 3→4 is a breaking migration, out of scope. No action.
- 3. **uuid GHSA-w5hq-g745-h8pq (moderate)** — `7.0.3` via `xcode ←
     @expo/config-plugins` (prebuild tooling only, no first-party import);
     patched `>=11.1.1` is ESM-only, incompatible with the SDK 57 CJS
     toolchain. Documented + accepted.
- Owner action: accept or override; re-audit after the next Expo SDK bump
  (DECISIONS line 2026-10-25 X11.1).

## P6.6 — Drive + Clips live checks (owner; rig refused to agents)

Program branch `p6.6-drive-clips`, slices 1–9 (`docs/p6.6-drive-clips.md` §5
slice 9; logs `state/logs/2026-10-30-p6.6-*.md`). Agent-verified: `pnpm
typecheck` + `pnpm lint` clean, targeted suites green per slice log, full
suite flat at the 90 pre-existing failures (13 suites). Everything below
needs the rig (`:3101` Misskey / `:3102` Sharkey) or a browser and is
`not verified` until the owner runs it. Mark each `[ ]` → `[x]` with
server version + result.

- [ ] L1 Probe verdicts: open Drive on `:3101` and `:3102`; record
  `drive_sort` / `drive_move_bulk` verdicts per origin (plan §5 slice 1
  step 3: `drive/files {limit:1, sort:'-createdAt'}` → 400 = unsupported;
  `drive/files/move-bulk {fileIds: []}` → 404 = unsupported). Sort menu
  hidden on the unsupported server (fixed newest-first); bulk move uses
  `moveMany` where supported, per-file `update` pool elsewhere.
- [ ] L2 Clip limits: account with 200-note clips — Clip screen shows
  `{n} / {noteEachClipsLimit}`; Clips index shows `{own} / {clipLimit}`;
  "New clip" disabled with reason at the limit.
- [ ] L3 B1 regression: rename a clip without touching the description —
  description survives (full-body `update`, slice 1).
- [ ] L4 Nesting: create folders 3 deep, breadcrumb trail `My Uploads › a
  › b › c`, middle collapses via menu on long paths; browser back walks
  the history (`Drive: '/drive/:folderId?'`).
- [ ] L5 Delete flow: delete a non-empty folder — confirm shows file +
  subfolder counts + first-5 names; deletes depth-first; abort path past
  1000 items shows the too-large message instead of a partial delete.
- [ ] L6 Uploads: 20 files incl. one oversize — queue runs 2 at a time,
  oversize refused with reason before upload, per-file progress, cancel +
  retry, usage bar moves, inserted into the current folder's list.
- [ ] L7 DnD (Chrome + Firefox + Safari, web): OS files onto the body →
  current folder; onto a folder tile → that folder ("Upload to {folder}"
  overlay); tile drag onto folder/crumb moves the selection with toast +
  Undo; self-drop shows no drop cursor and does nothing; text/link drag
  ignored. (`not verified` — no agent browser tooling.)
- [ ] L8 Favourites: the Favourites folder in Clips opens the `Favorites`
  route (never a `clips/*` call); star badge + "Saved posts" render;
  Misskey sessions show no separate Favourites sidebar entry; Mastodon
  Bookmarks screen unchanged.
- [ ] L9 Side-by-side: `dvd.chat` vs `localhost:8081` screenshots for Clips
  grid/list, Clip screen, Favourites screen, Drive grid/list, nested
  folder, selection bar, upload queue, DnD overlay (plan §8 item 5).
- [ ] L10 Owner-reported regressions from this program, re-check on device:
  grid no longer overflows the center column; tile menus are corner icons
  (not full-width buttons); breadcrumbs + usage bar visible; titles use
  middle ellipsis; one-clip account loads once, renders one tile, count
  reads `1 / {limit}` (repeat-cursor guard + screen dedupe, slices 7–8).
- [ ] L11 Fixture refresh: `scripts/fedi-capture.ts` per §0 above
  (Misskey + Sharkey + Mastodon), review the diff before tests consume it.
