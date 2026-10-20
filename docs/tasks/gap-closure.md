# GAP-CLOSURE — v1 parity remediation program

Plan ref: cross-cutting; supersedes nothing (`rn-rebuild-plan.md` still
governs phases 5–7). Gap register: `docs/parity-gaps.md`.
Status: W1 done 2026-10-20 (on `main` per owner direction; one workstream per session still applies)
Branch: `main` (W1 landed directly; `p6.0-w1-foundations` left at the pre-W1 consolidation point)

## Goal

Close the v1 parity gaps that the phase plan does not own, in a verified
order, without regressing the existing read/write paths.

## Read first

- `docs/parity-gaps.md` (the register; row IDs below refer to it)
- `AGENTS.md` (§2 state protocol, §5 work rules, §6 architecture rules)
- `rn-rebuild-plan.md` §2/§5, `state/STATE.md`, `docs/DECISIONS.md`
- Latest 1–3 files in `state/logs/`
- v1 reference: `~/Local Documents/Keystone/frontend/src` (and
  `mobile/`, `docs/` for product intent only)

## Rules for this program

- One workstream per branch/session. Do not mix W1 and W3 in one branch.
- Fix `bug` rows before `unwired`, then `partial`/`missing`.
- Never mark a register row done without the verification in
  `docs/parity-gaps.md` §11.
- Do not "fix" a `deferred` row (§9) without a new DECISIONS entry first.
- Prefer wiring what already exists over new abstractions. Several rows
  are one import + one prop away.
- Keep `packages/fedi` pure TS; no wire types in `src/`; every action
  stays behind a capability flag.
- Update `docs/parity-gaps.md`, this file, `state/STATE.md` and a new
  session log at the end of every session.

## Workstreams

### W1 — Foundations (start here)

Goal: one route table, capability truth, no dead seams.
Status: done 2026-10-20 on `main` (log `state/logs/2026-10-20-w1-foundations.md`; trio 77 suites / 961 tests green).

- [x] S1 Pass detected instance features/evidence into
      `backendForSession`/`buildCapabilities`; persist on `Session` or a
      per-session feature store. Keep conservative defaults when absent.
- [x] S1 Re-check every capability consumer with real evidence
      (`quote_posting`, `status_editing`, `translation`, `bookmarks`,
      `scheduled_posts`, `server_drafts`, `lists`, `polls_multi`).
- [x] S3 Derive `linking.config` from `src/routes.ts` (or add a route
      table test that fails on drift); fix `federated` vs `global`.
- [x] N1 Add legacy redirects `/local`, `/social`, `/global`, `/search`.
- [x] N2 Make Network tabs URL-backed and canonical `/network/federated`.
- [x] MD15 Extend `Backend` with the missing members (`channels`,
      `drive.folders`, `lists.create/update/delete`, `renoteMutes`) before
      any screen depends on them.
- [x] MK15 Probe real Misskey/Sharkey capability facts and correct the
      flavor table; record the evidence source.

Acceptance: one route table; capability gates reflect a live/probed
server; `nav.test` covers redirects + `/network/federated`; trio green.

### W2 — Content & media

- [ ] F1/F2 Mount `Lightbox` from `PostCard`; add video/gifv/audio/file
      branches to `PostMediaGrid` (no new deps beyond `expo-video`).
- [ ] F4 Gate model URLs with `safeHttpUrl` (avatar/media/menu).
- [ ] F5 Map Misskey quotes in `adaptNote` + render in `PostCard`.
- [ ] F6 Make quote cards pressable; pass link/mention/tag handlers in.
- [ ] F7 Strip/render textual `RE:` quotes.
- [ ] F8 Poll UI + voting.
- [ ] F9 Route MFM/HTML mentions to the profile screen.
- [ ] F11 Remote custom emoji fallback + display-name emoji.
- [ ] F12/F13 Link previews, fold/"Open post", tag bubble (v1 parity).
- [ ] F15–F18 filter badges, post badges, boost collapsing, like-key/emoji.
- [ ] F19 Reactor/repost lists + detail tabs.
- [ ] F20 Detail parity (in-clips, live capture, delete-navigate, reply insert).
- [ ] F21/F22 dedupe/retry/skeletons/pill, moderation filters in feeds.
- [ ] MD4 Sanitizer `span.invisible` + list bullets.
- [ ] MK8/MK17 remote emoji store, remote-link resolver.

Acceptance: media opens/plays on device; quote/poll/mention cases tested;
trio green; screenshots in log.

### W3 — Composer & post actions

- [ ] C1 Clear inline composer after post; restore autosave.
- [ ] C2 Mobile close control (strip or in-card) and reachable backdrop.
- [ ] C3 Keyboard avoidance/listeners.
- [ ] C4 Direct-post recipient picker.
- [ ] C5 Quote-refusal recovery.
- [ ] C6 Draft target restore, empty-draft cleanup, attachment policy.
- [ ] C7 Edit-post UI + mutation/cache patch.
- [ ] C8 Schedule UI (date picker) + scheduled list/cancel.
- [ ] C9 Server drafts UI.
- [ ] C10 Un-gate bookmarks/favourites once MK2 is fixed.
- [ ] MK3–MK6 translation/schedule/server-drafts/drafts consumers.
- [ ] MK13/MK14 like probe + Pinetree poll gate.

Acceptance: compose → post leaves a clean composer; drafts survive
reply/quote restore; edit/schedule paths work or are honestly gated;
trio + device evidence.

### W4 — Social, profile, notifications

- [ ] N20/C12 Notification rows pressable (actor + post), avatars, relative time.
- [ ] C11 Grouped counts/reaction sets, grouping toggle, per-type config,
      live counter, notifications in query cache.
- [ ] N18 Unread badge / stream status.
- [ ] N11 Follow-requests queue.
- [ ] C13 Profile editor (per-family fields).
- [ ] C14 Profile fields + account reactions block.
- [ ] C15/MD15 Lists CRUD + index/feed.
- [ ] C16 Post-menu rows (mute-boosts wiring, relation labels, report/clip).
- [ ] C18/MK2 Renote-mute two-way + `Backend.renoteMutes`.
- [ ] MD1–MD3 Notification filters/paging, bookmarks paging, filters fallback.
- [ ] MK1 Apply word/server mutes to every feed.

Acceptance: notification → post/actor navigation works; bookmark/favourite
visible and listable; follow requests handled; trio + device.

### W5 — Screens & routing

- [ ] N4 Explore + subroutes/search/autocomplete.
- [ ] N5 Tag screen.
- [ ] N6/N7/N8/N9 Lists, clips, antennas, drive screens.
- [ ] N10 Favorites/bookmarks screen.
- [ ] N12 Followers/following screens + linked counters.
- [ ] N3 Settings section routes + correct back/deep-link behavior.
- [ ] N13 Base-path/hosting routing.
- [ ] N14/N15 Scroll restoration, last-feed back fallback, shared back.
- [ ] N16/N17 Account menu entry points + title copy.
- [ ] N22 App icon/splash/favicon + system UI.

Acceptance: every route in the new table resolves; deep links and back
behave; no placeholder screens in primary navigation; trio + web/device.

### W6 — Mobile platform

- [ ] N21 Safe-area provider + insets on strip/tab bar/FAB/lightbox/composer.
- [ ] C2/C3 composer close + keyboard (shared with W3).
- [ ] P9 Reduced-motion handling.
- [ ] P10 Touch-target/a11y pass (44–48 dp).
- [ ] P11 Status-bar/system-UI control.
- [ ] F24 Fix nested `VirtualizedList` on detail.

Acceptance: no content under notches/gesture bars; composer usable with
keyboard; TalkBack pass notes in log; 360 dp device screenshots.

### W7 — Settings, appearance, i18n

- [ ] P1 Text scaling for prose (posts, bios, composer, quotes) via one alf source.
- [ ] P2 Reactive feed prefs.
- [ ] P3 Theme/palette/user-font/content-mode (with schema migration).
- [ ] P4 Import/export/emoji backup (document picker/file sharing deps).
- [ ] C17 Mute/block search relation undo.
- [ ] P5 LocaleProvider + `setLocale` + message-macro pass + catalogs +
      locale-aware numbers/dates + error-code localization.
- [ ] P6 Account identity details.
- [ ] P7/P8 Hover cards + web keyboard support.
- [ ] Q9 Carry `mobile.md`, `mobile_2.md`, `clients.md`, `my_network.md`
      into v2 `docs/` (or record why not).

Acceptance: text-size row changes post text; locale switch changes UI;
Settings rows are either real or honestly disabled; trio + screenshots.

### W8 — Data correctness & docs

- [ ] MD5 Boot re-verify + token refresh (or honest re-auth prompt).
- [ ] MD6–MD9 updateProfile fields, follow-request paging, lookup fallback,
      scheduled preview.
- [ ] MD10 Streaming host/socket semantics; wire the app consumer (S4).
- [ ] MD11 GoToSocial/glitch/Hometown detection (or documented collapse).
- [ ] MD12/MD13 unify error taxonomy + classifiers.
- [ ] MK7 Legacy migration at boot.
- [ ] MK10–MK12 Pinetree fixtures/manifest, smoke auth/write coverage,
      missing module tests.
- [ ] F21 Feed dedupe/retry polish.
- [ ] Q1–Q8 Status/index/DECISIONS cleanup, stale copy, duplicate feed,
      route/back tests.

Acceptance: no false "done" in the index; streaming observed live (or
`not verified`); token failure re-auths; trio + rig evidence.

## Acceptance (program)

- [ ] Every `bug` and `P0` row in `docs/parity-gaps.md` is `done` or
      explicitly re-deferred with a DECISIONS line.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green at the end of each
      workstream, pasted in its log.
- [ ] Device + web checks recorded for UI workstreams.
- [ ] Register, task index, STATE and logs current.

## Out of scope

- Phase 5 deck/widgets and phase 7 shipping work except where a gap row
  explicitly names them.
- New features v1 never had.
- Rewriting `packages/fedi` architecture; this program wires and fixes,
  it does not re-port.
- Any `deferred` row without a new decision.

## Log

- `state/logs/2026-10-20-gap-audit.md` (audit + register creation)
