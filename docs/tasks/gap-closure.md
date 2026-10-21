# GAP-CLOSURE — v1 parity remediation program

Plan ref: cross-cutting; supersedes nothing (`rn-rebuild-plan.md` still
governs phases 5–7). Gap register: `docs/parity-gaps.md`.
Status: W1 done 2026-10-20 (on `main` per owner direction; one workstream per session still applies), W2 done 2026-10-21 (F21 + honest deferrals; log `state/logs/2026-10-21-w2-remainder.md`), W3 done 2026-10-21 (log `state/logs/2026-10-21-w3-composer.md`), W4 done 2026-10-21 (log `state/logs/2026-10-21-w4-social.md`; trio 94 suites / 1142 tests green), W5 done 2026-10-21 (log `state/logs/2026-10-21-w5-screens.md`; trio 106 suites / 1251 tests green), W6 done 2026-10-21 (log `state/logs/2026-10-21-w6-mobile.md`; trio 110 suites / 1270 tests green; Helium signed-in phone/rail/full + Note + composer in `state/logs/assets-w6/`)
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

Status: done 2026-10-21 on `main` (log `state/logs/2026-10-21-w2-remainder.md`; F21 code + F22/MK8/F12/F20-clips/F11-half honest deferrals in DECISIONS; earlier W2 commits cover F1–F20-tabs/MD4/MK17).

- [ ] F1/F2 Mount `Lightbox` from `PostCard`; add video/gifv/audio/file
      branches to `PostMediaGrid` (no new deps beyond `expo-video`).
- [ ] F4 Gate model URLs with `safeHttpUrl` (avatar/media/menu).
- [ ] F5 Map Misskey quotes in `adaptNote` + render in `PostCard`.
- [ ] F6 Make quote cards pressable; pass link/mention/tag handlers in.
- [ ] F7 Strip/render textual `RE:` quotes.
- [ ] F8 Poll UI + voting.
- [ ] F9 Route MFM/HTML mentions to the profile screen.
- [ ] F11 Remote custom emoji fallback + display-name emoji. (W2 2026-10-21: card half done via `DisplayName`; profile/notification rows ride W4; remote-host store fallback deferred — see DECISIONS)
- [ ] F12/F13 Link previews, fold/"Open post", tag bubble (v1 parity). (W2 2026-10-21: server cards + fold done; client unfurl declined — see DECISIONS)
- [ ] F15–F18 filter badges, post badges, boost collapsing, like-key/emoji.
- [ ] F19 Reactor/repost lists + detail tabs.
- [ ] F20 Detail parity (in-clips, live capture, delete-navigate, reply insert). (W2 2026-10-21: tabs + delete-navigate done; clips row deferred to W5; reply-insert via W3 C1/C6)
- [x] F21 dedupe/retry/skeletons/pill (W2 2026-10-21 on `main`: `feedItems` dedupe, `FeedSkeleton`, footer `feed-more-retry`, pill scroll-to-top; live feed for the pill stays S4).
- [ ] F22 moderation filters in feeds — DEFERRED to W4 (see DECISIONS 2026-10-21; needs `me` query + backend lists).
- [ ] MD4 Sanitizer `span.invisible` + list bullets.
- [ ] MK8/MK17 remote emoji store, remote-link resolver. (W2 2026-10-21: MK17 done; MK8 remote-host fallback deferred — see DECISIONS)

Acceptance: media opens/plays on device; quote/poll/mention cases tested;
trio green; screenshots in log.

### W3 — Composer & post actions

Status: done 2026-10-21 on `main` (log `state/logs/2026-10-21-w3-composer.md`; trio 83+ suites green; web-visual at phone/rail/full + compose modal via Helium).

- [x] C1 Clear inline composer after post; restore autosave.
- [x] C2 Mobile close control (Cancel header when `onClose`; full sheet rides W6).
- [x] C3 Keyboard avoidance/listeners (both chromes + card; device run not verified, full pass rides W6).
- [x] C4 Direct-post recipient picker (lookup resolve + verbatim fallback, persisted).
- [x] C5 Quote-refusal recovery (drop quote, repost once, server reason as notice).
- [x] C6 Draft target restore, empty-draft cleanup, attachment policy (recipients persisted; attachments excluded by design; noQuote has no UI).
- [x] C7 Edit-post UI + mutation/cache patch (`Compose?editId`, attachments carried, schedule hidden).
- [x] C8 Schedule UI (quick chips + validation) + scheduled list/cancel.
- [x] C9 Server drafts UI (list/restore/delete/save-current; hidden where unsupported).
- [x] C10 Bookmark toggle end-to-end (optimistic badge; saved-posts screen stays W4).
- [x] MK3–MK5 translation/schedule/server-drafts consumers (MK3/MK4 were wired — verified; MK5 via C9).
- [x] MK6 drafts-duplicate call (app drafts authoritative; unification rides W8 Q6).
- [ ] MK13 like probe — LEFT (needs live vanilla rig; `:3101`/`:3102` down).
- [ ] MK14 Pinetree poll gate — KEPT unconditional per v1 parity (live re-probe blocked: `signin` rejects `ks1`, no `signin-flow`; see DECISIONS).

Acceptance: compose → post leaves a clean composer; drafts survive
reply/quote restore; edit/schedule paths work or are honestly gated;
trio + device evidence.

### W4 — Social, profile, notifications

Status: done 2026-10-21 on `main` (log `state/logs/2026-10-21-w4-social.md`; trio 94 suites / 1142 tests green; Helium signed-in as akk1 @ :4000 in `state/logs/assets-w4/`; authed rig probe `scripts/fedi-w4-probe.ts` green for MD1-fallback/MD2/MD3 + lists CRUD + profile write).

- [x] N20/C12 Notification rows pressable (actor + post), avatars, relative time.
- [x] C11 Grouped counts/reaction sets, grouping toggle, per-type config,
      live counter, notifications in query cache. (Full grouped-reaction breakouts ride the MD1 adapter remainder — see DECISIONS.)
- [x] N18 Unread badge / live count. (Stream status rides S4 — see DECISIONS.)
- [x] N11 Follow-requests queue.
- [x] C13 Profile editor (per-family fields).
- [x] C14 Profile fields + account reactions block.
- [x] C15/MD15 Lists CRUD + index/feed.
- [x] C16 Post-menu rows (mute-boosts wiring, relation labels, report/clip).
- [x] C18/MK2 Renote-mute two-way + `Backend.renoteMutes`.
- [x] MD1–MD3 Notification filters/paging, bookmarks paging, filters fallback.
- [x] MK1 Apply word/server mutes to every feed.
- [x] F22 Moderation filters in feeds (server soft words excluded per DECISIONS).
- [x] F11-half `DisplayName` in `ProfileHeader` + notification rows.

Acceptance: notification → post/actor navigation works (verified live); bookmark/favourite
visible and listable (MD2 live round-trip; saved-posts screen stays W5/N10); follow requests handled (honest empty live); trio + device.

### W5 — Screens & routing

Status: done 2026-10-21 on `main` (log `state/logs/2026-10-21-w5-screens.md`; trio 106 suites / 1251 tests green; Helium signed-in phone/rail/full in `state/logs/assets-w5/`; authed Akkoma probe `scripts/fedi-w5-probe.ts` green).

- [x] N4 Explore + subroutes/search/autocomplete (`explore|posts` descriptor through shared `FeedView`).
- [x] N5 Tag screen.
- [x] N6/N7/N8/N9/N10 Lists (W4, confirm-only re-run green), clips (+ menu add-to-clip flow), antennas, drive, favorites screens.
- [x] N12 Followers/following screens + linked counters.
- [x] N3 Settings section routes + correct back/deep-link behavior.
- [x] N13 Base-path/hosting routing.
- [x] N14 Scroll restoration (offset memory in `FeedView`), last-feed fallback, shared back.
- [x] N15 Back affordance on rail/full (`Pagehead`).
- [x] N16/N17 Account menu entry points + title copy (Search/Note/Follows).
- [x] N22 App icon/splash/favicon + assets (system-UI rides W6/P11 — see DECISIONS).
- [x] F19 Reactor/repost lists + detail tabs (already composed — verified, register corrected, no new code).
- [x] F20 In-clips row (`InClipsRow` via `clips.containing`; live capture still rides S4).

Acceptance: every route in the new table resolves; deep links and back
behave; no placeholder screens in primary navigation; trio + web/device.

### W6 — Mobile platform

Status: done 2026-10-21 on `main` (log `state/logs/2026-10-21-w6-mobile.md`; trio 110 suites / 1270 tests green; Helium signed-in phone/rail/full + Note + composer sheet in `state/logs/assets-w6/`; Oppo/iOS/device-keyboard not verified; native splash rides a dev-client rebuild).

- [x] N21 Safe-area provider + insets on strip/tab bar/FAB/lightbox/composer (zero `initialMetrics` for bare trees).
- [x] C2/C3 composer sheet + keyboard (grabber, listeners, maxHeight cap, sheet scroll; shared with W3).
- [x] P9 Reduced-motion handling (setting hook; popup/dialog/lightbox skip entrance).
- [x] P10 Touch-target/a11y pass (Button/PopupRow minHeight 44; hitSlop on rows/tabs).
- [x] P11 Status-bar/system-UI control (single owner `state/systemUI.ts`; splash plugin deferred to rebuild).
- [x] F24 Fix nested `VirtualizedList` on detail (single FlatList, MAX_DEPTH kept).

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
