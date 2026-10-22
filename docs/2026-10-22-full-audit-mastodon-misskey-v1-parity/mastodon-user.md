Keystonev2 as a Mastodon frontend replacement — audit
Method: inventoried Mastodon web UI from app/javascript/mastodon/features/ (58 feature dirs), then verified each in keystonev2 via grep on src/ (UI) vs packages/fedi/ (data layer). "Data ✓" = endpoint/adapter exists; "UI ✓" = reachable screen/component. All claims cite paths. Note: docs/parity-gaps.md is stale on media — it says F1/F2 "missing," but the code now has both (details below). Trust code over register.
1. Verdict + coverage
Verdict: viable daily driver for core Mastodon use; not yet a full replacement. Roughly ~80% of Mastodon's user-facing surface is wired end-to-end, ~90%+ exists at the data layer. The remaining ~20% clusters in: DMs, hashtag follow/mute, domain blocks, edit history, report-flow depth, list policies, avatar/banner upload, push, and niche settings.
Area	Data layer (packages/fedi)	Wired UI (src/)
Timelines (home/local/federated, live)	✅	✅
Thread, profile, follow/requests	✅	✅
Composer core + polls + schedule + drafts	✅ (minus hide_totals)	✅
Media view/upload/alt/lightbox/video/audio	✅	✅ (register stale, code proves it)
Interactions (reply/boost/fav/bookmark/pin/mute/block/report)	✅	✅ (report = simplified)
Notifications	✅	✅ mostly
Search + trends/news	✅	✅
Lists, filters v2	✅	✅ (list policies ✗)
Hashtag follow, domain blocks, DMs inbox, directory	❌/✗	❌
Profile edit, prefs, multi-account	✅ mostly	✅ mostly (avatar ✗)
2. Feature-by-feature table
Timelines
Mastodon feature	v2 status	Evidence
Home timeline + streaming	✅ UI + data	src/screens/Home.tsx, FeedView in src/screens/HomeFeed.tsx, live via useFeedLive (parity-gaps S4 done)
Local / Federated timelines	✅ UI + data	src/screens/Network.tsx tabs social/local/federated, canonical /network/federated in src/routes.ts:18-32; backend timelines/public?local in packages/fedi/src/mastodon/backend.ts
Streaming state UI	✅	src/components/StreamBadge.tsx mounted
Direct timeline / DM inbox	❌ missing	No direct in FeedDescriptor (packages/fedi/src/core/feedDescriptor.ts:15-19 has only home/local/social/global); contract docs/mastoapi-contract.md:259,403 says /api/v1/timelines/direct absent on Akkoma, no inbox route in src/routes.ts
Compose + read DMs in threads	✅ partial	Direct visibility + RecipientSection recipient picker in src/components/Composer/ComposerSections.tsx:193-211; posts viewable in thread only
Link timeline (/timelines/link)	❌	No evidence in backend or routes
List timelines	✅ UI + data	src/screens/List.tsx, src/screens/Lists.tsx, backend.lists + timeline(listId) at mastodon/backend.ts:1023-1071
Tag timelines	✅ UI + data	src/screens/Tag.tsx, fetchTagTimelinePage at mastodon/backend.ts:721
Post detail + thread
Mastodon feature	v2 status	Evidence
Status detail + context tree	✅ UI + data	src/screens/Note.tsx, mastodon/thread.ts, /statuses/:id/context
Replies / Reposts / Reactions tabs	✅	Note.tsx tabs + RepostsList/ReactionsList (parity-gaps F19)
Live delete/update capture	✅	Feed-level capture (WS-G); subscribePost filters shared user stream (mastodon/stream.ts)
Edit history view	❌	No history/edit_history UI or endpoint in packages/fedi/src/mastodon/ (only trend-history sums in endpoints.ts:415-454)
Delete-and-redraft	❌	No evidence; delete exists (DELETE /statuses/:id), redraft path absent
Ancestor connectors / "Replying to"	⚠️ partial	Ancestors render, no connectors (parity-gaps F20 still open)
In-thread filtering/moderation	✅	filterModerated in shared FeedView (F22)
Profiles
Mastodon feature	v2 status	Evidence
Header (banner/avatar/fields/verified/counters)	✅	src/components/Profile/ProfileHeader.tsx, ProfileBanner.tsx, ProfileAvatar.tsx; field allow-list + Verified marker (C14)
Tabs Featured/Posts/Replies/Media	✅ (≈)	src/components/Profile/ProfileTabs.tsx:32 (featured/posts/replies/media; Mastodon web uses Posts / Posts+replies / Media — close, pins covered by Featured)
Pins	✅	pin/unpin in backend; Pin to profile menu row; Featured tab
Account media grid	✅	Media tab via `user
Followers / Following lists + counter links	✅	src/screens/Followers.tsx, Following.tsx, counter links in header (N12)
Follow / unfollow / pending state	✅	ProfileActions.tsx via useGraphActions/useRelationship; requested:true handled
Follow requests queue (locked accounts)	✅	src/screens/FollowRequests.tsx, FollowRequests route; authorize/reject in mastodon/backend.ts:580-603
Mute / block / mute-boosts / notify toggle	✅	ProfileActions.tsx:55-65 relation-aware labels; reblogs param mute-boosts (backend.ts:1203-1216); Notify about new posts string exists
Hover cards (desktop preview)	✅	UserHoverCard.tsx mounted on avatar+name, web-only (P7)
Composer
Mastodon feature	v2 status	Evidence
Visibility: public/unlisted/followers-only/direct + local-only	✅ UI + data	visibilityOptionsFor, visibilityRaw round-trip (Composer.tsx:157-171); Only people you name (direct), Only your followers, Local only/Visible only on this server strings; direct gated via c.options kind check
CW / spoiler text	✅	Content warning row, CW: prefixes, scheduledSnippet poll/CW drafts (ComposerSections.tsx:310)
Sensitive media marking	✅ data; UI toggle not directly verified	Sensitive gate exists on view side; composer sensitive not grepped in ComposerSections.tsx — treat as ⚠️
Polls: multi, expiry, add/remove choices	✅ UI + data	multiple toggle (ComposerSections.tsx:88), pollDurationSeconds default 86400 (Composer.tsx:121,205), Add choice/Remove last, Multiple choice; vote UI PostPoll.tsx via backend.votePoll (mastodon/backend.ts:490)
Poll hide_totals	❌ data gap	Wire poll shape has only {options, expires_in, multiple} (mastodon/wire.ts:440, compose.ts:95) — no hide_totals
Poll preset expiries (5m…7d like poll_form.jsx:113-150)	⚠️	Duration is free-seconds + quick chips only for schedule; poll preset list not verified
Post language selection	❌	language_dropdown.tsx equivalent absent; no language in ComposerSections.tsx (grep empty); backend only maps lang on profile update (backend.ts:608)
Scheduled posts: set time + manage/cancel	✅ (better placed)	ISO field + future validation + 1h/tomorrow-9h/next-week chips (ComposerSections.tsx:141-186), Scheduled posts list + cancel (useScheduledPosts/useCancelScheduled, :322-334); data fetchScheduledStatusesPage (endpoints.ts)
Draft autosave + drafts list/restore	✅	Debounced autosave keyed by session (Composer.tsx:187-192), drafts list/restore/delete, server drafts UI (C6/C9)
Reply handling (prefill, keep target)	✅	Replying to @, Write your reply, targets re-attach on restore (Composer.tsx:213-241)
Edit post	✅	Compose?editId + useEditPost cache patch, schedule hidden in edit mode (C7)
Quote compose + refusal recovery	✅	quoteId route param, Quoting @, QUOTE_DISABLED* drop-and-repost with server reason (C5); quote policy refusal row exists
Character/attachment limits	✅	Over the limit, Attachment limit reached, A post cannot have both media and a poll
Media
Mastodon feature	v2 status	Evidence
Attachments grid in posts	✅	PostMediaGrid.tsx mounted from PostCard.tsx:856
Alt text (view + compose)	✅	Description (alt text) row (ComposerSections.tsx:127-128), Describe the media
Alt-text edit after upload	❌ (deferred)	Per parity-gaps §9 deferred list
Gallery / lightbox viewer	✅ (register stale)	Lightbox.tsx mounted in PostCard.tsx:443,908-912 with index state — S2/F1 "unwired" rows are outdated
Video / gifv / audio playback	✅ (register stale)	expo-video VideoView gifv-loop + video + audio box in PostMediaGrid.tsx:162-245 — F2 "missing" is wrong
Sensitive media per-item gate	✅	Sensitive media hidden — tap to show per-item labels
Safe URLs (avatar/media/share)	✅	safeHttpUrl gating (Q8)
Interactions
Mastodon feature	v2 status	Evidence
Reply / boost (+undo) / favourite	✅	ActionBar.tsx, setStatusToggle favourite/reblog (backend.ts:472-487)
Bookmark + saved-posts screen	✅	bookmark/unbookmark (backend.ts:1100-1103), FavoritesScreen.tsx with page-2 round-trip live-verified (MD2/N10)
Pin/unpin	✅	Unpinned/Pin to profile rows
Mute thread	✅	muteStatusThread, Mute thread + Thread muted
Mute / block account	✅	Menu rows with relation-aware flips (C16), mutes settings screen
Report	⚠️ simplified	onReport(comment) + required-comment dialog + toast (PostHandlers.tsx:82-87, menuModel.ts:49-51,166-190); Mastodon's multi-step report/ flow (category.jsx, rules.jsx, statuses.jsx, comment.tsx) is collapsed to one dialog — statuses/categories/rules steps missing
Translate	✅	Gated Translate row + Show original (C13/MK3)
Copy link / remote link / RSS	✅	Copy link, Copy remote link (warms cachedRemotePostUrl), Copy RSS
Quote approval display	✅ partial	Refuse incoming quotes account setting, Only show authorized quotes, tap-to-reveal hidden quotes
Notifications
Mastodon feature	v2 status	Evidence
All Mastodon types incl. quote/poll/update/admin	✅ data, ⚠️ UI	Type sets mapped + v2 grouped adapter (adaptV2Group, grouped actors/count); unknown types render generic row (contract §6, MD1)
Type filtering (server-sent types[])	✅	NOTIFICATION_FILTER_PRESETS, types[]/exclude_types[] sent (MD1, Notifications.tsx:171-212)
Grouped vs flat toggle	✅	Grouped/Flat toggle (Notifications.tsx:283)
Mark read / mark-all-read / unread badge	✅ mostly	Unread badge + N new pill (Navigation.tsx:321-364), mark-read mutation; Mark-all-read is not on this server — Mastodon-family all-read is ⚠️
Per-type push/receive config	⚠️ misskey-only	Per-type notification settings are only available on Misskey-family servers
Pressable rows (actor/post links)	✅	NotificationRow.tsx avatars, Open profile of the notifier, Open the post, relative time (N20)
Live notification channel	✅	useLiveNotifications (S4)
Empty/error states	✅	No notifications, Could not load notifications, retry testIDs
Search / explore / trends
Mastodon feature	v2 status	Evidence
Accounts / statuses / hashtags search	✅	searchV2 (endpoints.ts:369-398), search.posts/tags/accounts (backend.ts:714-744)
#/@ autocomplete	✅	suggestTags/suggestAccounts, ExploreSuggestPopup, suggest-gated (N4)
Trending tags / posts / links + suggestions + news	✅	fetchTrendingTags/Statuses/Links, fetchSuggestions (endpoints.ts:409-530); trending users unavailable honest states; news tab hidden without endpoint (Explore.tsx:458-480,668-672)
Hashtag follow / mute	❌	No followed_tags/follow_tag/mute tag calls anywhere in packages/fedi/src/mastodon/ or screens; Tag screen has no follow button
Profile directory	❌	Explore users = suggestions + search only; no directory endpoint
Search resolve for remote accounts	✅	resolveAccountByHandle: lookup → v1 search → v2 resolve (endpoints.ts:179-246)
Lists / filters
Mastodon feature	v2 status	Evidence
Lists CRUD + member add/remove + list feed	✅	lists.create/update/delete (backend.ts:1049-1071), ListAdder-equivalent membership hooks, ListScreen feed (C15/N6)
List replies_policy (none/followed/list)	❌	Zero hits for replies_policy in packages/fedi/src and list screens
Exclusive lists	❌	No evidence
Filters v2 CRUD: keywords/contexts/expiry/hide-vs-warn	✅ mostly	v2 groups + v1 fallback (backend.ts:903-1002), Add filter, contexts/expiry/irreversible mapped; feed enforcement via filterModerated (MD3)
Filter contexts UI per-context toggles	⚠️	Core Filter is phrase-shaped; per-context toggles not directly verified in FiltersSettingsScreen.tsx
Profile editing / prefs / accounts
Mastodon feature	v2 status	Evidence
Edit name/bio/locked/bot/fields	✅	ProfileEditor.tsx:1-92 (locked/bot/fields + caps), updateProfile with honest refusal for unsupported fields (backend.ts:608-627)
Avatar / banner upload	❌ (honest)	Avatar and banner changes are not supported on the Mastodon family yet; rows render disabled with reason
Default visibility / default sensitive / quote policy / language defaults	⚠️	Refuse incoming quotes (OHo4/Q) exists; default-privacy/sensitivity rows not verified
Appearance: theme/mode/text size/fonts/content-mode	✅ mostly	Text scaling multiplies all prose (P1), content-mode auto/plain (P3), feeds prefs reactive (P2), 8 locales + 527 macros + locale dates (P5); themes/palettes/user font = honest placeholders (deferred)
Multi-account switching	✅	AccountMenu with per-session rows, one-tap switch, per-account sign-out, Add account (Navigation.tsx:374-499); per-origin token isolation (contract §2.6)
MFA login	✅	Two-factor code flow (LoginFlows.ts)
Niche / long-tail
Mastodon feature	v2 status	Evidence
Domain blocks (view/manage)	❌	No domain_block endpoint/UI; MutesSettingsScreen.tsx has zero domain hits; relationship domain_blocking parsed in wire only
Mute with duration / mute notifications toggle	❌ (deferred)	Deferred per parity-gaps §9
Status edit history UI	❌	See thread row
Announcements	❌	announcements API exists only misskey-side (core/backend.ts:522-530); no UI, no mastodon mapping
Push subscriptions	❌	No push code anywhere
Keyboard shortcuts (full j/k map + shortcuts modal)	⚠️ partial	Web Esc/arrows/Enter on popup/dialog/menu tested (web-keyboard.test.tsx:86-148); no global shortcut map or shortcuts help screen (keyboard_shortcuts/ has no counterpart)
Screen-reader labels	✅ broad	accessibilityLabels on media open, notifications, tabs, account menu, strip back, etc.
Empty / error / loading states	✅	Nothing here yet, No notifications/scheduled/filters/drafts, skeletons, Could not load… + Retry everywhere, not verified honesty pattern
Onboarding flow	❌	No counterpart to onboarding/
Interaction modal (signed-out follow gating)	⚠️	Signed-out shells degrade to sign-in prompts (Sign in to do this, Explore never shows sample data when signed out) rather than a modal
Batch/mass actions, yearly review, severed_relationships special UI	❌/generic	Rendered as generic rows at best
Account migration/aliases, endorsements, featured tags	❌	No evidence
3. Top blockers for daily-driver Mastodon use
1. No DM inbox — direct posts can be sent (recipient picker ✓) but not read anywhere; Mastodon users with active DMs cannot use v2 as their only client (feedDescriptor.ts, routes.ts — no conversations route).
2. No hashtag follow/mute — core Mastodon curation loop; tag timelines exist but following a tag is impossible (zero followed_tags code).
3. No domain blocks UI/data — instance-level moderation is a daily tool on Mastodon; entirely absent.
4. Simplified report flow — single comment dialog vs Mastodon's category/rules/statuses chooser (report/category.jsx, rules.jsx, statuses.jsx); acceptable for filing, lossy for moderators.
5. No avatar/banner editing — honestly disabled, but profile editing without pictures will bounce every new user (ProfileEditor.tsx:4, errors.unsupported.avatar).
6. No edit history / delete-and-redraft — reading edited posts is fine; auditing what changed is impossible.
7. List replies policy + exclusive lists missing — list power-users lose reply filtering.
8. No push notifications — mobile daily-driver gap (no push code at all).
9. Poll hide_totals + composer language missing — data-layer gaps that will surface as wrong-looking polls/audience on strict servers.
4. Niche gaps (full list)
DM link-timeline; profile directory; announcements; onboarding; full keyboard-shortcut map + help modal; interaction modal; push; granular notification/push settings on Mastodon; default visibility/sensitivity settings; mute durations; alt-text post-upload edit; per-note noQuote; boosts-only mute; filter keyword whole_word UI surfacing; followed-tags timeline; featured tags; endorsements; account aliases/migration; annual report / moderation-warning special rendering; severed_relationships UI; status edit history; list replies policy; exclusive lists; exclusive/audio captions; picture-in-picture (Mastodon has picture_in_picture/ — v2 lightbox has no PiP); emoji reactions on Mastodon (correctly absent — vanilla has none); translation of bios vs posts split; rens — none.
One correction for the maintainers: docs/parity-gaps.md rows F1, F2, S2 (lightbox/media/video "missing/unwired") are contradicted by current code — PostCard.tsx:443,856-912 mounts Lightbox, and PostMediaGrid.tsx:162-245 plays video/gifv/audio via expo-video. Those rows should be marked done.
