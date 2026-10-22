Keystone v2 as Mastodon replacement — admin / backend / power-user audit
1. Verdict + coverage %
Area	Coverage	Verdict
(a) Admin + moderation	~0%	v2 does not attempt admin. Zero admin endpoints, zero admin screens. Only trace is two optional wire flags. Not a replacement; not even a stub.
(b) Backend / data-layer (user-facing)	~65–70%	Timelines, posts, accounts, relationships, lists, filters, bookmarks, scheduled, search, notifications, streaming, OAuth are real and carefully built. Personal domain-blocks, endorsements, featured/followed tags, dismiss/clear, media edit, scheduled update, conversations/DMs, directory, push, instance peers/rules/terms are missing.
(c) Niche / power-user + forks	~35%	Akkoma quote-posts + emoji reactions + translation + MFM-source are handled and gated. Bubble timeline, tombstones, featured tags, endorsements, move/alias migration, import/export, 2FA/security settings, annual reports are absent.
No fake admin controls were found — the surface is absent, not inert. User-surface gating is generally honest (disabled-with-reason, unsupported errors), with the exceptions in §4.
2. Tables
(a) Admin
Reference: mastodon/app/controllers/admin/ (45 controllers), mastodon/app/controllers/api/v1/admin/ (13: account_actions, accounts, canonical_email_blocks, dimensions, domain_allows, domain_blocks, email_domain_blocks, ip_blocks, measures, reports, retention, tags + trends/), mastodon/app/controllers/api/v2/admin/accounts_controller.rb.
Admin capability (reference)	v2 status	Evidence
Dashboard / measures / dimensions (admin/dashboard_controller.rb, `api/v1/admin/measures	dimensions`)	MISSING
Moderation queue / reports (admin/reports_controller.rb, api/v1/admin/reports, report_notes)	MISSING (user-side report only)	Only POST /api/v1/reports (mastodon/endpoints.ts:836, backend.ts:708). No GET reports, no notes, no report_notes
Account actions warn/suspend/silence (admin/account_actions_controller.rb, `api/v1/admin/accounts	account_actions, api/v2/admin/accounts`)	MISSING
Moderation notes (admin/account_moderation_notes_controller.rb)	MISSING	No moderation_note anywhere in packages/fedi/src
Domain blocks / allows admin (`admin/domain_blocks	domain_allows_controller.rb, api/v1/admin/domain_blocks	domain_allows`, export variants)
Email/canonical/username/IP blocks (email_domain_blocks, canonical_email_blocks, username_blocks, ip_blocks)	MISSING	Zero hits in packages/fedi/src/mastodon/
Custom emoji admin (create/update/delete, admin/custom_emojis_controller.rb)	MISSING (public read only)	Only GET /api/v1/custom_emojis (endpoints.ts:1031, backend.ts:868)
Announcements admin (admin/announcements_controller.rb)	MISSING	Backend has Misskey-only read announcements?: AnnouncementsApi (core/backend.ts:681); no Mastodon POST /api/v1/announcements
Server settings / site uploads / relays / webhooks / FASP / software_updates (`admin/settings	site_uploads	relays
Invites / registrations (admin/invites_controller.rb, api/v1/invites)	MISSING	No invites, registr write in packages/fedi/src/mastodon/
Roles, rules, terms, trends admin (`admin/roles	rules	terms_of_service
Retention, collections, disputes, moderation subscriptions	MISSING	Zero hits
Admin scope / is_admin gating	MISSING	is_admin?/is_moderator? only exist as unread Pleroma extras (wire.ts:50-51); FeatureKey list (core/detect.ts:47-76) has no admin key; gateGraph (core/graph.ts:78) gates only follow/list, never admin
(b) Backend / data-layer
Item	Status	Evidence
OAuth app registration per origin + cache	DONE	mastodon/oauth.ts:197 registerApp, MASTO_SCOPES (oauth.ts:42), getCachedApp/cacheApp (oauth.ts:134-165)
Authorize URL: state + PKCE S256, single-use + 15-min expiry	DONE	buildAuthorizeUrl (oauth.ts:377), randomToken/pureSha256/s256Challenge (oauth.ts:265-374), savePendingAuth/takePendingAuth (oauth.ts:411-453)
Code exchange (form-encoded, client_secret always) + verify_credentials before store	DONE	exchangeCode (oauth.ts:486), verifyCredentials (oauth.ts:630), finishOAuthExchange (auth.ts:43)
Password grant (Akkoma/Pleroma) + MFA challenge	DONE	passwordGrant/mfaChallenge/MfaRequiredError (oauth.ts:534-602), firstPartyPasswordSignin/firstPartyMfa (auth.ts:75-111)
No-password-grant on vanilla Mastodon → injected token path	DONE (honest)	isUnsupportedGrantType (oauth.ts:512), normalizeInjectedToken/injectedSignin (oauth.ts:618, auth.ts:117)
Logout revoke RFC 7009 / i/revoke-token per family	DONE (best-effort)	revokeToken (oauth.ts:655), revokeSessionToken (core/sessions.ts:583)
Scope set: granular + umbrella always requested; legacy fallback read write follow only when no discovery doc	DONE, but over-scoped (see risk 9)	MASTO_SCOPES/FALLBACK_SCOPES (oauth.ts:42-70), discoveryPresent (oauth.ts:170), registerApp fallback (oauth.ts:236-249)
scopeHealth / needsUpgrade (stale pre-scope sessions)	DONE (session layer)	SessionScopeHealth, scopeHealth (src/state/session/store.ts:94-119, 423-474); 403 never clears session (store.ts:396-397)
Token per-origin isolation	DONE (strong)	Sessions keyed ${origin} ${accountId} (core/sessions.ts:52-59); createClient(origin, token) (mastodon/client.ts:391); cross-origin throw (client.ts:224-250); credentials: omit (client.ts:292); Link continuations origin-checked (pagination.ts:145-159); quote cache keyed per origin+token (backend.ts:1229, endpoints.ts:561)
Pagination: Link rel=next preferred, opaque Continuation, end = no-next OR empty	DONE	parseLinkHeader/nextContinuation/isEndOfFeed (pagination.ts:30-159); encodeContinuation/decodeContinuation (adapt.ts:703); used in endpoints.ts, backend.ts:318-325
Search paging	GAP — single page only	search.posts/tags/accounts/suggest* return {cursor: null, end: true} (backend.ts:715-743); searchV2 ignores Link headers (endpoints.ts:382)
Home / local / public timelines	DONE	fetchTimelinePage/timelinePath (endpoints.ts:82-153), backend.ts:391
Tag timeline	DONE	fetchTagTimelinePage (endpoints.ts:313)
Status detail + context → thread rebuild	DONE	getStatus/getStatusContext (endpoints.ts:329-367), rebuildThread (thread.ts, backend.ts:404)
Create (Idempotency-Key per attempt) / edit / delete	DONE	createStatus (statusActions.ts:167), newIdempotencyKey/attemptKeyFor (compose.ts:194-216), editStatus/deleteStatus (endpoints.ts:731-747), backend.ts:444-460
Favourite / reblog toggles (separate from reactions)	DONE	setStatusToggle (statusActions.ts:63), backend.ts:472-487
Emoji reactions (Akkoma/Pleroma extension, PUT/DELETE per emoji)	DONE + gated	reactionEndpoint/setEmojiReaction (statusActions.ts:79-130); gate reactionsSupported = instance flag OR sampled emoji_reactions (instance.ts:296-308); never merged with favourites (adapt.ts:339-374)
Poll vote (via poll id)	DONE	voteInPoll (endpoints.ts:770)
Pin / unpin	DONE	setStatusPinned (endpoints.ts:751), backend.ts:572-578
Follow / unfollow / relationships / followers / following	DONE	setFollowing/getRelationships/fetchAccountListPage (endpoints.ts:264-276, 650-678, 785)
Follow requests list / authorize / reject / cancel-via-unfollow	DONE	fetchFollowRequestsPage/answerFollowRequest (endpoints.ts:685-699, 881), backend.ts:580-606
Mute / block (account), mute-boosts via reblogs (refuses when not following), thread-mute	DONE	setMuted/setBlocked/setShowingReblogs/muteStatusThread (endpoints.ts:797-832); setBoostVisibility guard (backend.ts:1207-1222)
Mutes / blocks listing	DONE	fetchAccountListPage kinds mutes/blocks (endpoints.ts:653)
Personal domain blocks (GET/POST/DELETE /api/v1/domain_blocks)	MISSING	Zero endpoint calls; only domain_blocking relationship read (wire.ts:341)
User report (POST /api/v1/reports)	PARTIAL — bare account_id+comment only	reportAccount (endpoints.ts:836); no status_ids, forward, rule_ids, category params Mastodon supports
Filters v1/v2 CRUD with v2-first/404-fallback	DONE, lossy on multi-keyword groups (risk 5)	backend.ts:903-1012 (withFilterFallback, filterExpiresIn, adaptV2FilterRow keeps first keyword only)
Scheduled statuses list / create / delete	PARTIAL — no update	fetchScheduledStatusesPage (endpoints.ts:855), backend.ts:1107-1136; no PUT /api/v1/scheduled_statuses/:id
Bookmarks list / add / remove	DONE	backend.ts:1075-1105
Lists list / timeline / CRUD + membership	DONE (minimal fields)	backend.ts:1023-1073, listMembership.ts; create/update send only title (no replies_policy/exclusive)
Custom emoji public read	DONE	fetchCustomEmojis (endpoints.ts:1031), backend.ts:868
Emoji asset URLs (version-pinned CDN; fluent → null fallback)	DONE	api/emojiAssets.ts:61-92
Media upload multipart + 202 poll loop	DONE, no description/focus update	backend.ts:877-901, getMedia (endpoints.ts:1039); no PUT /api/v1/media/:id
Translation (POST /statuses/:id/translate, both response shapes)	DONE, gating suspect (risk 8)	translateStatus (endpoints.ts:1054), backend.ts:1014; capability flag exists (detect.ts:70, instance.ts:143-152)
Notifications v1 flat + v2 grouped fallback, markers-as-read-position	DONE, no per-row dismiss/clear	fetchNotificationsPage/fetchV2NotificationRows (endpoints.ts:895-1007), markNotificationsRead via POST /markers (endpoints.ts:1012); no POST /notifications/:id/dismiss or /clear
v2 search (accounts/statuses/hashtags) + handle lookup with fallbacks	DONE	searchV2 (endpoints.ts:382), resolveAccountByHandle (endpoints.ts:194 — lookup → accounts/search → v2 search, exact-match only)
Explore: suggestions / trending tags+posts / news (vanilla-only, hidden otherwise)	DONE	`fetchSuggestions/fetchTrendingTags
Instance v2 → v1 (404/405-only fallback), family/flavor detect, streaming-origin normalize	DONE	fetchInstanceCapabilities (instance.ts:211), detectFamily (instance.ts:90), normalizeStreamingOrigin (instance.ts:69), detectServer/detectFlavor/buildCapabilities (core/detect.ts)
Instance peers / rules / terms / extended description / activity	MISSING	InstanceV1/V2 types (wire.ts:369-409) carry only domain/title/version/stats/configuration; no peers, rules, terms, extended_description fetch
Link-preview / unfurl	CLIENT-SIDE SCRAPE, no server card API	fetchLinkPreview/extractLinkPreview fetch page HTML directly then opt-in CORS proxy (api/linkpreview.ts:85-243); PreviewCard only comes embedded on statuses (wire.ts:158); no GET /statuses/:id/card, no oembed, no server url-preview
Streaming WebSocket (user/public:local/public/hashtag/list, pooled, lazy, backoff 1s→30s)	PARTIAL (see risks 1–4)	createStreamHandle/streamUrl/routeMessage (stream.ts:70-439); token as ?access_token= (stream.ts:77-86); backend.ts:1138 stream()
SSE, user:notification, conversations, filters_changed, kill, per-post channel	MISSING/ignored	streamNameFor has no user:notification/conversation/social (stream.ts:92-108); routeMessage handles only update/status.update/delete/notification (stream.ts:241-294); subscribePost rides shared user stream (stream.ts:385-414)
Push subscriptions, markers GET, conversations/DMs, directory, profile directory	MISSING	Zero endpoint calls in packages/fedi/src/mastodon/
Query keys include sessionId (no cross-account cache bleed)	DONE	feedQueryKey/notificationsQueryKey/threadQueryKey/composeLimitsKey/scheduledPostsKey… all session-first (src/state/queries/Provider.tsx:17, usePostFeedQuery.ts:178, notifications.test.tsx:48-56, composer.ts:33-38)
Every action gated on Capabilities	MOSTLY (admin has no flag to gate on)	capabilities on backend (core/backend.ts:542), buildCapabilities table (core/detect.ts:222-421), gateGraph (core/graph.ts:78), sub-module presence gating (core/backend.ts:674-688); translation-menu gating uses Misskey translatorAvailable even for Mastodon (risk 8)
(c) Niche / forks / power-user
Item	Status	Evidence
Quote posts: Mastodon {state, quoted_status} + Akkoma nested Status; quote_id-without-object = unavailable	DONE	adaptQuote (adapt.ts:396-423), canQuoteVisibility (compose.ts:50), quoteMarker.ts, resolveQuoteUri/resolveTextualQuote via v2/search resolve:true + strict URI match (backend.ts:1229-1278, endpoints.ts:561-589)
Emoji reactions incl. Fedibird-compat path	PARTIAL	Pleroma PUT/DELETE …/reactions/:emoji wired (statusActions.ts:79-130); Fedibird PUT …/emoji_reactions/:emoji (no DELETE) noted in contract §4 but not wired
Tombstones (410 Gone / deleted-status tombstone JSON)	NOT MODELED	accountLookupFailure maps 410 → gone (endpoints.ts:251), but no Tombstone type/UI; deleted status = generic unavailable
Bubble timeline (Akkoma local+bubble / GET /timelines/bubble)	MISSING	timeline() supports home/local/global only; social throws unsupported (endpoints.ts:82-95, backend.ts:391-398); no bubble kind in TimelineKind (core/backend.ts:46)
Featured tags (/featured_tags, /followed_tags)	MISSING	Zero calls; contract marks GET /featured_tags present-on-M / absent-on-A but nothing implements it
Endorsements / profile pins UI (/endorsements, accounts/:id/endorse)	MISSING	wire.ts:343-344 types endorsing/endorsed but no endorse endpoint call; only status pin/unpin exists
Annual follow prompts / annual_reports	MISSING	Zero hits; wire/notification types don't include annual_report handling beyond generic unknown (adapt.ts:549-558)
Move / alias migration (POST /accounts/:id/move, also_known_as, moved_to)	READ-ONLY	moved adapted to {id,acct,url} (adapt.ts:260); no move/alias write, no migration UI
Import / export (Mastodon CSV: follows/mutes/blocks imports, exports/*)	MISSING on Mastodon family	misskey/importExport.ts exists for Misskey only; no /imports or /exports calls in mastodon/
2FA / security settings (recovery codes, webauthn, change-email, delete-account, notification/privacy settings)	MISSING (login-MFA only)	Only login mfa/challenge (oauth.ts:582); updateProfile covers display_name/note/locked/bot/fields/lang + 3 extras (backend.ts:608-668), refuses location/birthday/followedMessage and avatar/banner
2FA-gated hosts file / server rules acceptance during login	NOT SURFACED	No terms_of_service/rules fetch in login flow (LoginFlows.ts, auth.ts)
Media-sensitive, polls multiple/hide_totals, allowed_mentions	PARTIAL	statusBodyOf sends poll{options,multiple,expires_in} but no hide_totals, no allowed_mentions[], no quote_approval_policy (compose.ts:140-171)
Translation language auto-detect display	PARTIAL	sourceLang returned (backend.ts:1014-1021) but no language-list endpoint wired
3. Top 10 backend-correctness risks
 1. Streaming token in URL. streamUrl puts the Bearer in ?access_token= (stream.ts:77-86). Works on both servers but lands in logs/proxies; contract §8 documents Sec-WebSocket-Protocol (accepted by both, required to avoid this on Akkoma) yet the code never sends it and never sends a Bearer header. Fix: prefer Sec-WebSocket-Protocol, keep query-param as fallback.
 2. WS liveness gaps: no ping/pong, no kill, no filters_changed. Akkoma ping→pong text frames hit routeMessage, fail JSON.parse, and are silently dropped with no pong (stream.ts:230-244); kill (server asks for reauth) and filters_changed are unhandled. Stale/dead sockets look alive.
 3. No connected-ack timeout / fast-close breaker. Contract §8 specifies a 10s connected-ack timeout and stop-after-5-fast-closes with retry button; stream.ts:297-345 reconnects with 1s→30s backoff forever, onerror/onclose only flip state. A refused stream (401/bad antenna) retries indefinitely.
 4. Cross-host streaming token. streamingOrigin may be a different host (instance.ts:276-278) and the token is attached to it (stream.ts:77-86). Intended, but there is no scheme check (ws vs wss / http downgrade) at the call site — a malicious/rogue configuration.urls.streaming could pull the token off-origin. Pin to wss/https or warn.
 5. Filter v2 collapse is lossy + destructive on edit. adaptV2FilterRow keeps only the first keyword (backend.ts:244-261); update rewrites the group's keywords_attributes preserving ids (backend.ts:950-998) but title = phrase, so editing a multi-keyword (possibly admin-created) filter from this client renames/drops semantics. Read-only or full-keyword editing needed.
 6. Search pages are truncated. All search entry points hard-code {cursor: null, end: true} (backend.ts:715-743) and searchV2 ignores Link headers. Large/remote searches silently stop at page one.
 7. Report is under-specified for moderators. reportAccount(id, comment) sends only {account_id, comment} (endpoints.ts:836-845). Mastodon accepts status_ids[], rule_ids[], forward — omitted, so reports arrive without the offending posts or rule references; on strict servers they may be deprioritized.
 8. Translation gating may use the wrong flag. WS-D/WS-G notes gate translate on Misskey translatorAvailable (docs/V2_GAPS.md:53-55); Mastodon-family availability is configuration.translation.enabled / akkoma:machine_translation (instance.ts:143-152, core/detect.ts:407-419). If the menu checks the Misskey field, Mastodon translation stays hidden even when capabilities.translation === "supported".
 9. Scopes over-requested; needsUpgrade compares against the over-broad set. MASTO_SCOPES always includes umbrella read/write/follow plus ~20 granular scopes (oauth.ts:42-67), and scopeHealth diffs the cached app against that full list (src/state/session/store.ts:423-474). Least-privilege violated (push/bookmarks/filters/lists scopes requested before those features ship — contract §2.1 itself says to defer them), and old-but-adequate sessions read stale-scopes.
10. Cross-origin Link without cursors ends the feed. nextContinuation returns null for a cross-origin next-URL with no max_id/since_id/min_id (pagination.ts:145-159) — correct for token safety, but Akkoma-behind-proxy links or cursor-less endpoints then read as end-of-feed and drop data. Needs a same-origin rebuild or an explicit "more may exist" signal rather than silent end: true.
Honorable mentions: scheduled.update missing while create/delete exist (backend.ts:1107-1136); media description/focus update missing (PUT /media/:id unwired); thread-mute has no unmute; markNotificationsRead anchors at newest single row so concurrent arrivals can skip the marker (backend.ts:857-864); muted/muting_notifications wire flags are read but duration/notifications params never sent.
4. What would be needed for an admin-usable Mastodon replacement
1. New admin sub-module on the Mastodon backend (packages/fedi/src/mastodon/admin.ts, mirroring endpoints.ts discipline + toApiError boundary): api/v1/admin/accounts (list/show/approve/reject/suspend/unsuspend/silence/unsilence), account_actions, reports (list/update/assign/resolve + notes), domain_blocks/domain_allows (+ exports), email_domain_blocks, ip_blocks, canonical_email_blocks, username_blocks, trends review, retention, relays, webhooks, announcements CRUD, invites, roles, rules, settings. Each needs its wire type in wire.ts (currently admin shapes don't exist there).
2. Auth + gating: request admin:read/admin:write (+ admin:* granular) scopes only when the admin surface is entered; detect admin-ness from verify_credentials role / pleroma.is_admin/is_moderator (wire.ts:50-51,127) and add admin: FeatureSupport-style capability keys in core/detect.ts + gateGraph-equivalent admin gates — today there is no flag to gate on (§2a, last row). Multi-account rule (§6 of project rules) applies: every admin query key must carry sessionId, and admin tokens must never cross origins (reuse resolveSameOriginUrl + per-session client).
3. UI: dashboard (measures/dimensions charts), queues (reports, appeals/disputes, follow recommendations, trending review), account detail (actions + moderation notes + warnings presets), domain/email/IP blocks, emoji admin, announcements, invites/registrations, settings/site uploads — none exist in src/screens/; plan one screen per reference controller group, all hidden/disabled-with-reason when admin !== supported.
4. Safety bar: admin writes are irreversible (suspend, domain block) — require confirm + audit-log read (admin/account_moderation_notes, action_logs), optimistic updates forbidden here; surface 403 as scope/role problem, never "missing".
5. Verification: extend scripts/fedi-smoke.ts / fedi-w*-probe.ts with an admin matrix against the Mastodon rig (currently Misskey/Sharkey-only), plus the pnpm typecheck && pnpm lint && pnpm test + device/web evidence the project rules require. Rough size: ~6–10 slices (one per admin group above), each with ADR + task file + session log per repo protocol.
Bottom line: user-facing Mastodon support is solid and honestly gated; admin is a greenfield project, not a gap to patch.
