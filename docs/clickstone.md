The audit says the daily social loop is real and the architecture is sound. What is missing is a second product: correctness bugs that can lose data, then the surfaces that still do not exist (DMs, channels, admin, deck). Live-verification debt is not a workstream. Treat external Mastodon and Sharkey testing as already done.

Do not start from `docs/parity-gaps.md` or `state/STATE.md`. Both still describe a closed V2 program and list shipped media, polls, and badges as missing. Source of truth for this program is `docs/2026-10-22-full-audit-mastodon-misskey-v1-parity/`. Trust code over the register.

## How agents should work

One slice, one branch `p6.<n>-<topic>`, merge only after `pnpm typecheck && pnpm lint && pnpm test`. Follow `AGENTS.md`: UI sees only `packages/fedi` models; every new action gets a `Capabilities` flag or an honest disabled-with-reason; no fake data; no inert controls. Record load-bearing choices as ADRs. Touch only the files the slice lists.

Explicit non-goals, even for admin: queue-job mutation, `delete-account`, `delete-all-files`, `reset-db`. Link those to the web console. Also out: Pages, Play/Flash, gallery, games, full `j/k` keyboard map, TMF.

---

## Wave 0 — correctness (do this before features)

These are the bugs you named, plus the audit's matching evidence. They are small, user-visible, and some are destructive. Land them before any admin or DM work so new screens are not built on the bad shapes.

### 0.1 Mastodon streaming safety
Branch: `p6.0-masto-stream`

Files: `packages/fedi/src/mastodon/stream.ts`, `instance.ts` (`normalizeStreamingOrigin`), contract `docs/mastoapi-contract.md` §8.

- Put the token in `Sec-WebSocket-Protocol`, not `?access_token=`.
- Handle ping/pong. Akkoma pings are currently dropped (`stream.ts` ~230–244).
- Handle `kill` and `filters_changed` (invalidate the filter query; do not ignore the frame).
- Stop reconnecting forever: 10s connected-ack timeout, stop after 5 fast closes, surface a dead state in `StreamBadge`.
- Refuse a streaming origin whose scheme does not match the session origin (no `ws` token to a different host).

Acceptance: unit tests for header-not-query, ping reply, kill closes without retry, breaker trips, cross-scheme refusal. `subscribePost` may keep riding the shared `user` socket; do not add a per-post socket in this slice.

### 0.2 Search is not one page
Branch: `p6.0-search-paging`

`packages/fedi/src/mastodon/backend.ts` (~715–743) and `endpoints.ts` `searchV2` return `{cursor: null, end: true}` and ignore `Link`. Wire the existing pagination helper. Misskey search already pages both ways; do not touch it except to add a regression if a test assumed Mastodon end-on-page-1.

### 0.3 Filter edit must not destroy keywords
Branch: `p6.0-filter-edit`

`backend.ts` ~244–261 and ~950–998: v2 filter adapt keeps the first keyword, and edit renames and drops the rest. Read the full keyword list, edit in place, write every keyword back. Add a test with two keywords that fails on the current code.

### 0.4 Translation gate uses the right flag
Branch: `p6.0-translate-gate`

Mastodon must use `configuration.translation.enabled` (`instance.ts` ~143–152, `detect.ts` ~407–419). Misskey keeps `translatorAvailable`. A menu row that checks the Misskey flag on a Mastodon session is a bug. One test per family.

### 0.5 OAuth scopes match features that exist
Branch: `p6.0-oauth-scopes` — ADR required.

`MASTO_SCOPES` always requests ~20 granular scopes plus umbrellas, including scopes for unbuilt features, and `scopeHealth` diffs against that over-broad set. Split into `SCOPES_NOW` and `SCOPES_LATER`. Request only `SCOPES_NOW`. When a later slice ships DMs, push, or admin, it adds its scope and the existing upgrade prompt. Do not revoke working sessions in this slice.

### 0.6 Misskey import/export shapes
Branch: `p6.0-import-export`

`packages/fedi/src/misskey/importExport.ts`.

- Import: upload the file to Drive, then call `i/import-*` with `{fileId}`. `{file: rawText}` fails upstream validation.
- Export: `i/export-notes` only enqueues (1/day, result arrives as `exportCompleted`). Do not await a payload. Surface the rate-limit and point at the notification.

UI can stay a stub until Wave 2. This slice fixes the fedi functions and their tests so the UI slice cannot call the wrong shape.

### 0.7 Drive `folderId`, edit fields, like probe, draft cursors
Branch: `p6.0-misskey-mutations` (one branch; four bugs, same modules).

| Bug | Fix |
|---|---|
| Uploads always root | `client.ts` upload sends `folderId` (and `force` only if the caller sets it). Composer and Drive both pass it. |
| `notes/edit` drops `noQuote` and cannot touch polls | Extend `noteEdit.ts` params to match create for `noQuote` and poll. If the server rejects poll edits, surface that error; do not silently drop. |
| `notes/like` seeded false | `backend.ts` ~220 must not `seedLikeSupport(origin, false)` for stock Misskey. Probe once per origin (`like.ts`). Cache the result. Fallback to ❤ only after a real 404. |
| Scheduled and draft lists `untilId` only | `schedule.ts`, `serverDrafts.ts`: accept `sinceId` the same way other timelines do (`adapt.ts` cursor). Pull-to-refresh must be able to see newer rows. |

### 0.8 Misskey scope upgrade
Branch: `p6.0-misskey-scope-upgrade`

`src/state/session/store.ts` ~447–457 short-circuits Misskey to `misskey-no-scopes`. A 403 `PERMISSION_DENIED` (`client.ts` ~288–296) should set the same global re-auth prompt Mastodon already has, not only the local handler in `Clips.tsx`. Do not invent a scope list the server never returned; the prompt is "this token predates a permission Keystone now uses."

### 0.9 Messaging is gated, not invisible
Branch: `p6.0-messaging-gate` — small, ships before any chat implementation.

Add `messaging: unsupported` (or `capabilities.directMessages`) with a reason string. The post-menu DM row (`menuModel.ts` `LATER`) and any messages entry show disabled-with-reason, not a silent absence. Mastodon conversations and Misskey chat stay unimplemented. This slice only makes the absence detectable.

Wave 0 acceptance for the whole wave: the seven risks and six real bugs in your note each have a failing-then-passing test. No new screens.

---

## Wave 1 — daily-driver gaps (parallelizable)

Start only after Wave 0 is on `main`. These are the audit's highest value-per-effort items that are not "go verify the rig."

### 1.1 Profile "All" tab (v1 parity, P1)
`ProfileTabs.tsx` is Featured/Posts/Replies/Media. v1 is Featured/Posts/All/Media, where All is replies and renotes. Add `all` as a tab, keep Replies. Do not remove Featured.

### 1.2 Per-note `noQuote` and attach-time sensitivity
v1 composer sends `noQuote`. v2 has account-wide `rejectQuotes` and create-side `noQuote` in the wire, but no composer control, and edit used to drop it (fixed in 0.7). Add the toggle. Same slice: per-file sensitive toggle at attach time (`ComposerSections.tsx` has no `sensitive` handling). Viewing sensitive media is one grid gate (`PostMediaGrid.tsx` ~289–302); v1 gated per item. Fix the reveal to be per tile.

### 1.3 Soft-mute badge
`badges.ts` covers pinned, bookmarked, edited, filtered, reactions. Add soft-mute. The feed already filters hard words; the badge is for notes that remain visible.

### 1.4 Mastodon: domain blocks, tag follow/mute, featured tags
Zero `domain_blocks`, `follow_tag`, `followed_tags`, `featured_tags` calls. Data layer first, then Settings → Mutes and the Tag screen button. Personal domain blocks, not admin domain blocks. Akkoma: if the endpoint 404s, disable with reason. Do not hide the row.

### 1.5 Reports that a moderator can use
Mastodon `POST /api/v1/reports` currently sends `account_id` + `comment` only. Add `status_ids`, `category`, `rule_ids`, `forward` when the server supports them. UI: a short chooser (category, optional rules, forward), not a single comment dialog. Misskey `users/report-abuse` stays the user-side report; the admin queue is Wave 3. Also request `write:reports` — it was deliberately omitted, so granular tokens toast-fail.

### 1.6 Mastodon lists and polls: send the fields the UI already implies
List create/update sends `title` only. Add `replies_policy` and `exclusive` behind capability checks. Poll create sends `{options, expires_in, multiple}` only. Add `hide_totals`. Composer language is a separate small slice if this one grows.

### 1.7 Edit history, delete-and-redraft, media description update
`GET /statuses/:id/history` (or the family's equivalent) plus a screen from the edited badge. Mastodon delete-and-redraft: delete, then open composer with the payload (Misskey already has a 404→redraft path in `noteEdit.ts`). `PUT /api/v1/media/:id` for description and focus so alt text is not "locked after upload" on Mastodon. Misskey caption edit is `drive/files/update` `comment`, which the Drive screen partly has; wire it from the composer too (composer currently passes `alt: ''`).

### 1.8 Avatar and banner upload
`ProfileEditor` disables both with `errors.unsupported.avatar`. Mastodon: account update multipart. Misskey: `i/update` with Drive file ids, which depends on 0.7 `folderId` being optional (root is fine here). Honest disable only when the family has no endpoint.

### 1.9 Channels UI (Misskey)
Highest leverage Misskey slice. `ChannelsApi` is declared in `core/backend.ts` and never implemented. `FeedDescriptor` already has `channel`. Implement list/show/timeline/follow, a route, and a screen. Create/edit and channel mute are a follow-up, not this slice. Also implement the channel stream (0.1-style: this is Misskey `stream.ts`, which already has ack-timeout and backoff; do not copy the Mastodon URL-token bug).

### 1.10 Drive as a library
After 0.7: upload from the Drive screen (not only composer), folder targeting in the UI, file detail (`drive/files/show`, `attached-notes`). Skip `upload-from-url`, hash find, and bulk move.

### 1.11 Notification types and Mastodon dismiss
Map the 10 Misskey types currently dumped into `unknown`, at least `scheduledNotePosted`, `scheduledNoteFailed`, `exportCompleted`, `roleAssigned`. `chatRoomInvitationReceived` stays unknown until chat exists, but the label should say "chat invitation" rather than "unknown". Mastodon: `POST /notifications/:id/dismiss` and `/clear` if the server has them. Push (APNs/FCM) is its own slice in Wave 4; do not pretend in-app badges are push.

### 1.12 Announcements read
`AnnouncementsApi` is declared and has no producer. Implement Misskey `announcements` (public, low cost) and Mastodon `GET /api/v1/announcements`. One screen, dismiss where the API allows. Admin create/edit is Wave 3.

### 1.13 OAuth callback under a base path
v1 used `/keystone/callback` at root and `/auth/callback` under a base. v2 hardcodes `/auth/callback` (`src/routes.ts` ~128). Accept both. ADR if the registered redirect URI changes.

---

## Wave 2 — DMs and import/export (product surfaces)

### 2.1 Mastodon conversations
`/timelines/direct` is absent on Akkoma (`docs/mastoapi-contract.md`). Prefer `/api/v1/conversations` where it exists; on Akkoma, a direct-visibility search or an honest "this server has no DM inbox" gate. Do not invent a timeline. Composer already sends direct + recipients. Needs the DM scope added to `SCOPES_LATER` → `SCOPES_NOW` and a re-auth prompt.

### 2.2 Misskey chat
Larger than 2.1. History, rooms, and the messaging stream. Until it lands, 0.9's gate stays. Do not start 2.2 in the same session as 2.1.

### 2.3 Import/export UI
Depends on 0.6. Needs a document-picker decision (ADR: which Expo module). Twelve disabled rows in `TransferSections.tsx` become real, one family at a time: following, mutes, blocking, bookmarks, notes. Export completion is the `exportCompleted` notification from 1.11, not a spinner waiting on the POST.

---

## Wave 3 — admin (greenfield, read-only first)

There is no admin code. Do not stub buttons. Pattern for both families:

1. Capability flags `adminRead` / `adminWrite`, from `is_admin` / `is_moderator` (Mastodon) or `i` role flags (Misskey). Today those flags are unread (`wire.ts` Pleroma extras only).
2. Scopes added only when this wave starts (`admin:read` / `admin:write`, Misskey admin permissions). Old tokens get the 0.5/0.8 upgrade prompt.
3. 403 on an admin call disables the section with a reason. Never clear the session.
4. Confirm step on every mutation. Show moderation-log entries where the API has them.

### 3.1 Read-only server insight (both families, separate branches)
Misskey: `admin/server-info`, `admin/meta`, `admin/queue/stats`, online users. Mastodon: measures/dimensions if the token allows, else instance rules/peers/extended description (those are missing even for non-admins and can ship in a non-admin slice first). One screen, no mutations. This proves the credential path.

### 3.2 Reports queue
Misskey: `admin/abuse-user-reports` plus resolve/update/forward. Mastodon: `GET/POST api/v1/admin/reports` and notes. This is the daily moderation surface. User-side report from 1.5 should already be sending the ids this queue displays.

### 3.3 User moderation
Misskey: `show-users`, suspend/unsuspend, user note, modlog, reset-password. Mastodon: `account_actions` warn/suspend/silence, moderation notes. No delete-account.

### 3.4 Federation and emoji (read, then write)
Read: federated instances, relays list, emoji list with license. Write, later and confirmed: silence/block instance, emoji add/update/delete/copy. Sensitive-word lists with the instance block UI, not as a hidden setting.

### 3.5 Announcements, invites, roles — after 3.2
Announcements CRUD (read already exists from 1.12). Invites. Roles list/assign; policy editor is a later slice, it is large.

Stay out of this wave: email blocks, IP blocks, retention, ads, captcha, webhooks, queue job buttons.

---

## Wave 4 — the other product (deck, theme, push)

Not required for "closer to completion" of the client, but the audit is right that power users will notice.

- Deck: `src/features/deck/` does not exist. Model is `FeedDescriptor`. Add `notifications` and `divider` kinds before any column picker. Persist `{descriptor, sessionId, options}` per the plan. First five widgets only (plan §5.7): clock, memo, trends, notifications, timeline. Do not port Misskey's ~30 widgets.
- Theme: one grey pair today. Port v1 `keystone-terminal` (gold, square, solarized) as a second theme, or record an ADR that terminal is dropped. OLED is a dark variant (`#000`), not a new palette. Density is a compact/comfortable switch; text-size already exists and is not density.
- Push: `expo-notifications`, per-origin subscription, Mastodon push API and Misskey SW equivalent. Badge stays in-app until this lands. ADR for credentials and what happens on account remove.
- Composer MFM toolbar (bold, italic, code, spoiler) and a sensitive-media default. Explore rows: avatars and follow on trending users. News rows are title-only today.
- i18n: management screens and new strings are English-only in `fr` and the other catalogs. A sweep slice after features, not before. Fedi gate reasons stay English by design.

---

## Suggested session order

| Order | Slice | Why this slot |
|---|---|---|
| 1 | 0.1 stream, 0.3 filters, 0.4 translate gate | Independent, destructive or credential-leaking |
| 2 | 0.6 import shape, 0.7 mutations, 0.2 search paging | Data-loss and silent truncation |
| 3 | 0.5 scopes, 0.8 Misskey re-auth, 0.9 messaging gate | Session behavior; ADR on scopes |
| 4 | 1.4 domain/tag, 1.5 reports, 1.2 noQuote + sensitive | Daily moderation and v1 parity |
| 5 | 1.9 channels, 1.10 drive library, 1.7 history/alt | Misskey product holes |
| 6 | 1.6 list/poll fields, 1.8 avatar, 1.11–1.13 | Smaller closures |
| 7 | 2.1 DMs, then 2.3 import UI, then 2.2 chat | New product areas, one at a time |
| 8 | 3.1 admin read, 3.2 reports queue, 3.3 users | Admin only after scopes and reports are honest |
| 9 | Deck, theme, push | After the client is a full reader, not before |

Two agents can run in parallel only if they do not share a file. Safe pairs: Mastodon `stream.ts` with Misskey `importExport.ts`; channels UI with Mastodon domain blocks. Unsafe: anything touching `detect.ts`, `store.ts` scopes, or `menuModel.ts` at the same time.

## Doc hygiene (one short slice, any time)

Correct `docs/parity-gaps.md` rows the audit proved stale (F1, F2, F8, F13, F15–F18, S2 → done) and point `state/STATE.md` at this program instead of "E6/E7 blocked on a rig." Otherwise the next session will re-open closed work and skip Wave 0.

I am in plan mode, so this is the guide only. Switch to build mode when you want Wave 0 started; I would begin with streaming, filter edit, and the translation gate.
