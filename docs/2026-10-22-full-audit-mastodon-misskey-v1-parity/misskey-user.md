keystonev2 as a Misskey frontend replacement — audit
(1) Verdict + coverage %
Verdict: strong core, incomplete product. keystonev2 covers the daily-driver social loop (timelines, notes, reactions, notifications, search, lists, antennas, clips, drive browser, mutes/blocks, multi-account) with tested code. Whole Misskey product areas are absent (channels UI, gallery, pages, Play/Flash, chat, announcements surface, avatar decorations, deck/widgets), and several niche-but-real flows are stubs (import/export, drive upload-from-browser, file captions, tag follow/mute, some notification types).
Coverage: ~68% of user-facing Misskey surface functional (my count: ~48 of ~70 inventoried items fully or substantially working; 8 partial/stub; 14 missing). Method: inventoried misskey/packages/frontend/src/pages + components/Mk* + misskey-js notificationTypes, then verified each against keystonev2/src + packages/fedi/src, distinguishing implemented-tested-wired from implemented-but-unwired (a recurring pattern in this repo — see docs/parity-gaps.md S2) and from mounted UI.
Caveat: docs/parity-gaps.md is partly stale (e.g. F8 "no poll UI" vs. the existing PostPoll.tsx), and several rows claim "done" with not verified — rig down (:3101/:3102) for Misskey-family live behavior. Treat Misskey-family live paths as unit-proven, not server-proven.
(2) Feature table
Misskey feature	v2 status	Evidence
Timelines home/local/social/global	✅	src/screens/HomeFeed.tsx, Network.tsx; descriptors timeline|* in packages/fedi/src/core/feedDescriptor.ts; misskey/backend.ts timeline dispatch
Antenna timelines + editor	✅ (live unverified)	src/screens/Antennas.tsx, Antenna.tsx; AntennasApi in core/backend.ts:386; parity-gaps N8 done
Antenna keyword/user-list src	✅ data layer	AntennaSrc, keyword groups in core/backend.ts:366-384
Channel timelines + follow	❌ no UI	ChannelsApi exists (core/backend.ts:516) but no route, no screen — routes.ts has no channel entry; no channel screen in src/screens/
Channel create/edit (channel-editor.vue)	❌	No equivalent anywhere in v2
User-list timelines + CRUD	✅ (live unverified)	src/screens/Lists.tsx, List.tsx; ListsApi.create/update/delete (core/backend.ts:430)
List feed user-list-timeline	✅	list|<id> descriptor + List.tsx
Clip feed + detail + add-to-clip	✅ (live unverified)	src/screens/Clips.tsx, Clip.tsx; menu clipRow in menuModel.ts:85-93; ClipsApi.containing (core/backend.ts:419)
Tag feed + hashtag taps	✅	src/screens/Tag.tsx, tag|<name> descriptor; TagBubble.tsx mounted in card headers
Tag follow / tag mute	❌	Zero matches for tag-follow/mute in packages/fedi/src; Misskey hashtags/* follow endpoints unwired
Search notes/users/tags + suggest/autocomplete	✅	src/screens/Explore.tsx (AccountsSearch, tag suggest, search.posts feed); backend.search
Explore trending users/tags/posts, news	✅ partial	Trending users/tags/posts in Explore.tsx:132-436; news tab exists but gated (explore.news, unavailable without caps)
Notes: post/reply/CW/visibility	✅	Composer.tsx (CW toggle, visibilityRaw, localOnly), visibilityOptionsFor + reply-narrowing in api/composer.ts:100-135
Specified/direct + recipient picker	✅	RecipientSection in Composer; visibleUserIds persisted (parity-gaps.md C4 done)
Renote vs quote decision matrix	✅	adapt.ts:262-301 (isPureRenoteNote → pure renotes fold, content+renote → Post.quote); textual RE: fallback via misskey/quote.ts wired (WS-A); docs/quote-posts.md policy
Quote auth display policy	✅	Show-all default + opt-in onlyAuthorizedQuotes toggle, quotePolicy.test.ts, PostQuote.tsx
Reply threading (ancestors/descendants)	✅ partial	thread() + threadReplies() in misskey/backend.ts:512-540; usePostThread.ts; ancestors/connectors incomplete per F20
Note detail tabs Replies/Reposts/Reactions	✅	Note.tsx + PostPoll/RepostsList/ReactionsList (F19 done)
Poll display + vote + expiry/multi	✅ UI exists	PostPoll.tsx (161 lines, vote wired) mounted in PostCard.tsx:916-920; polls_multi gate in api/composer.ts:165-166 — contradicts stale F8 "missing" row
Reactions + custom emoji + picker	✅	ReactionChips.tsx, EmojiPicker.tsx store-backed (WS-C), per-session recents, remote-host tables
Like-emoji fallback semantics	✅	likeKind()/likeEmoji in ActionBar.tsx:126-166, postActions.ts; MK13 capability key fixed
Like vs reaction distinction	✅	kind === 'reaction' vs favourite branches in ActionBar.tsx:205-245
Custom-emoji fallback (remote :name@host:, display-name emoji)	✅	EmojiImage packed→remote→author→listing chain; DisplayName/ProfileHeader/NotificationRow session-aware (WS-C, 8/8 live probe on Akkoma)
MFM rendering fidelity	✅ substantial	RichText.tsx (571 lines) + core/content/fromMfm.ts, fromHtml.ts, ast.ts; WS-B: $[x2/x3/size/color/bg/rotate/font/center] + spin, invisible node, mchip chips, li→bullets, headings; allow-listed, no WebView/innerHTML
Translation button + auto-translate	✅ (live unverified)	PostCard.tsx:228-363,613-669; menu translate row; gated on translatorAvailable
Unfurl / link preview	✅	Server post.card → LinkCard; client unfurl → UnfurledLinkCard (PostCard.tsx:924-927); per-post unfurl deliberately declined (DECISIONS)
Note edit	✅	Compose?editId + composer edit mode + useEditPost cache patch (C7 done); misskey/noteEdit.ts
Schedule note + scheduled list/cancel	✅	misskey/schedule.ts; Composer schedule section + scheduled list/cancel UI (ComposerSections.tsx:141-360)
Server drafts list/restore/save	✅	misskey/serverDrafts.ts + Composer server-drafts UI (C9 done); local drafts in src/storage/drafts.ts (fedi dupe deleted, WS-E/MK6)
Favorites (Misskey i/favorites)	✅	src/screens/Favorites.tsx, bookmarks descriptor, misskey/favorites.ts (MK2 gate fixed)
Thread mute	✅	Backend.muteThread (misskey/backend.ts:864); menu mute-thread row (menuModel.ts:247-248)
Channel mute	❌	No channel-mute API or UI found
Word mute (soft, badge) + hard/instance	✅ partial	misskey/softMute.ts (checkWordMute/checkNoteWordMute); shared filterModerated drops hard words/blocked/instances in feeds; server soft-words deliberately badge-less (DECISIONS, F22)
Drive browser + folders CRUD + rename/sensitivity/delete	✅ (live unverified)	src/screens/Drive.tsx; DriveFoldersApi (core/backend.ts:359); file rename/sensitivity/two-tap delete
Drive upload from browser	❌	Drive.tsx:1-5 header: "v1 Drive parity without uploads"; uploads only via composer pickMedia (Composer.tsx:58)
File caption / alt-text edit post-upload	❌	Composer passes alt: '' for new uploads (Composer.tsx:346,366); no caption editor; alt-edit deferred (parity-gaps §6)
Drive file detail/notes (drive.file.*)	❌	No file-detail or "notes using this file" screen
Notifications: all Misskey types	⚠️ partial	Of 22 notificationTypes (misskey-js/src/consts.ts:19), adapt maps 12 (adapt.ts:340-353); unmapped: scheduledNotePosted/Failed, roleAssigned, chatRoomInvitationReceived, exportCompleted, test, login, createToken → fall to unknown
Notification filtering + grouped/flat + receive-config	✅	Notifications.tsx, notifications.ts query (include/exclude types, grouped mode), receive-config panel, unread pill (C11 done)
Notification rows pressable	✅	Actor/post links, avatars, relative time (N20/C12 done)
Follow / follow-requests accept/reject	✅	graph.ts, FollowRequests.tsx, misskey/followRequests.ts
Block / mute / renote-mute two-way	✅	Menu flips + MutesSection relation-aware undo (C16–C18 done); renoteMutes on Misskey-family
Profile tabs notes/clips/pages/gallery/featured	⚠️ partial	v2 tabs: featured/posts/replies/media (ProfileTabs.tsx:29) + AccountReactionsBlock; no clips/pages/gallery sub-tabs (User.tsx has no clip/gallery reference); Misskey index.files/activity absent
Profile editor (name/bio/fields/avatar/banner/lang)	✅ partial	ProfileEditorScreen.tsx generic + misskey-only fields; avatar/banner honestly disabled (C13)
Hashtag follow/mute, trends decree	❌	See tag row; trends display-only
Widgets / deck columns / right rail	❌	Navigation.tsx:383-390 is a "Widgets land in Phase 5" placeholder (N19, planned Phase 5)
Settings: profile/privacy/notif-prefs/theme	⚠️ partial	Real routes: account/display/reactions/feeds/mutes/import/export/filters/language (routes.ts); missing: privacy, notification prefs UI beyond receive-config, theme editor/custom CSS, sounds, webhook, 2FA/email/security, drive settings, plugin/registry
Emoji picker prefs + theme hooks	✅ basic	ReactionsSettingsScreen, emojiPrefs.ts, appearance.ts, alf/themes.ts; full theme editor absent
Import/export real transfer	❌ stub	TransferSections.tsx: honest placeholders, "no file-picker or file-sharing primitives" (P4 deferred)
Multi-account switch/add/remove	✅	AccountSwitcher.tsx, session/store.ts (switch/remove, per-origin tokens), per-sessionId query keys
Login (MiAuth + OAuth flows)	✅	Login.tsx, LoginFlows.ts, AuthCallback.tsx, miauth handling
Announcements / achievements / roles / ads	❌	AnnouncementsApi is data-only (core/backend.ts:521); no announcements UI, achievements, roles, ads, invite, contact surfaces
Gallery / Pages / Play-Flash / games / chat / groups	❌	No screens, no routes, no backend modules for any of these
Avatar decorations / emoji manager	❌	No equivalent
Report / abuse flow	✅	reportRow with required-comment confirm → Backend.reportAccount (WS-D)
Copy link / remote link / share	✅	menuModel.ts:202-226, cachedRemotePostUrl fallback (MK17)
Pinned / bookmarked / edited / soft-muted badges	⚠️	badges.ts + tests exist (F10/F16 area) — mounting in PostCard not verified this pass
social/local/global/search legacy URLs	✅	rewriteLegacyPath in routes.ts + nav.test.tsx (N1 done)
(3) Top blockers for daily-driver Misskey use
1. No channels UI at all — data layer ready (ChannelsApi, channel|<id> descriptor) but zero screens/routes. Channel users lose a primary Misskey surface. (Highest value-per-effort item: descriptor + feed plumbing already exist.)
2. Misskey-family live verification blocked — :3101/:3102 rig down; antennas, clips, drive, mutes, translation, scheduled, drafts carry not verified live. Nothing here is proven against a real Misskey/Sharkey server.
3. Notification type gaps — scheduledNotePosted/Failed (matters once scheduling UI ships users into that flow), roleAssigned, exportCompleted, chat-invitation types render as unknown. Filter presets also omit them.
4. Drive is browse-only — no upload-from-browser, no captions, no file-detail/usage view. Composer attach covers posting, but drive-as-library is half a product.
5. Profile missing clips/pages/gallery tabs — creators' Misskey profiles surface clips, pages, gallery; v2 shows only featured/posts/replies/media + reactions.
6. Import/export are honest stubs — account migration (following/mutes/notes) is a real Misskey settings flow; v2 cannot move data (no picker/filesystem primitives — needs native modules).
7. No deck/widgets — Misskey power users live in decks/antennas-as-columns; the rail is a placeholder (planned Phase 5). Antenna-as-column depends on this.
8. Settings depth — privacy knobs, notification prefs, sounds, 2FA/security, webhook, theme editor all absent; only 9 sections exist.
(4) Niche / long-tail gaps
- Channel mute, thread-mute list UI (mute exists per-note; no list management surface seen), mute durations.
- Tag follow/mute; word-mute badge display (server soft-words filter feeds but show no badge by decision).
- Poll multi-choice on Pinetree gated unsupported per live probe (WS-E) — correct but worth re-probing if Pinetree updates.
- Quote noQuote/reaction-acceptance per-note controls deferred (parity-gaps.md §6: per-note noQuote, boosts-only mute deferred to later slices).
- Like pre-flight on vanilla Misskey fixed fedi-side (MK13) but live-unverified.
- Grouped-notification actor fidelity on Mastodon-v2 envelopes live-unproven (no v2 server on rig).
- scheduledNotePosted failure surfacing — schedule create UI exists; post-failure notifications fall into unknown.
- Announcements/achievements/roles/avatar-decorations/games/chat/scratchpad/QR/theme-editor/registry/API-console — entire Misskey settings/playground tail absent; fine to defer, but "replacement frontend" should scope them explicitly in docs/V2_GAPS.md as won't-build vs later.
- Stale docs risk: parity-gaps.md F8/F16 rows contradict shipped code (PostPoll.tsx, badges.ts); audit before trusting row status.
- i18n tail: 8 compiled catalogs + 527-macro pass done (W7), but management-screen English tail remains (P5); Misskey-flavored strings (renote vs repost, note vs post) need a terminology pass (titleForRoute already maps Search/Note).
Bottom line: ship channels UI + profile content tabs + notification-type completion + a live Misskey/Sharkey rig pass, and v2 becomes a credible daily driver for timeline-centric users. Gallery/Pages/Play/chat/deck are the long road to full replacement.
