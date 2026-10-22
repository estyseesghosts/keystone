# Keystone v2 Complete Audit — 2026-10-22
## v1 parity + Mastodon replacement + Misskey replacement (user / admin / visual / backend, broad + niche)

Method: 6 parallel source-verified subagent audits. No live device/rig runs (Misskey :3101 / Sharkey :3102 down; iOS + Oppo `3B15A500TQD00000` never attempted). All claims cite repo paths. Trust code over `docs/parity-gaps.md` — several of its rows (F1/F2/F8/F13/F15–F18, S2) are stale vs. shipped code.

References:
- v1: `/Users/terezi/Local Documents/Keystone/frontend/src`
- v2: `/Users/terezi/Local Documents/keystonev2` (`src/`, `packages/fedi/src/`)
- Mastodon: `/Users/terezi/Local Documents/fedifedifedi/mastodon`
- Misskey: `/Users/terezi/Local Documents/misskey/packages/frontend` + `packages/backend/src`
- Sharkey/Catodon: `fedifedifedi/Sharkey`, `fedifedifedi/catodon`

---

## 0. Executive verdict + coverage

| Question | Coverage | Verdict |
|---|---|---|
| v1 → v2 rewrite (all layers) | ~88–90% overall (backend ~95%, user ~90%, admin-client ~90%, visual ~80%) | At daily-driver parity with v1; exceeds v1 in lists CRUD, token vault, scope health, data-saver, quote policy. Remains: deferred placeholders, planned Phase-5 deck/widgets, live-verification debt, ~8 niche deltas |
| Mastodon replacement — user-facing | ~80% wired UI, ~90%+ data layer | Viable daily driver for core use; not full replacement |
| Mastodon replacement — admin/backend/power | admin ~0%, backend ~65–70%, niche ~35% | User backend solid + honestly gated; admin is greenfield, not a patch |
| Misskey replacement — user-facing | ~68% (~48/70 items) | Strong core social loop; whole product areas absent (channels UI, gallery/pages/Play/chat, deck/widgets) |
| Misskey replacement — admin/backend/power | admin 0%, non-admin backend ~65% everyday / ~35% full, niche ~55% | Good transport discipline; failures are omission/wrong-shape, not architecture |
| Visual/UI cross-cutting polish | ~55–60% | Strong single-column reader/composer; no deck/widgets, one theme pair, no push, ~half settings placeholder |

Biggest cross-cutting risks: (1) no live Misskey-family proof anywhere (rig down), (2) no device proof (iOS/Oppo/TalkBack), (3) stale gap register will misdirect future sessions, (4) no DM/chat surface on either family, (5) no admin on either family.

---

## 1. v1 → v2: is anything from v1 missing?

Verdict: no P0 code gaps. Details in subagent `ses_e9e544358ffesADg4P6Y2a83Vj`.

### 1.1 Verified complete (worth stating — register says otherwise)
- Data layer map v1 → `packages/fedi/src` all present: `core/{sessions,hosting,backend,config,boot,quoteUri,http,detect,models}` + `graph,feedDescriptor,content/{ast,fromMfm,fromHtml},errors`; `misskey/*` + `mastodon/*` + `api/*` per file-map in subagent report. v1 `drafts/reactionActions/myReactions` deliberately deleted, zero `src/` importers.
- All 40 v1 routes + legacy redirects + 9 settings subroutes + Explore 4 tabs + follow-requests/followers/tag/favorites/drive/antennas/clips/lists map 1:1 (`v2 src/routes.ts:106–131` vs v1 `routes.ts:33–80`).
- Composer: visibility both families (`packages/fedi/src/api/composer.ts:97–106`), recipients (C4), localOnly, reactionAcceptance, CW, polls, schedule + scheduled list + server drafts + edit mode + quote-refusal recovery.
- Post: `PostCard.tsx` mounts Lightbox (907–915), `PostPoll` + live `votePoll` (916–922), `LinkCard`/unfurled (923–928), CW gate (610/780–788), fold (601–602), boost header (`boostLabel` 105–109, 714–715), badges (`badges.ts:18–35`, 606/718–722), heart hidden in `ReactionChips.tsx:121–123`.
- Notification presets all 6 incl. polls (`core/backend.ts:245–251`), include/exclude wiring, grouped/flat, receive config, mark-read. Feed prefs = v1's exact two toggles (`FeedsSection.tsx:52–63` vs v1 `feedPrefs.ts:14–22`). Emoji style picker real (4/5 sets). Keyboard P8 covers v1's only shortcuts (Escape/arrows in popups — v1 has no global map).

### 1.2 Real niche deltas
| # | Gap | v1 | v2 | Sev |
|---|---|---|---|---|
| A1 | Profile tabs: v1 Featured/**Posts**/**All**/Media (`ProfileNotesList.tsx:44–55`); v2 Featured/Posts/**Replies**/Media (`ProfileTabs.tsx:29`) — replies+renotes view unrepresentable | `Keystone/.../ProfileNotesList.tsx` | `keystonev2/src/components/Profile/ProfileTabs.tsx:29` | P1 |
| A2 | Composer per-note `noQuote` missing (v1 `Composer.tsx:277,369`; v2 has `localOnly`, `reactionAcceptance`, account-wide `rejectQuotes` but zero `noQuote` hits) — conflicts with §9 deferral | v1 Composer | `src/components/Composer/Composer.tsx` | P2 |
| A3 | Sensitive = one grid gate (`media.some(m=>m.isSensitive)`), v1 per-item (`NoteBody.tsx:98–105`) | v1 NoteBody | `src/components/Post/PostMediaGrid.tsx:289–302` | P2 |
| A4 | No soft-mute badge (`badgesFor` covers pinned/bookmarked/edited/filtered/reactions, not soft-mute) | register F16 | `src/components/Post/badges.ts:18–35` | P2 |
| A5 | OAuth callback path: v1 `/keystone/callback` at root vs `/auth/callback` under base (`routes.ts:124–139`); v2 hardcodes `/auth/callback` (`routes.ts:128`) | v1 routes | `src/routes.ts:128` | P2 |
| A6 | Composer attach-time per-file sensitivity toggle absent (`ComposerSections.tsx` zero `sensitive` hits; v1 parity unconfirmed) | — | `ComposerSections.tsx` | P2 |
| A7 | Mastodon domain-block UI parity unconfirmed both sides | — | `MutesSection.tsx:39–47,89` | P2 |

### 1.3 Live/device verification debt (code exists, proof missing)
- **E6 translation:** chain complete (detect → capability → menu + auto-translate), refusal proven live, zero success proofs (no rig host exposes a service).
- **E7 drive:** folder CRUD + rename landed; file list/rename/sensitivity/delete + `uploadMedia → drive/files/create` live-unverified.
- **Misskey-family facts:** clips/antennas/renote-mute/scheduling/word-mute/`polls_multi`/bookmarks unit-tested only.
- **Device:** E1–E5 Helium-web only; Oppo + iOS + TalkBack never run; management-screen i18n tail English-only (W7: 8 catalogs + 527 macros + 52 error codes done, screens remain).

### 1.4 Deferred / planned (owner-decided, not regressions)
Deck + widgets + right rail (`Navigation.tsx:748–755` placeholder — note: **v1 has no deck**, register §12 caveat, so new scope); themes/palettes/font placeholders (`DisplaySection.tsx:243–261`; v1 ships `keystone-modern` + `keystone-terminal`); import/export fully stubbed (`TransferSections.tsx:9–14`, needs picker/filesystem deps); channels (no `Backend` surface, `usePostFeedQuery.ts:84`; v1 has no channels/pages/announcements either — new scope).

---

## 2. Mastodon replacement

### 2.1 User-facing (~80% UI, ~90% data) — subagent `ses_e9e544357ffeLsjCf8w4Bx4AgF`
Done: home/local/federated + streaming state (`Home.tsx`, `Network.tsx` social/local/federated, `StreamBadge.tsx`, `backend.ts` public/local), thread + context (`Note.tsx`, `misskey`/`mastodon/thread.ts`), profile + pins + media tab + followers/following + requests (`ProfileHeader/Banner/Avatar.tsx`, `Followers.tsx`, `FollowRequests.tsx`), composer core + polls + schedule + drafts + edit + quote-refusal, media grid + alt + lightbox + video/gifv/audio (`Lightbox.tsx:443,908–912` mounted; `PostMediaGrid.tsx:162–245` expo-video — register F1/F2/S2 stale), interactions (reply/boost/fav/bookmark/pin/thread-mute/mute/block/report-simplified), notifications (all types mapped incl. quote/poll/admin, `types[]` filtering, grouped/flat toggle, live channel; `mark-all-read` weak on Mastodon), search + autocomplete + trends/suggestions/news-gated (`endpoints.ts:369–530`, `Explore.tsx:458–480`), lists CRUD + filters v2 CRUD + feed enforcement, profile edit (name/bio/locked/bot/fields; avatar/banner honestly disabled), multi-account + MFA login.

Missing / partial (top daily-driver blockers):
1. **No DM inbox** — direct visibility + recipient picker send, but no `direct` in `feedDescriptor.ts:15–19`, no conversations route; contract `mastoapi-contract.md:259,403` confirms `/timelines/direct` absent on Akkoma.
2. **No hashtag follow/mute** — zero `followed_tags`/`follow_tag` code; Tag screen buttonless.
3. **No domain blocks** — no `domain_block` endpoint/UI; only `domain_blocking` relationship read (`wire.ts:341`).
4. **Simplified report** — single comment dialog (`PostHandlers.tsx:82–87`, `menuModel.ts:49–51,166–190`) vs `report/category/rules/statuses` chooser.
5. **No avatar/banner upload** (`ProfileEditor.tsx:4`, `errors.unsupported.avatar`), no onboarding flow, no push.
6. **No edit history / delete-and-redraft**; no list `replies_policy`/exclusive; no profile directory; no announcements; poll `hide_totals` data gap (`wire.ts:440`, `compose.ts:95` — `{options,expires_in,multiple}` only); composer language missing; filter per-context toggles unverified; keyboard = web Esc/arrows only, no `j/k` map.

### 2.2 Admin / backend / power — subagent `ses_e9e544356ffedRzlPzF8bYhBNO`
- **Admin ~0%:** zero `admin` endpoints/screens. Reference has 45 `app/controllers/admin/` + 13 `api/v1/admin/` (accounts, account_actions, domain blocks/allows, reports, measures/dimensions, invites, emoji, announcements, relays, roles, retention…). v2 trace = two unread wire flags (`suspended?/limited?/roles?` `wire.ts:97–100`, Pleroma `is_admin?` `wire.ts:50–51`). Absent, not inert — greenfield project (~6–10 slices: `mastodon/admin.ts` + wire types + `admin:read/write` scopes + `detect.ts`/`gateGraph` flags + one screen per controller group).
- **Backend done:** OAuth per-origin + PKCE S256 + single-use state (`oauth.ts:134–453,486,630`), password grant + MFA (`oauth.ts:534–602`, `auth.ts:75–111`), logout revoke (`oauth.ts:655`, `sessions.ts:583`), per-origin token isolation (`sessions.ts:52–59`, `client.ts:224–250,292`, `pagination.ts:145–159`), Link-preferred pagination (`pagination.ts:30–159`), timelines/tag/status-context, idempotent create/edit/delete (`compose.ts:194–216`), fav/reblog, Akkoma emoji reactions gated (`instance.ts:296–308`, `statusActions.ts:79–130`), poll vote, pin, relationships/requests, mutes/blocks/thread-mute, mutes/blocks listing, filters v1/v2 w/ fallback (`backend.ts:903–1012`), bookmarks, lists minimal, custom-emoji read, emoji assets CDN (`emojiAssets.ts:61–92`), media multipart + 202 poll (`backend.ts:877–901`), translation both shapes (`endpoints.ts:1054`), notifications v1+v2 + markers (`endpoints.ts:895–1012`), v2 search + handle lookup (`endpoints.ts:194–246,382`), suggestions/trends/news, instance v2→v1 fallback + flavor detect + streaming-origin normalize, sessionId in every query key, mostly honest capability gating.
- **Backend gaps:** personal domain blocks; report missing `status_ids/rule_ids/forward`; scheduled update missing; bookmarks of search single-page (`backend.ts:715–743`, Link ignored); media `PUT :id` (description/focus) missing; notifications no dismiss/clear; featured/followed tags, endorsements, peers/rules/terms, conversations/DMs, directory, push all missing; link-preview is client scrape (`api/linkpreview.ts:85–243`), no server card/oembed; `compose.ts:140–171` sends no `hide_totals`/`allowed_mentions`/`quote_approval_policy`; lists create/update send `title` only.
- **Streaming partial (`stream.ts:70–439`):** user/public/hashtag/list pooled + lazy + 1s→30s backoff done; missing SSE, `user:notification`, conversations, `filters_changed`, `kill`, per-post channel. Risks: token in `?access_token=` URL (contract §8 `Sec-WebSocket-Protocol` never sent); no ping/pong (Akkoma pings dropped at `stream.ts:230–244`); no connected-ack timeout / fast-close breaker (contract §8: 10s + stop-after-5); cross-host token with no ws/wss pin (`instance.ts:276–278`); `subscribePost` rides shared `user` stream.
- **Top correctness risks:** (1) streaming token in URL, (2) no ping/pong/kill/filters_changed, (3) infinite reconnect, (4) cross-host token w/o scheme check, (5) v2-filter collapse keeps first keyword only + destructive edit (`backend.ts:244–261,950–998`), (6) search truncated page-1, (7) under-specified reports, (8) translate menu possibly checks Misskey `translatorAvailable` instead of Mastodon `configuration.translation.enabled` (`instance.ts:143–152`, `detect.ts:407–419`), (9) over-scoped OAuth (`MASTO_SCOPES` + umbrellas always; `scopeHealth` diffs the over-broad set), (10) cross-origin cursor-less Link → silent `end:true`.
- **Niche/forks ~35%:** quotes (Mastodon `{state,quoted_status}` + Akkoma nested; `adaptQuote` `adapt.ts:396–423`, `quoteMarker.ts`, `resolveQuoteUri` via v2 search) done; Fedibird `emoji_reactions` noted-not-wired; tombstones (410→`gone` only), bubble timeline (no `bubble` kind; `social` throws), featured tags, endorsements, annual reports, move/alias (read-only `moved` `adapt.ts:260`), Mastodon CSV import/export, 2FA/security settings, rules acceptance all missing.

---

## 3. Misskey replacement

### 3.1 User-facing (~68%) — subagent `ses_e9e544355ffedFoO8YH0YdPt3R`
Done: home/local/social/global, antenna timelines + editor (live-unverified), user-list CRUD + feed, clip feed/detail/add-to-clip, tag feed + taps + `TagBubble`, search/suggest, trending (partial) + gated news, notes post/reply/CW/visibility/specified+recipients/renote-vs-quote matrix (`adapt.ts:262–301`, `quote.ts`, `docs/quote-posts.md`) + quote-auth policy, reply threading (ancestors/connectors incomplete F20), detail tabs, polls (`PostPoll.tsx:161` mounted `PostCard.tsx:916–920` — stale F8), reactions + picker + recents + remote tables (WS-C, Akkoma 8/8 probe) + like-emoji fallback + like-vs-reaction split, remote-emoji fallback chain, MFM fidelity (`RichText.tsx:571`, `fromMfm/fromHtml/ast.ts`; WS-B `$[…]` + spin + invisible + mchip), translation + auto (live-unverified), unfurl (server card + `UnfurledLinkCard` `PostCard.tsx:924–927`), note edit + schedule + server drafts + local drafts + favorites (`favorites.ts`, `Favorites.tsx`), thread mute, word-mute soft/hard/instance (`softMute.ts`, `filterModerated`), drive browse + folders CRUD + rename/sensitivity/delete (live-unverified), 12/22 notification types + filtering + grouped/flat + receive-config + pressable rows, follow/requests, block/mute/renote-mute flips, profile editor (avatar/banner disabled), multi-account + MiAuth/OAuth login, report flow, copy/remote/RSS links, legacy URL rewrites (`routes.ts` + `nav.test.tsx`).

Missing / partial (top blockers):
1. **No channels UI** — `ChannelsApi` declared (`core/backend.ts:516`) but no route/screen; highest value-per-effort (descriptor + plumbing exist).
2. **Live verification blocked** (`:3101/:3102` down) — antennas/clips/drive/mutes/translation/scheduled/drafts unit-only.
3. **Notification gaps** — 10/22 `notificationTypes` (`misskey-js/consts.ts:19`) unmapped (`scheduledNotePosted/Failed`, `roleAssigned`, `chatRoomInvitationReceived`, `exportCompleted`, `test`, `login`, `createToken` → `unknown`).
4. **Drive browse-only** — `Drive.tsx:1–5` "without uploads"; uploads via composer `pickMedia` only; composer passes `alt:''` (`Composer.tsx:346,366`); no caption editor, no file-detail/usage view.
5. **Profile missing clips/pages/gallery tabs** (v2 tabs `ProfileTabs.tsx:29` only; no `index.files/activity`).
6. **Import/export honest stubs** (`TransferSections.tsx` — no picker/filesystem primitives).
7. **No deck/widgets** (`Navigation.tsx:383–390` placeholder, Phase 5).
8. **Settings shallow** — privacy, notif prefs beyond receive-config, theme editor/CSS, sounds, webhook, 2FA/email/security, drive settings, plugin/registry all absent. Plus: announcements/achievements/roles/ads, gallery/pages/Play/chat/groups, avatar decorations, channel mute, thread-mute list, tag follow/mute, per-note `noQuote`/boosts-only mute deferred.

### 3.2 Admin / backend / power — subagent `ses_e9e544355ffdN80xU7qx2uGnkq`
- **Admin 0%:** Misskey reference = 102 `backend/.../endpoints/admin/` + ~60 `frontend/.../pages/admin/`. v2 grep for `admin|suspend|silence|announcement|invite|federation|abuse` = locale/cache noise only. No dashboard/queue (`queue/*`, `server-info`, `table-stats`), users moderation (`suspend/unsuspend/delete-account/reset-password/show-users/user-ips/notes/modlog/approvals`), roles (`roles/*` ×9 — incl. read side; no `RolesApi`, no policy flags in `detect.ts`), announcements (interface declared `core/backend.ts:520–528`, **never implemented** in `misskey/backend.ts`), emoji admin (`customEmoji.ts:193–201` read-only, no license/add/delete/copy/import), federation/relays/meta (`federation/*`, `relays`, `update-meta`, `blockedHosts/silencedHosts/sensitiveWords` — zero hits), reports queue (only `users/report-abuse` wired), invites, ads/promo/decorations/webhook/email/captcha/drive-admin. (`state/queries/moderation.ts` is client feed-filtering, false friend.)
- **Backend done:** MiAuth first-party + external (`auth.ts:55–128`, `external.ts:127–258`); per-origin isolation (`client.ts:56–81`, `stream.ts:149–154`, `sessions.ts:4–59`, external `credentials:omit`); 22 `KEYSTONE_PERMISSIONS` + 403/`PERMISSION_DENIED` detect (`auth.ts:107–128`, `client.ts:288–296`, `Clips.tsx:241`); cursor pagination both directions on all timelines/drive/antennas/clips/lists/favorites/featured/notifs/search (`adapt.ts:432–454`); streaming home/local/hybrid/global/antenna/userList/hashtag + main + subNote capture + backoff/ack-timeout/revoked-fast-fail/refcount (`stream.ts:211–717`); drive basic (list/update/delete/create-multipart/folders CRUD `backend.ts:232–282`); `notes/translate` + `translatorAvailable` probe + cache + 404-off (`translate.ts:28–175`); server drafts full CRUD+count (`serverDrafts.ts`); scheduled create/list/delete + `isFutureInstant` (`schedule.ts:13–53` — matches upstream, no update exists); `notes/edit` + 404→redraft fallback (`noteEdit.ts:13–33`); polls vote, `notes/conversation` + ancestor walk (`thread.ts:59–114`); quote visibility client enforcement (`quote.ts:359`); `ffVisibility` (`adapt.ts:112`, `Followers/Following.tsx:110–128`); remote-post resolution w/ trust check (`remotepost.ts:52–94`).
- **Backend gaps/bugs:** MiAuth MFA `unsupported` all Misskey flavors (`detect.ts:256–343`; MFA only Mastodon OAuth); no Misskey scope-upgrade path (`store.ts:447–457` `misskey-no-scopes` — old tokens 403 w/o global prompt); schedule/draft lists `untilId`-only (`schedule.ts:20–30`, `serverDrafts.ts:19–29`); no `channel` stream + no messaging/chat streams (header `stream.ts:362–363` ignores broadcasts; `ChannelsApi`/`AnnouncementsApi` declared `core/backend.ts:514–528`, never implemented); drive advanced missing (`show/attached-notes/attached-chat/check-existence/find-by-hash/find/move-bulk/upload-from-url/stream`, `folders/find/show`); uploads always root (no `folderId/force` vs upstream `drive/files/create.ts:78–82`); no roles/policy gates (`gates.ts` = reactions/fav/bookmark/renote/delete only); unread client-derived only (`notifications.ts:146–187`; no server counts, no antenna/clip per-list counts).
- **Import/export wrong-shape (real bugs):** `importData` sends `{file: content}` (`importExport.ts:36–51`) but upstream `i/import-*` requires `{fileId}` of a Drive upload — will fail validation. `exportData` awaits payload (`importExport.ts:63–84`) but upstream `i/export-notes` only enqueues (`createExportNotesJob`, 1/day, notification delivery) — needs job/completion path.
- **Niche ~55%:** `notes/like` probe-by-fire + per-origin cache (`like.ts:57–80`) but flavor-seeded `false` for stock Misskey (`backend.ts:220`) so backports never probed; create-side `noQuote` supported (`wire.ts:188`); bubble/TMF/sensitive-words missing; Catodon sparse (`detect.ts:290–302` conservatively hides); Pinetree tabled (`detect.ts:303–322`); renote-with-content = quote (`adapt.ts:263–296`) done; featured/pins (`featured.ts:12–42` PIN_LIMIT 5) done; emoji read-only (no license/steal/bulk); antenna body sends keywords/excludes/bots/replies (`backend.ts:1078–1094`) but no per-host allow/block verified; no batch ops; no chats/messaging/gallery/flash/pages; federation read missing (`Network.tsx` ≠ federation-admin).
- **Admin path (smallest-first):** backend fixes first (import `fileId`, export job, upload `folderId`, edit `noQuote`/poll), then read-only server insight (`server-info/meta/queue/stats/online-users`), announcements-read + federation-read into `Network.tsx`, reports queue (`abuse-user-reports` + resolve/update/forward), user moderation (`show-users/suspend/unsuspend/notes/modlogs`), roles + emoji admin. Stay out: queue-job manipulation, `delete-account`, `delete-all-files`, `reset-db` (link web console).

---

## 4. Visual / UI cross-cutting — subagent `ses_e9e544354ffejaClo7XBmGqI8E`

**~55–60%.** Shell 85 / theming 35 / deck-widgets 5 / composer-media 80 / RichText 90 / i18n 55 / a11y 60 / responsive 80 / notif-UX 65 (no push) / settings 50 / empty-loading-error 90 / perf 45.

- Shell: butterfly mobile strip + bottom tabs + full/rail sidebar real (`Navigation.tsx:504–746`); `RightNav` = `"Widgets land in Phase 5."` (`:750–755`). Deep links + legacy rewrites + base-path strip done (`routes.ts:106–155`, `Navigation.tsx:104–137`).
- Theming: one light/dark grey pair (`alf/themes.ts:26–48`, grey-only `tokens.ts`), no accent by design (`:1`); contrast suites exist; **v1 `keystone-terminal.css` (gold/square/solarized) has zero consumer**; density = text-size only (`appearance.ts:42–58`, 0.5–4× prose via `RichText.tsx:519`; compact = hitSlop-only W6, no `.compact` port); no OLED (`#111111`, no variant/ADR).
- Deck: model done (`feedDescriptor.ts:15–30`: home/local/social/global, list/antenna/channel/clip/tag/search, `explore|posts`, bookmarks, mentions, `user|id|tab`) but **no `src/features/deck/`**, no picker/schema/persistence; missing Misskey `main`/notifications/divider kinds; Mastodon pinned-tag/list columns have no pin UI. Widgets: zero registry (Misskey ~30: Clock/Memo/Trends/Notifications/Timeline…; plan §5.7 first-five untouched). ADR-0002: no widget code pre-Phase-5.
- Composer/media: full + compact chromes (`Composer.tsx`, `CompactComposer.tsx:260–331`), audience/CW/polls/recipients/drafts/scheduled; **no MFM toolbar** (plain multiline `495–505` + `@/#/:emoji:` autocomplete only); media sensitive veil + per-tile alt (`MediaGrid.tsx:163–199`), lightbox pager + safe-area chrome, composer alt fields w/ "Locked after upload" (`ComposerSections.tsx:126–131`); Drive sensitivity toggle (`Drive.tsx:224–237`); link previews server-card + auto-unfurl single-flight + Data Saver (`LinkCard.tsx`, `appearance.ts:56–60`); emoji picker rich (recents-24, store+query merge, honesty states; pin/hide prefs + Settings UI).
- RichText sole renderer, allow-listed, no innerHTML/WebView; static-MFM subset, motion/blur→children (WS-B), quote heads/headings/bullets/invisible-zero-width, `contentMode` plain projection (`appearance.ts:22–27`).
- i18n: 8 locales wired (`i18n.ts:28–37`) but only `en` compiled in practice; `fr/messages.po` e.g. "Widgets land in Phase 5." `msgstr ""`; W8/Q2 new-codes-English-only; switching works (`LanguageSection.test`).
- a11y: labels/roles/state throughout, hitSlop 8–12 (44dp effective `Navigation.tsx:482,525`, `ActionBar.tsx:114`), reduced-motion kills popup/lightbox fade (`lib/motion.ts`, W6), KAV + `keyboardShouldPersistTaps`, `web-keyboard.test.tsx:86–148`; **TalkBack open**, placeholder rows `role="none"`.
- Responsive 3-layout (`breakpoints.ts:54–60` ≤720 / 721–1000 rail / full); compose floats desktop / full-bleed mobile; hand-rolled sticky tabs (`HomeFeed.tsx:166–174`); SafeArea root (`Root.tsx:85–93`) + strip/tabs/FAB/lightbox insets.
- Notifications UX in-app done (filters, grouped/flat, per-type Misskey config, mark-read, badge, live prepend); **zero push** (no `expo-notifications`, no APNs/FCM, badge = cache count).
- Settings 9/9 v1 sections render (`Settings.tsx`, `settings/meta.ts`); real: mode/text/emoji-style/content/quote/saver/feeds/reactions/mutes/filters/language. Placeholders w/ reasons: theme/palette/font (`DisplaySection.tsx:243–261`), emoji backup, all 12 transfer rows (`TransferSections.tsx`), some per-family mute lists.
- Empty/loading/error strong (skeletons `HomeFeed.tsx:92–116`, footer-retry keeps list W2/F21, unsupported-vs-error split, signed-out honesty, offline = error+retry w/o banner/queue indicator). Perf basic: FlatList everywhere (no FlashList), 1200px prefetch + threshold 2.5 (`HomeFeed.tsx:221–258`), 24h persisted cache, expo-image defaults (no priority), blurhash carried-null never rendered, per-tile `useVideoPlayer` no offscreen-pause.
- Niche: no autoplay/sensitive-defaults setting (gifv/video autoplay on open); menu `LATER(...)` dead-ends visible-but-honest (`menuModel.ts:146–162`: RSS/search-notes/memo/add-list/add-antenna/notify/DM/refresh-remote); `write:reports` scope omitted (WS-D) so granular-token reports toast-fail; explore popup `activeIndex={0}` hardcoded (`Explore.tsx:697`); streaming badge exists, paging feeds silent; i18n tail 466/548 `fr` untranslated + fedi reasons English (fedi Lingui-free by design); small toggles all real (quote conceal, saver, plain mode, like-emoji persist, unicode pin/hide, feed prefs, per-type receive); bubble deliberately absent (W8/Q3).

Top visual blockers: (1) no deck/widgets (literal stub string), (2) one theme pair (terminal/OLED/accent absent; theme rows placeholder), (3) no push, (4) no density, (5) no formatting toolbar + compose-time sensitive toggle, (6) transfer all-disabled, (7) explore/news rows bare (title-only news `Explore.tsx:102–110`, no avatars/follows).

---

## 5. Consolidated: what to build next (highest value first)

1. Live Misskey/Sharkey rig + re-probe all `not verified` (translation success, drive round-trip, antennas/clips/mutes/schedule/drafts, like pre-flight, `polls_multi` on Pinetree, v2-grouped notifications).
2. Oppo device pass + iOS run + TalkBack pass (every touch/keyboard/emoji claim currently Helium-or-unit).
3. Channels UI (Misskey) — descriptor + plumbing exist; unlocks a primary surface.
4. DM/chat story: Mastodon conversations inbox (or explicit unsupported-gate); Misskey messaging (or `chats: unsupported` gate) — silent absence today.
5. Tag follow/mute (both families) + domain blocks UI (Mastodon) + featured/followed tags.
6. Profile content tabs (clips/pages/gallery/activity) + "All" tab parity (v1 A1).
7. Drive: browser uploads + folder targeting (`folderId`) + captions + file-detail/usage.
8. Report depth (status_ids/rule_ids/forward) for moderator usefulness.
9. Notification completion: Misskey 10 missing types; Mastodon dismiss/clear; push registration (or explicit roadmap note).
10. Stale-register correction pass (F1/F2/F8/F13/F15–F18/S2 → done; MK rows re-verified) or it keeps misdirecting sessions.
11. Import/export real shapes (Drive `fileId` upload-then-import; export job + rate-limit surfacing) + picker/filesystem deps decision.
12. Deck Phase 5 (descriptors + `notifications` kind + divider; column picker/persist; first-five widgets §5.7) + theme pair expansion (terminal/OLED/accent decision) + density control.

Explicit non-goals to record (per subagents): queue-job manipulation, `delete-account`/`delete-all-files`/`reset-db`, TMF/queue-admin in mobile; full keyboard `j/k` map + help modal; Pages/Play/gallery/games long tail — scope as won't-build vs later in `docs/V2_GAPS.md`.

---

## 6. One-line answers to the brief

- **v2 missing anything from v1?** ~8 niche items (profile All-tab, per-note noQuote, per-item sensitive, soft-mute badge, root-base callback, attach-time sensitivity, domain-block UI, management i18n tail) + deferred placeholders + unverified-live tail. No P0.
- **Mastodon replacement?** Core daily use: yes. Full replacement: no (no DMs, tag follow, domain blocks, deep report, edit history, list policies, avatar upload, push, admin).
- **Misskey replacement?** Timeline-centric daily use after a live-rig pass + channels UI: credible. Full replacement: no (channels, gallery/pages/Play/chat, deck/widgets, drive depth, settings depth, admin).
- **Admin (either)?** No. Zero endpoints, zero screens, by design a client. Greenfield if ever wanted.
- **Visual/UI?** Strong reader/composer in one column; not yet the deck/theme/push/density product either reference's power users expect.

*Subagent session IDs: v1-parity `ses_e9e544358ffesADg4P6Y2a83Vj`, masto-user `ses_e9e544357ffeLsjCf8w4Bx4AgF`, masto-admin `ses_e9e544356ffedRzlPzF8bYhBNO`, misskey-user `ses_e9e544355ffedFoO8YH0YdPt3R`, misskey-admin `ses_e9e544355ffdN80xU7qx2uGnkq`, visual `ses_e9e544354ffejaClo7XBmGqI8E`. Raw outputs retained in session history; this file is the synthesis.*
