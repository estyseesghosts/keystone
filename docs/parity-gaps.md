# Parity gap register — keystonev2 vs v1 Keystone

Status: **active** · Created 2026-10-20 · Owner: next implementer
Method: seven read-only audits of `~/Local Documents/Keystone` (v1) against
this repo (v2), one per area: shell/navigation, feeds/content, composer/
interactions, settings/appearance/i18n, Misskey data layer, Mastodon +
cross-backend, and the v1 mobile prototype + spec docs. All claims are
source-derived; no live device/rig run was performed for this register.
Audit session log: `state/logs/2026-10-20-gap-audit.md`.

This file is the **single backlog for v1 parity**. `rn-rebuild-plan.md`
remains the phase plan; this register records what the plan does not own
or has not finished. `docs/tasks/gap-closure.md` is the working checklist.

## How to read this

**State**

- `bug` — implemented but wrong (fix, do not rebuild)
- `unwired` — code exists and is tested but has no production caller
- `partial` — implemented narrowly or with a known behavioural gap
- `stub` — visible placeholder/disabled row in the UI
- `missing` — no implementation in v2
- `planned` — explicitly scheduled in `rn-rebuild-plan.md` Phase 5/6/7
- `deferred` — explicitly deferred by an owner decision (see §9)

**Priority**

- `P0` — breaks daily use on the phone or silently lies to the user
- `P1` — parity gap users will hit in normal use
- `P2` — polish, edge cases, and long-tail parity

Rules for the implementer: every fix lands with its verification (trio +
relevant device/web/rig evidence), updates this register's state, and
records any deliberate non-fix in `docs/DECISIONS.md`. Never mark a row
`done` here without evidence; the table is an honesty device, not a wish
list.

---

## 0. Executive summary

The **data layer is largely ported**; most gaps are UI wiring, capability
policy, routing, and platform behaviour. Three systemic problems explain
the majority of rows:

1. **Capability evidence never reaches backends (S1).** `backendForSession`
   passes only flavor, so `buildCapabilities(flavor)` runs without instance
   evidence. Several implemented features are gated off, with false
   "your server does not support this" copy.
2. **Several slices marked done were never mounted (S2).** Streaming,
   lightbox/media, Misskey quote mapping, fold/tag-bubble, link previews,
   remote-emoji fallback and legacy migration all exist as dead code.
3. **Routing and specs drifted (S3/S5).** `src/routes.ts` paths are unused;
   the real table is `Navigation.tsx`. Legacy URLs, `/settings/*`,
   `/network/federated`, base paths and several screens are gone, and v1's
   mobile spec docs were never carried into v2.

Estimated shape: 122 actionable rows; 75 are P0/P1 (21 P0, 54 P1).
The first workstream (W1) unlocks roughly a third of the P1 rows by itself.

---

## 1. Systemic blockers

| ID | Gap | Evidence | State | Pri |
|---|---|---|---|---|
| S1 | Capability flags are built from the flavor table only; detected instance features are discarded. Misskey edit/bookmarks/translation/scheduling/drafts and Mastodon/Akkoma quotes stay `unknown`; UI disables them or shows wrong reasons. | v2 `packages/fedi/src/api/client.ts:196-206`, `misskey/backend.ts:434-440`, `mastodon/backend.ts:234-235`, `core/detect.ts:201-351`; v1 `frontend/src/core/detect.ts` (same table, but v1 attempted and handled 404s) | done (W1 2026-10-20: `ServerDetection.evidence` persists on `Session`, `backendForSession`/`activeBackend` forward it into `buildCapabilities`; `translatorAvailable` is a real evidence field; misskey/sharkey table corrected — see MK15/MK2) | P0 |
| S2 | Dead/unwired modules: `src/state/streaming.ts`, `src/components/Lightbox.tsx`, `src/components/MediaGrid.tsx`, `packages/fedi/src/misskey/quote.ts`, `api/fold.ts`, `api/tags.ts`, `api/linkpreview.ts`, `mastodon/quoteMarker.ts`, `mastodon/presentation.ts`, `misskey/remotepost.ts`, `misskey/customEmoji.ts` host cache, `misskey/drafts.ts`, legacy session migration. | v2 files above; each has no production importer (tests only) | unwired | P0 |
| S3 | Two route tables: `src/routes.ts` `paths` is dead, `Navigation.tsx` linking is real. Drift has already removed redirects, `/settings/*`, `/network/federated` and base-path support. | v2 `src/routes.ts:23-37`, `src/Navigation.tsx:61-84`; v1 `frontend/src/routes.ts`, `App.tsx:45-64` | done (W1 2026-10-20: `linkingScreens()` derives `linking.config` from `paths`; `nav.test.tsx` drift test; canonical `/network/federated`) | P0 |
| S4 | Streaming is not mounted in any screen: no live feed insert, no delete/update capture, no notification channel, no status/reconnect UI. Ledger says P3.10 done. | v2 `src/state/streaming.ts` (only test importer), `docs/tasks/p3.10-streaming.md:21`; v1 `components/TimelineFeed.tsx:367-431`, `StreamBadge.tsx`, `routes/Notifications.tsx:260-311` | unwired | P0 |
| S5 | Status/spec drift: task index marks p3.8/p3.10 done with unchecked acceptance; DECISIONS has stale scheduling/renote-mute reasons; bottom-sheet reversal and Bubble drop exist only in logs; v1 mobile specs (`mobile.md`, `mobile_2.md`, `clients.md`, `my_network.md`) were never carried. | v2 `docs/tasks/README.md:26,28`, `docs/DECISIONS.md:47,61`; v1 `docs/` | bug | P1 |
| S6 | Duplicate implementations: drafts (`packages/fedi/src/misskey/drafts.ts` vs `src/storage/drafts.ts`), feeds (`FeedView` vs `components/PostFeed/PostFeed.tsx`), family detection (`mastodon/instance.detectFamily` vs `core/detect.detectServer`). | v2 paths above; `PostFeed` used only by tests | partial | P1 |

---

## 2. Routing, shell, screens

| ID | Gap | Evidence | State | Pri |
|---|---|---|---|---|
| N1 | Legacy redirects gone: `/local`, `/social`, `/global` → `/network/*`, `/search` → `/explore` (`?tag=` forwarded). Old bookmarks/universal links dead. | v1 `frontend/src/App.tsx:45-64`, `routes.ts:44-54`; v2 `src/routes.ts` has none | done (W1 2026-10-20: `rewriteLegacyPath` in `routes.ts`, wired via custom `getStateFromPath`; `nav.test.tsx` covers all four + `?tag=`) | P0 |
| N2 | Canonical tab is `/network/federated` in v1; v2 uses `/network/global` and `NetworkTab = global`, so `/network/federated` silently falls back to default. Tabs are local `useState`, not URL-backed: reload/back loses tab. | v1 `routes/MyNetwork.tsx:35-39,158`; v2 `src/routes.ts:5`, `src/screens/Network.tsx:25-38` | done (W1 2026-10-20: tab renamed to `federated`, descriptor still `timeline\|global`; tabs write `:tab` params; `/network/global` aliases to federated; device back-button round-trip not verified) | P0 |
| N3 | `/settings/{account,display,reactions,feeds,mutes,import,export,filters,language}` are not routes; sections are component state. Deep links/bookmarks unresolved; system/browser back exits all of Settings. | v1 `routes.ts:69-78`, `App.tsx:90-99`; v2 `src/routes.ts:32`, `Navigation.tsx:77`, `Settings.tsx:66` | missing | P1 |
| N4 | Explore tab is a placeholder (`Explore — not built`) while being a primary mobile tab; no `/explore/users|tags|posts|news`, no unified search or `#`/`@` autocomplete. Data layer ready (`Backend.explore`). | v1 `routes/Explore.tsx:195-996`; v2 `src/screens/Explore.tsx:3-4`, `screens/Placeholder.tsx` | stub | P0 |
| N5 | Tag screen placeholder; every hashtag tap dead-ends. Fetch path + route + title formatter already exist. | v1 `routes/Tag.tsx`; v2 `src/screens/Tag.tsx:3-4`, `components/Post/PostCard.tsx:280-284`, `usePostFeedQuery.ts:93-94` | stub | P0 |
| N6 | No `/lists` index; `/lists/:id` is `List — not built`. List membership dialog writes data that cannot be viewed. | v1 `routes/Lists.tsx`, `ListFeed.tsx`; v2 `src/screens/List.tsx:3-4`, `routes.ts:31` | stub | P1 |
| N7 | No `/clips` or `/clips/:id`; clip menu row hardcoded disabled. Data layer + descriptor ready. | v1 `routes/Clips.tsx`, `ClipFeed.tsx`; v2 `menuModel.ts:167`, `usePostFeedQuery.ts:87-92` | missing | P1 |
| N8 | No `/antennas` or `/antennas/:id`; antenna menu row disabled. Data layer + descriptor ready. | v1 `routes/Antennas.tsx`, `AntennaFeed.tsx`; v2 `menuModel.ts:106`, `usePostFeedQuery.ts:73-82` | missing | P1 |
| N9 | No `/drive` browser; composer attach and future avatar/banner picking have no drive UI. | v1 `routes/Drive.tsx`, `components/DriveBrowser.tsx`; v2 `Backend.drive` exists | missing | P2 |
| N10 | No `/favorites` (bookmarks) screen on either family; descriptor + backend exist. | v1 `routes/Favorites.tsx`; v2 `usePostFeedQuery.ts:97-107`, no route | missing | P1 |
| N11 | No follow-requests queue screen; only inline accept/reject on a requester profile. Locked accounts cannot triage. | v1 `routes/FollowRequests.tsx`, `FollowList mode=requests`; v2 `ProfileActions.tsx:84-90`, backend ready | done (W4 2026-10-21: `FollowRequestsScreen` via graph-controller resolve, 5 tests, honest empty live on Akkoma) | P1 |
| N12 | No followers/following screens; profile counters are plain text. Backend ready. | v1 `routes/Profile.tsx:450-491`, `FollowList.tsx`; v2 `ProfileHeader.tsx:53-57`, `Backend.followers/following` | missing | P1 |
| N13 | Base-path/hosting routing not applied; `HostingResolution.basePath` exists but linking ignores it. | v1 `routes.ts:126-187`; v2 `core/hosting.ts:39-58`, `Navigation.tsx:61-84` | missing | P2 |
| N14 | No scroll restoration and no last-feed fallback. `Network` swaps descriptors in one mounted list; back on a deep-linked screen silently no-ops when `canGoBack()` is false. | v1 `state/feedCache.ts`, `TimelineFeed.tsx:266-301`, `BackButton.tsx:13-18`; v2 no equivalent | missing | P1 |
| N15 | No back affordance on rail/full layouts; only `MobileStrip` renders back. | v1 `Layout.tsx` desktop back; v2 `Navigation.tsx:185-196,494` vs `Pagehead.tsx` | missing | P1 |
| N16 | Account chrome entry points thinner than v1: avatar goes to Settings, no profile shortcut, no account menu in strip/sidebar. | v1 `AccountCard.tsx:250-385`; v2 `Navigation.tsx:203-220,345-377` | partial | P2 |
| N17 | Title/copy drift: "Network" vs "My Network", "Explore" vs "Search", "Post" vs "Note"; profile has no pagehead on desktop. | v1 `stripTitle.ts:12-59`; v2 `routes.ts:41-74`, `Network.tsx:31` | partial | P2 |
| N18 | No unread/notification badge and no live count; no stream status badge. | v1 `routes/Notifications.tsx:57-60,271-278`, `StreamBadge.tsx`; v2 none | partial (W4 2026-10-21: cache-derived unread badge on tab bar/sidebar/rail + `N new` pill, 6 badge tests; stream-status badge rides S4 per DECISIONS) | P1 |
| N19 | Right rail is a visible placeholder ("Widgets land in Phase 5"). | v2 `Navigation.tsx:383-390`; plan 5.6/5.7 | planned | P2 |
| N20 | Notification rows are not pressable: no actor profile link, no post link, no avatar, raw ISO time. | v1 `NotificationRow.tsx:132-176,207`; v2 `screens/Notifications.tsx:68-83` | done (W4 2026-10-21: pressable actor/post rows, avatars, `DisplayName`, relative time, 24 tests, verified live signed-in) | P0 |
| N21 | No safe-area insets anywhere (strip, tab bar, FAB, lightbox, composer). Package installed, provider absent. | v1 `global.css:2802,2852`; v2 `package.json:71` vs no `SafeAreaProvider` in `Root.tsx` | missing | P0 |
| N22 | No app icon, splash, or favicon; no status-bar/system-UI control (`expo-system-ui` unused). | v1 `frontend/index.html:7`, `assets/favicon.ico`; v2 `app.config.js:17-38`, no `assets/` | missing | P2 |

---

## 3. Feeds, posts, content, media

| ID | Gap | Evidence | State | Pri |
|---|---|---|---|---|
| F1 | No media viewer in posts: `PostMediaGrid` has no press handler, `Lightbox` mounted nowhere. Tapping media does nothing. | v2 `PostCard.tsx:357`, `PostMediaGrid.tsx:122-167`; `Lightbox.tsx` test-only | unwired | P0 |
| F2 | No video, gifv, audio, or file playback/open. Tiles render "No player is embedded here." No audio dependency. | v2 `PostMediaGrid.tsx:97-120`; v1 `NoteBody.tsx:73-143` | missing | P0 |
| F3 | Sensitive media is one gate per grid, not per item; no per-item label. | v1 `NoteBody.tsx:98-105`; v2 `PostMediaGrid.tsx:123-138` | partial | P2 |
| F4 | Server URLs bypass `safeHttpUrl` on avatar, media, menu copy/share/open. | v1 gated all (`NoteBody.tsx:37-46,137`); v2 `PostCard.tsx:93`, `PostMediaGrid.tsx:83`, `menuModel.ts:61-65` | bug | P1 |
| F5 | Misskey/Akkoma quote posts never render a quoted card: `adaptNote` hardcodes `quote: null`; the whole quote module is unused. | v2 `misskey/adapt.ts:274`, `misskey/quote.ts`, `PostCard.tsx:358`; v1 `NoteBody.tsx:262-398` | bug | P0 |
| F6 | Quote cards (Mastodon) are dead ends: not pressable, inner links/mentions/tags have no handlers. | v2 `PostQuote.tsx:44-52` | partial | P1 |
| F7 | Textual `RE: <url>` quotes are not stripped/rendered; raw marker line shows. | v1 `quoteMarker.ts` + `NoteBody.tsx:308,528`; v2 0 consumers | unwired | P1 |
| F8 | No poll UI: no render, no vote, no totals/expiry/multiple/error states, though model + `votePoll` exist. | v1 `NoteBody.tsx:187-234`; v2 `models.ts:470`, `Backend.votePoll` unused | missing | P1 |
| F9 | Mentions are broken: MFM emits `mention(null, …)` → inert pressable; HTML mentions open an external browser. | v1 `MfmRenderer.tsx:48-100`; v2 `fromMfm.ts:109`, `RichText.tsx:108-124`, `PostCard.tsx:275-279` | bug | P0 |
| F10 | Bio hashtags do nothing; no tag bubble / hidden-tag pruning in card headers. | v1 `TagBubble.tsx`, `NoteCard.tsx:152-160`; v2 `ProfileHeader.tsx:100-109`, `api/tags.ts` unused | missing | P2 |
| F11 | Remote custom emoji (`:name@host:`) render literally without a packed map; display-name custom emoji render as `:code:` in cards, profiles, notifications. | v1 `MfmRenderer.tsx:108-125`, `splitNameEmojis`; v2 `EmojiImage.tsx:78-97`, `splitRemoteEmojiCodes`/`splitNameEmojis` unused | partial (W4 2026-10-21: `DisplayName` now renders names in cards — W2 — plus `ProfileHeader` and notification rows — verified live; remote-host store fallback still unwired per DECISIONS) | P1 |
| F12 | No link previews (neither `post.card` nor client unfurl). | v1 `LinkCard.tsx` + `NoteBody.tsx:155-185`; v2 `api/linkpreview.ts` unused | partial (W2 2026-10-21: server `post.card` LinkCards done + tested; per-post client unfurl deliberately declined — see DECISIONS) | P2 |
| F13 | No text folding / "Open post"; `foldMfm`/`foldTree` unused. | v1 `TranslatableText.tsx:110-143`; v2 `api/fold.ts`, `mastodon/presentation.ts` unused | missing | P2 |
| F14 | MFM decorative functions ignored (`$[x2]`, size/scale, color/bg, blur, rotate, font, small, center, spin). | v1 `MfmRenderer.tsx:222-333`; v2 `RichText.tsx:161-163` renders children only | partial | P2 |
| F15 | Server-filtered posts (`post.filtered`) render in full with no badge. | v1 `NoteCard.tsx:164-170,310-317`; v2 `post.filtered` unread | missing | P2 |
| F16 | Missing post badges: pinned / bookmarked / edited / soft-muted / reaction-acceptance. | v1 `NoteCard.tsx:290-332`; v2 none | missing | P1 |
| F17 | Boosts never collapse; single renter name instead of "X and N others"; `collapseReposts` unused. | v1 `TimelineFeed.tsx:460-467`, `NoteCard.tsx:35-67`; v2 `PostCard.tsx:294-298`, `models.ts:574` unused | missing | P1 |
| F18 | Reaction chips include the heart key (duplicate of like button); like ignores configured like emoji and hardcodes `❤`. | v1 `ReactionPicker.tsx:58-96`, `likeEmoji`; v2 `ReactionChips.tsx:63-114`, `ActionBar.tsx:212-215` | bug | P1 |
| F19 | No reactor or repost lists, no detail tabs Replies/Reposts/Reactions. Backends implement `noteReactions`/`reposts`. | v1 `ReactionsTab.tsx`, `RepostsTab.tsx`, `Note.tsx:606-651`; v2 `Note.tsx` replies only | missing | P1 |
| F20 | Detail gaps: no "In clips" row; no live delete/update capture; deleting on detail leaves a blank focused thread; no optimistic reply insert; ancestors show "Replying to" and have no connectors. | v1 `Note.tsx:181-203,542-605`; v2 `Note.tsx:194-269`, `PostCard.tsx:157` | partial (W3 2026-10-21: reply-insert completes via C1/C6 cache insert + composer clear; in-clips rides W5, live capture rides S4) | P1 |
| F21 | Feed behaviour: no cross-page dedupe, no caught-up/exhausted state, no next-page retry, spinner instead of skeletons; "N new posts" pill can't scroll to new posts and nothing feeds it live. | v1 `TimelineFeed.tsx:178-263,680-779`; v2 `HomeFeed.tsx:55-69,138-205`, `usePostFeedQuery.ts:136-139` | done (W2 2026-10-21: dedupe in `feedItems`, skeletons, footer next-page retry, pill scrolls to top; live-insert feed for the pill stays with streaming S4) | P1 |
| F22 | Moderation filtering only soft-mutes, only Home; word/server mutes, hard mutes and blocked sets don't filter feeds. | v1 `TimelineFeed.tsx:119-176`; v2 `HomeFeed.tsx:121-122`, `misskey/softMute.ts` unused | done (W4 2026-10-21: `useModerationRules` + `filterModerated` in shared `FeedView` — blocked/muted/renote-muted sets, hard words self-exempt, instances; 9 unit tests; server SOFT words excluded per DECISIONS; Misskey-family live unverified — rig :3101/:3102 down) | P1 |
| F23 | Profile tab parity: v1 Featured/Posts/**All**/Media; v2 Featured/Posts/**Replies**/Media, media excludes replies. No account-reactions block. | v1 `Profile.tsx:326-435`, `UserReactions.tsx`; v2 `ProfileTabs.tsx:15-22`, `usePostFeedQuery.ts:126-127` | partial (W4 2026-10-21: `AccountReactionsBlock` mounted on profile — unavailable-state honest on mastodon, verified live; tab-set parity untouched) | P2 |
| F24 | Detail replies render `PostCard` inside a `ScrollView`; Android logs "VirtualizedLists should never be nested". | v2 `Note.tsx`, `STATE.md` blocker; v1 flat reply tree | bug | P1 |

---

## 4. Composer, post actions, social, notifications, profile

| ID | Gap | Evidence | State | Pri |
|---|---|---|---|---|
| C1 | Inline composer never clears after posting; `Home` passes no `onPosted`, and autosave is suppressed afterwards. | v2 `components/Composer/Composer.tsx:202-206`, `screens/Home.tsx:19-24`; v1 `resetForm()` `:427-447` | done (W3 2026-10-21: controller resets to a fresh empty draft on success, autosave resumes; tested + web-visual) | P0 |
| C2 | Mobile composer has no close/cancel; card is `flex:1`, strip hidden, backdrop unreachable. Spec calls close mandatory. | v2 `Compose.tsx:44-64,151-154`, `CompactComposer.tsx:112`, `Navigation.tsx:450`; v1 `FloatingComposer.tsx:178-187` | done (W3 2026-10-21: Cancel header button whenever `onClose` is set, tested + web-visual; full sheet rides W6) | P0 |
| C3 | No keyboard avoidance/listeners; composer toolbar sits under the iOS keyboard. | v1 mobile prototype `state/keyboard.ts`, `docs/mobile.md` §3/§6; v2 grep → none | done (W3 2026-10-21: `KeyboardAvoidingView` in both chromes + compose card, tested; device keyboard not verified, full pass rides W6) | P0 |
| C4 | "Specified users" direct posts have no recipient picker; `visibleUserIds` never set. | v1 `VisibilityPicker.tsx` + `RecipientPicker`; v2 `api/composer.ts:288-296` | done (W3 2026-10-21: `RecipientSection` with account-lookup resolve + verbatim fallback, persisted in local drafts, tested) | P1 |
| C5 | No quote-refusal recovery (v1 retried without the quote target and showed the server reason). | v1 `Composer.tsx:618-637`; v2 `Composer.tsx:207-209` | done (W3 2026-10-21: `QUOTE_DISABLED*` drops the quote, reposts once, shows the server reason as a notice; tested) | P2 |
| C6 | Drafts: restored reply/quote drafts lose their target and become top-level; opening/closing creates empty drafts; attachments/recipients/noQuote are not persisted; fedi's richer draft module is dead. | v1 `misskey/drafts.ts`, `FloatingComposer.tsx:69-83`; v2 `storage/drafts.ts:24-25`, `Composer.tsx:78-91,134-155` | done (W3 2026-10-21: targets re-attach via `backend.post`, empties never save, `visibleUserIds` persisted; attachments deliberately excluded, fedi module rides W8; tested) | P1 |
| C7 | Edit post UI missing; `onEdit` never supplied; capability unknown; no edit mutation/cache path even though `editPost` exists. | v1 `noteEdit.ts`, `Note.tsx:664-714`; v2 `PostHandlers.tsx:19-20`, `menuModel.ts:171-177`, `Backend.editPost` unused | done (W3 2026-10-21: `Compose?editId` + composer edit mode + `useEditPost` cache patch, attachments carried, schedule hidden; tested) | P1 |
| C8 | Scheduling: hidden on Misskey despite complete backend; where visible the date input is raw ISO; no scheduled list/cancel UI. | v1 `schedule.ts`, `Composer.tsx:592-609`; v2 `api/composer.ts:167-170`, `ComposerSections.tsx:122-132`, `ScheduledApi.list/delete` unused | done (W3 2026-10-21: quick chips + future-validation on the ISO field, scheduled list/cancel UI in both chromes; tested) | P1 |
| C9 | Server drafts: data layer complete, no UI or capability. | v1 `serverDrafts.ts`, `FloatingComposer.tsx:463`; v2 `Backend.serverDrafts` unused | done (W3 2026-10-21: list/restore/delete/save-current UI in both chromes, hidden where the sub-module is absent; tested) | P2 |
| C10 | Bookmarks/favourites: write path exists but is gate-disabled on Misskey, and no screen exists to view saved posts. | v2 `state/cache/gates.ts:31-39`, `core/detect.ts:202-237`; v1 `NoteMenu.tsx:491-497`, `routes/Favorites.tsx` | done (W3 2026-10-21: menu toggle → shadow queue → backend verified end-to-end with optimistic badge; saved-posts screen stays W4/N10) | P0 |
| C11 | Notifications: grouping loses actor list/count/reactions; no grouping toggle; no per-type receive config; no live counter; mark-read has no query cache. | v1 `Notifications.tsx:198-337`, `NotificationRow.tsx:217-273`; v2 `Notifications.tsx:102-211` | done (W4 2026-10-21: grouped/flat toggle, "N others" counts, misskey receive-config panel, unread pill+hook, infinite-query cache, mark-read mutation; full grouped-reaction breakouts ride the MD1 adapter remainder) | P1 |
| C12 | Notification rows unpressed/dead-end is N20; avatars, relative time, grouped count and per-group open are C11. | see N20, C11 | done (W4 2026-10-21 with N20/C11; grouped rows open the first actor — no actor-list route in scope, documented in-file) | P0 |
| C13 | Profile editor missing entirely (name/bio/fields/avatar/banner/emoji/lang/followedMessage); backend only covers a subset. | v1 `ProfileEditor.tsx`, `FloatingProfileEditor.tsx`; v2 none | done (W4 2026-10-21: `ProfileEditorScreen` — generic + misskey-only fields, avatar/banner honestly disabled, write path verified live on Akkoma + reverted, 6 tests) | P1 |
| C14 | Profile fields parsed but never rendered; account reactions block missing. | v1 `Profile.tsx:311`, `ProfileCard`; v2 `misskey/adapt.ts:106`, `Backend.accountReactions` unused | done (W4 2026-10-21: fields via allow-listed AST + Verified marker, reactions block mounted with honest mastodon-unavailable state verified live, 7 tests) | P2 |
| C15 | Lists are read-only at the data layer (no create/rename/delete); membership dialog exists but no list index/feed. | v1 `routes/Lists.tsx` (read-only) + `ListFeed`; v2 `core/backend.ts:411-417`, `List.tsx` placeholder | done (W4 2026-10-21: `ListsApi.create/update/delete` both families, index + `list\|id` feed screens, full CRUD verified live on Akkoma + rig cleaned; Misskey-family live unverified — rig down) | P1 |
| C16 | Post-menu parity rows not wired: mute-boosts (no handler), mute/block labels never flip, clip/report disabled, antenna/memo/DM/notify/RSS/search-notes/refresh-remote rows disabled or absent. | v1 `NoteMenu.tsx:421-668`; v2 `menuModel.ts:59-197`, `PostHandlers.tsx:49-58` | done (W4 2026-10-21: mute-boosts toggle via relation snapshot, Mute/Unmute + Block/Unblock + boost flips, 3 tests; report/clip and unbuilt-screen rows stay honestly disabled until W5 screens exist) | P1 |
| C17 | Mute/block search lost relation state/undo (v1 showed Mute/Unmute, Mute reposts/Unmute, Block/Unblock from search results). | v1 `Settings.tsx:971-1183`; v2 `MutesSection.tsx:158-251` | partial | P2 |
| C18 | Repost-mute is one-way; renote-mute list placeholder states a false reason; `unmuteRenotes` never called. | v1 `Settings.tsx:1356-1365`; v2 `MutesSection.tsx:232-238,421-426`, `Backend` lacks `renoteMutes` | done (W4 2026-10-21: menu toggle + two-way list where `renoteMutes` exists (misskey, unit-tested — live unverified, rig down); mastodon keeps the honest no-endpoint placeholder; false reason removed) | P1 |

---

## 5. Settings, appearance, i18n, platform

| ID | Gap | Evidence | State | Pri |
|---|---|---|---|---|
| P1 | Text scale does not resize post bodies, bios, composer or quotes; only Body/Caption/Heading scale. Row hint promises the opposite. | v1 `global.css:891-897` all sizes; v2 `alf/typography.tsx:32-33` vs `RichText.tsx:230,260`, `TextField.tsx:35`, `Composer.tsx:233` | bug | P0 |
| P2 | Feed toggles appear inert: prefs read via non-reactive default arg; mounted Network screen doesn't re-render. | v1 Solid signal `feedPrefs.ts`; v2 `state/feedPrefs.ts:29`, `queries/feeds.ts:35-50`, `Network.tsx:22` | bug | P1 |
| P3 | Theme/palette/user font/content-mode rows are placeholders; `contentMode` schema is dead and typed `'mfm' \| 'plain'`; theme model is only light/dark. | v1 `Settings.tsx:296-676`, `state/{appearance,userFont,contentMode}`; v2 `DisplaySection.tsx:124-147`, `storage/schema.ts:21,45-47` | stub | P1 |
| P4 | Import/export and emoji-prefs backup placeholders: no document picker, file system or sharing dependency. | v1 `Settings.tsx:1410-1564`; v2 `TransferSections.tsx`, `ReactionsSection.tsx:241-246` | stub | P2 |
| P5 | i18n effectively unimplemented: only `en`; ~14 Lingui macros; Settings/Posts/Composer/Notifications hardcoded English; no LocaleProvider/setLocale; no locale-aware numbers/dates; error codes not localized despite DECISIONS. | v1 `i18n/locales/*` (8), `locale.tsx`; v2 `locale/i18n.ts:7-8`, `Root.tsx:72-74`, `MutesSection.tsx:76-101` | missing | P1 |
| P6 | Account section lacks backend label/handle and external-account note; identity block thinner than v1. | v1 `Settings.tsx:233-250`; v2 `AccountSection.tsx:103-116` | partial | P2 |
| P7 | No hover cards (desktop profile preview with follow action). | v1 `UserHoverCard.tsx`, `ProfileCard.tsx`; v2 none | missing | P2 |
| P8 | No web keyboard support: Escape does not close popups/dialogs; no arrow-key menu navigation. | v1 `NoteMenu.tsx:855-874`, `EmojiPicker.tsx:270`, `Explore.tsx:351-366`; v2 grep → none | missing | P2 |
| P9 | No reduced-motion handling; all route transitions are `animation: 'none'` (deliberate v1 parity) and no motion preference branch. | v1 mobile `useReducedMotion`, `docs/mobile_2.md` §5B; v2 grep → none | missing | P2 |
| P10 | Touch targets unverified against 44/48 dp; post action rows/tab labels are small by construction. | v1 prototype recorded 37 dp compose pill; v2 `ActionBar.tsx:32-38`, `Navigation.tsx:616-629` | partial | P2 |
| P11 | No status-bar/system-ui control; `expo-system-ui` unused. (See N22 for icon/splash.) | v2 `package.json:59`, no import | missing | P2 |

---

## 6. Misskey / Sharkey data layer

| ID | Gap | Evidence | State | Pri |
|---|---|---|---|---|
| MK1 | Word/server mutes are stored and parsed but never applied to feeds; only soft-mute runs, only on Home. | v1 `misskey/softMute.ts` + `TimelineFeed.tsx:154-171`; v2 `softMute.ts` unused, `HomeFeed.tsx:121` | done (W4 2026-10-21 with F22: `filterModerated` in shared `FeedView`; live Misskey-family verification blocked — rig :3101/:3102 down) | P1 |
| MK2 | Favourites/bookmarks capability missing from the Misskey flavor row, so the action is disabled; `bookmarks.add` shares the favourite endpoint (double-toggle risk if both enabled). | v2 `core/detect.ts:202-237`, `gates.ts:31-39`, `misskey/backend.ts:416-432`; v1 `favorites.ts` | done (W1 2026-10-20: misskey/sharkey `bookmarks: supported` — v1 shipped `i/favorites` + `notes/favorites/create\|delete`; gate un-blocks, menu labels Favorites; saved-posts screen still W4/N10) | P0 |
| MK3 | Translation module + translator exist but no consumer; capability stays unknown on Misskey/Sharkey. | v1 `TranslatableText.tsx:63,78`, `translate.ts`; v2 `misskey/translate.ts:73`, `menuModel.ts:144` | done (verified W3 2026-10-21: consumer wired — `PostCard` translate + gated menu row, both tested) | P1 |
| MK4 | Schedule backend complete but unreachable (capability); no UI consumer. | v2 `misskey/backend.ts:345`, `api/composer.ts:167-170` | done (verified W3 2026-10-21: `submitPost` scheduled branch + composer schedule UI, tested) | P1 |
| MK5 | Server drafts backend complete but no UI/capability. | v2 `misskey/backend.ts:378-414` | done (W3 2026-10-21: C9 UI + hooks; tested) | P2 |
| MK6 | Duplicate drafts models (fedi vs app), different keys/shape/limits; fedi's is dead and `carryLegacyDrafts` never called. | v2 `packages/fedi/src/misskey/drafts.ts` vs `src/storage/drafts.ts` | partial (W3 2026-10-21: app drafts declared the authority — see DECISIONS; unification rides W8 Q6) | P1 |
| MK7 | Legacy session migration ported/tested but never invoked at boot. | v2 `core/sessions.ts` migration fns, `Root.tsx:52`; test comment "not used yet" | unwired | P1 |
| MK8 | Custom-emoji store's remote-host fallback and `unavailable` vs `error` states unused; picker reads only `backend.customEmojis()`. | v1 `customEmoji.ts:110,226-239`; v2 `customEmoji.ts:231`, `EmojiPicker.tsx:33-41` | partial | P1 |
| MK9 | Poll voting has no UI consumer (see F8). | v2 `misskey/backend.ts:629` unused | unwired | P1 |
| MK10 | Pinetree fixtures and `fixtures/manifest.json` provenance not carried; Pinetree coverage is 4 inlined bodies. | v1 `test/fixtures/{pinetree,manifest.json}`; v2 fixtures tree | missing | P2 |
| MK11 | Smoke script covers detect/meta/timeline/post/account anonymously only: no auth, writes, streaming, or sub-modules. | v2 `scripts/fedi-smoke.ts:147-235` | partial | P2 |
| MK12 | Many ported modules have no direct/indirect tests: auth, external, customEmoji, drafts, favorites, featured, importExport, likeEmoji, listMembership, remotepost, schedule, serverDrafts, softMute, clips, antennas, reactions lists, pin/mute-thread/report. | v2 `packages/fedi/test` import scan | partial | P2 |
| MK13 | `Backend.like` has no capability key; first heart tap on vanilla Misskey issues a doomed `notes/like` before falling back. | v2 `misskey/like.ts:27`, `gates.ts:53` | partial | P2 |
| MK14 | Pinetree offers a poll control its server rejects (`composeGates.poll` unconditional). | v2 `api/composer.ts:164`, `detect.ts:260` | bug | P2 |
| MK15 | Inherited flavor facts unverified: `polls_multi:"unsupported"` for Misskey/Sharkey contradicts documented `poll.multiple`; bookmarks/edit/translation/schedule facts need live probes. | v2 `core/detect.ts:202-237`; v1 `docs/api-surface.md:67` | done (W1 2026-10-20: misskey/sharkey `polls_multi`→supported per api-surface:67; `bookmarks`/`status_editing`/`scheduled_posts`/`server_drafts`→supported per v1-shipped modules; pinetree `translation`→unsupported live-probed `:3000/meta translatorAvailable:false`; Akkoma `:4000` quote/editing flags confirmed; catodon/pinetree edit/bookmarks/schedule, Sharkey/Misskey live probes still blocked — rig :3101/:3102 down) | P1 |
| MK16 | Reference-only modules would throw if reached (`reactionActions` provider, `myReactions` scope never set). | v2 `misskey/reactionActions.ts:33` | partial | P2 |
| MK17 | Remote-post resolver unused; "Copy remote link" uses raw `post.uri`. | v2 `misskey/remotepost.ts`, `menuModel.ts:134` | unwired | P2 |

---

## 7. Mastodon + cross-backend data layer

| ID | Gap | Evidence | State | Pri |
|---|---|---|---|---|
| MD1 | v2 notifications: type filters never sent to `/api/v2/notifications`; no paging (`cursor: null`); grouped actors/count dropped; errors swallowed into a v1 retry. | v2 `mastodon/backend.ts:696-729`, `adapt.ts:570-596`; v1 `Notifications.tsx` | partial (W4 2026-10-21: `types[]`/`exclude_types[]` on both paths, real v2 Link cursor, only 404/405 falls back, 20 tests, live fallback verified on Akkoma; real `notification_groups` envelopes fall back to flat v1 — grouped-actor fidelity needs the `adapt.ts` fix per DECISIONS) | P1 |
| MD2 | Bookmarks never paginate (`cursor: null`). | v2 `mastodon/backend.ts:863-878`; v1 same bug | done (W4 2026-10-21: real Link-header cursor; bookmark add/list-page-2/remove round-trip verified live on Akkoma) | P1 |
| MD3 | Server filters: `/api/v2/filters` only (no v1 fallback for Akkoma/Pleroma), never called by UI. | v2 `mastodon/backend.ts:777-825`; v1 `Settings.tsx` filters | done (W4 2026-10-21: v2 group shape fixed + v1 fallback on 404/405; full create/update/delete round-trip verified live on Akkoma; still no UI caller — filters UI is not a W4 row) | P2 |
| MD4 | Sanitizer regressions: `<span class="invisible">` text becomes visible; list bullets lost; headings flattened. | v1 `mastodon/sanitize.ts` class allow-list, `HtmlBody.tsx:105-133`; v2 `core/content/fromHtml.ts:50-105,185-357` | bug | P1 |
| MD5 | Session restore trusts stored tokens (no boot re-verify) and no token refresh; expired tokens look signed in until a 401. | v1 `state/auth.tsx:138-156` verify+clear; v2 `state/session/store.ts:224-245`, `mastodon/wire.ts:446-448` | missing | P1 |
| MD6 | `updateProfile` silently drops location/birthday/followedMessage/lang/`ext`; avatar/banner refused. | v2 `mastodon/backend.ts:526-548`; v1 `ProfileEditor.tsx` per-family tabs | partial | P2 |
| MD7 | Follow requests fixed at 40, no paging; costs an extra `me()` call. | v2 `mastodon/backend.ts:227,502-510`; v1 `FollowList` paged | partial | P2 |
| MD8 | `account()` uses `/accounts/lookup` only, no fallback for older servers. | v2 `mastodon/backend.ts:433` | partial | P2 |
| MD9 | `scheduled.list` returns `post:null, draft:null`; cannot preview a scheduled post. | v2 `mastodon/backend.ts:894-899` | partial | P2 |
| MD10 | Streaming: advertised `streamingOrigin` ignored; one socket per handle (second subscribe closes first); no app consumer; `subscribePost` no-op. | v2 `mastodon/instance.ts:69-81`, `stream.ts:56-68,177-235` | partial | P1 |
| MD11 | GoToSocial/glitch-soc/Hometown collapse to `mastodon`; GTS News tab appears then 404s. Unverified against live GTS. | v2 `core/detect.ts:131-141,397-405`, `backend.ts:668` | partial | P2 |
| MD12 | Direct endpoint/oauth/instance calls throw `MastoHttpError`, which `isUnsupportedError`/`isPermissionError` do not recognize. | v2 `mastodon/client.ts:80-96` vs `misskey/client.ts:283-296` | bug | P2 |
| MD13 | Two family classifiers (`mastodon/instance.detectFamily` vs `core/detect.detectServer`) can disagree. | v2 both paths | partial | P2 |
| MD14 | No tests for OAuth, quoteMarker, presentation, thread cycles, filters/bookmarks/scheduled/lists/uploadMedia/updateProfile/followRequests; fixtures lack grouped-v2 notification, media-processing, filter, list payloads. | v2 `packages/fedi/test` | partial | P2 |
| MD15 | `Backend` surface lacks `channels`, `drive.folders`, `lists.create/update/delete`, `renoteMutes`, `announcements`; some Phase 5/6 work cannot start without interface additions. | v2 `core/backend.ts:483-630` | done (W1 2026-10-20: all six added as OPTIONAL members — `DriveFoldersApi`, `ChannelsApi`, `AnnouncementsApi`, `ListsApi.create/update/delete`, `Backend.renoteMutes?`; no existing call site changed, tsc proves) | P1 |

---

## 8. Correctness, docs, stale records

| ID | Gap | Evidence | State | Pri |
|---|---|---|---|---|
| Q1 | Task index overstates completion (p3.8/p3.10 done, acceptance unchecked); p3.6/p3.7 boxes unchecked but marked done. | v2 `docs/tasks/README.md:24-28` vs task files | bug | P1 |
| Q2 | Stale DECISIONS: scheduling rationale ("Mastodon lacks scheduling") and renote-mute ("no backend list endpoint") are false. | v2 `docs/DECISIONS.md:47,61` | bug | P2 |
| Q3 | Bubble tab dropped silently in v2 (v1 recorded the reason); no DECISIONS/ADR line. | v1 `routes/MyNetwork.tsx:19-23`; v2 no entry | bug | P2 |
| Q4 | Bottom-sheet deferral recorded only in a log/code comment, not DECISIONS. | v2 `components/Dialog.tsx:20-21`, `state/logs/2026-10-20-p1.4-components.md:21-22` | bug | P2 |
| Q5 | Stale comments/accessibility copy ("write path lands in Phase 4", "no follow buttons render"). | v2 `ReactionChips.tsx:33`, `screens/User.tsx:18-23`, `p4.2` task | bug | P2 |
| Q6 | Duplicate feed implementations with divergent contracts (`FeedView` production vs `PostFeed` test-only); `PostRow` dead. | v2 `screens/HomeFeed.tsx`, `components/PostFeed/PostFeed.tsx` | partial | P2 |
| Q7 | Test coverage thin for routes/back/scroll/skeletons/notification activation/Compose escape; no route-table test like v1's. | v2 `src/__tests__/nav.test.tsx`, `nav-escape.test.tsx` | partial | P2 |
| Q8 | No `safeHttpUrl` on model URLs (same as F4) and no test for it. | v2, see F4 | bug | P1 |
| Q9 | v1 mobile/product specs not carried into v2 docs, so future sessions cannot see the requirements. | v1 `docs/mobile.md`, `docs/mobile_2.md`, `docs/clients.md`, `docs/my_network.md`; v2 `docs/README.md:12-15` | missing | P1 |

---

## 9. Planned or deliberately deferred (do **not** treat as bugs)

These are still "missing" today but have an owner decision or a plan
slice. The implementer should not "fix" a `deferred` row without a new
decision; `planned` rows are picked up in phase order.

### Phase 5 (deck/widgets)

- Deck columns, column picker, widgets, right-rail host (5.1–5.8).
- Phone deck is optional; D7 is still open.
- Capability gating for antenna/clip/list columns depends on MK15/MD15.

### Phase 6 (parity long tail)

Explore/search/hashtag, lists CRUD, antennas, clips, channels, drive
browser, favourites/bookmarks, filters UI, mutes/blocks remainder,
profile editor, translation, import/export, scheduled posts, server
drafts, settings appearance/language/feeds/reactions, terminal theme,
user font, locale import. (See `rn-rebuild-plan.md:338-340`.)

### Phase 7 (ship)

Web build/hosting, Android/iOS release, Maestro E2E, perf, retirement.

### Explicit owner decisions

- Settings rows without backing render disabled with a reason, never
  omitted (`DECISIONS.md:61`).
- Themes/palettes/user font/content mode deferred (no alf consumer)
  (`DECISIONS.md:61`).
- Import/export + emoji backup deferred (no file sharing)
  (`DECISIONS.md:61`).
- Misskey server filters deferred (no endpoints) (`DECISIONS.md:61`).
- Mastodon-family word/server mutes + quote refusal deferred (needs
  Misskey `i/update` ext) (`DECISIONS.md:61`).
- Locales other than `en` deferred (`DECISIONS.md:61`).
- Alt-text edit after upload, mute duration, notification settings/push,
  per-note `noQuote`, boosts-only mute deferred (`docs/tasks/p4.*`).
- Bottom sheets deferred in favour of anchored popups/dialogs
  (log-only today — see Q4).
- Route transitions off, popup entrance minimal (v1 parity,
  `butterfly-v1-parity.md:39-40`).

---

## 10. Workstreams and suggested order

Each workstream is a resumable session (or several). Do not start a
second workstream before the first is green; cross-workstream changes to
`RichText`, `PostCard`, `Navigation.tsx` and `routes.ts` are the known
collision points.

| WS | Name | Primary rows | Why first |
|---|---|---|---|
| W1 | Foundations | S1, S3, S6, MD15, MK15, N1–N2 | Unlocks ~1/3 of P1 rows; fixes false capability copy |
| W2 | Content & media | F1–F17, MD4, MD10 (family), MK8, MK17 | Biggest daily-use gap; mostly wiring |
| W3 | Composer & post actions | C1–C9, MK3–MK6, MK13–MK14 | Posting is core; fixes silent data loss/leaks |
| W4 | Social, profile, notifications | C10–C18, N18, N20, MD1–MD3, MK1–MK2 | Notifications/bookmarks are currently dead ends |
| W5 | Screens & routing | N3–N17, N19, C15 | Turns data-layer readiness into usable screens |
| W6 | Mobile platform | N21, N22, C2–C3, P9–P11, F24 | Device quality; safe area/keyboard are visible bugs |
| W7 | Settings, appearance, i18n | P1–P8, Q9 | Text scale is wrong today; locales are a stack of work |
| W8 | Data correctness & docs | MD5–MD14, MK7, MK10–MK12, Q1–Q8, F21–F22 | Prevents drift and regressions while W1–W7 land |

Within each workstream: fix the `bug` rows first, then `unwired`, then
`partial`/`missing`. Add tests at the same time as the fix; a row is not
done until the register says so and the verification is recorded.

---

## 11. Verification requirements

Every workstream session must end with:

- `pnpm typecheck && pnpm lint && pnpm test` green (or the `node_modules/.bin`
  equivalents if `pnpm` is unavailable, as in prior sessions), pasted into
  the session log.
- A device/web check for UI rows: Android Oppo via adb (`3B15A500TQD00000`,
  360 dp), web at phone + rail + full widths. Paste a screenshot path or
  command output; write `not verified` otherwise.
- A rig check for data rows once a server is reachable (Pinetree :3000,
  Akkoma :4000, Misskey :3101, Sharkey :3102 when up). Do not mark a
  capability fact `done` without one; MK15/MD11 are explicitly unverified.
- An update to this register's row states + `docs/tasks/gap-closure.md`
  checkboxes + `state/STATE.md` + `state/logs/YYYY-MM-DD-*.md`.
- Any new deliberate non-fix recorded in `docs/DECISIONS.md` before the
  code lands.

## 12. Audit caveats

- Source-read only: no device, browser or live-rig run was performed for
  this register. Device rows are `unverified` until executed.
- Misskey :3101 and Sharkey :3102 were down; Pinetree :3000 has no CORS
  headers and its seed creds return 401. Misskey-family facts are
  unit-tested only except Akkoma :4000 login.
- iOS has never run in v2; keyboard, back-swipe and safe-area claims are
  code-derived.
- Unverified specifics: GoToSocial classification, native `File` uploads,
  split-host streaming, real `polls_multi`/bookmarks/edit/translation
  capability values, RN-web `RefreshControl` and `Share`.
- v1 itself had known gaps (e.g. no PWA, no deck); those are not listed as
  v2 regressions. `docs/clients.md` is historical and superseded by
  plan §7 D1 / ADR-0001.
