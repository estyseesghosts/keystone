# Frontend plan (MVP)

**Status:** Slices 0–7 built + API-verified 2026-10-16 against Misskey and
Sharkey (see `../state/logs/2026-10-16-roadmap.md`,
`../state/logs/2026-10-16-streaming.md`). Tracks `AGENTS.md` §5,
`docs/api-surface.md`, and `docs/keystone_roadmap.md`. Check boxes only with
executed evidence.

## Slice 0 — Scaffold

- [x] SolidJS SPA (`frontend/`: Solid 1.x + `@solidjs/router`, `mfm-js`)
- [x] Vite proxy for `/api` + `/files` (+ `/proxy`, `/streaming`) with
      selectable backend target (`--mode misskey` / `--mode sharkey`;
      `frontend/.env.misskey`, `frontend/.env.sharkey`)
- [x] `npm run build` succeeds; dev serves per-mode ports

## Slice 1 — Auth + shell (done, all three backends)

- [x] Typed `apiCall` helper (`src/api/client.ts`): `POST /api/${endpoint}`,
      `i` body-field auth, empty/204 handling, safe JSON parse, `error.message`;
      per-backend token keys (session isolation)
- [x] Keystone-owned login: Pinetree `signin`; Misskey-family `signin-flow`
      → Keystone permission screen → `miauth/gen-token` + check → scoped app
      token (no redirects; temp credential never persisted)
- [x] Token + current-user signals; startup `i` restore; auth-failure clears
      token; explicit sign-out; mobile account strip separated from bottom nav
- [x] `App` root + `Layout`, routes: `/login`, `/`, `/local`, `/global`,
      `/notifications`, `/notes/:id`, `/users/:id`
- [x] Loading / empty / error / logged-out states; visible keyboard focus

## Slice 2 — Timelines + note view (done)

- [x] Home (`notes/timeline`, auth), local (`notes/local-timeline`, public),
      global (`notes/global-timeline`, public — supported on both servers):
      limit 20, `untilId` "load older" with dedupe, exhausted end-state,
      retry-older (not refresh), failures keep loaded data
- [x] Note detail (`notes/show`): parent reply + renoted context as returned,
      direct replies via `notes/replies` (labeled partial, with paging);
      missing/invisible → API error path
- [x] `NoteCard` (avatar, name, handle, timestamp, text, CW, media by MIME
      type with failure fallback, counts), profile links from avatar/name and
      notification authors, mention resolution via cached `users/show`,
      `MfmRenderer` (allow-listed `mfm-js` subset, safe fallback, no
      `innerHTML`); quote embeds use a separate "Open quoted note" link

## Slice 3 — Interactions (done)

- [x] Compose text note (`notes/create`, reply via `replyId`, renote via
      `renoteId`, quote = text + `renoteId`); 3,000-char limit; `public` default
      (`public`/`home`/`followers`)
- [x] React/unreact (honor `myReaction`; counts reconciled from server,
      no optimistic counts): Misskey-style chips row (emoji + count, no
      deadspace when empty, hearts excluded) above the actions; like
      button (heart + total `reactionCount`, ❤ only) plus a stateless
      smiley emoji-picker button; changing reactions deletes-then-creates
      (server rejects double-reacts); `visibleReactions` tolerates
      transient null maps; rows are keyed by stable note id so server
      reconciliation updates in place (no remount flicker on like/unlike);
      chips keyed by stable reaction strings with accessor-fed counts;
      optimistic reaction updates with silent busy guard (no disabled
      flash) and server rollback on error;
      repost single-fire with persistent state;
      follow/unfollow (response is `UserLite`); delete own note (204 path)
- [x] Renote vs quote (Misskey `is-renote.ts` semantics): pure reposts render
      retweet-style (`X reposted` banner + the original; all actions target
      the original — the server rejects renoting/replying to a wrapper);
      quotes render as their own note with an embedded original; renote
      button opens a menu (Repost/Quote, or Undo repost/Quote when reposted)
      with an inline quote composer in feeds and on note detail
- [x] Repost collapsing (timeline/antenna feeds): an original plus its pure
      reposts show only the first repost (feed order); the banner aggregates
      renoters ("xx reposted", "xx and yy reposted",
      "xx, yy and zz reposted", "xx, yy, zz and N others reposted", names
      linked). Quotes never collapse. Raw items are kept for paging
      cursors/reconciliation, so `<For>` row identity is untouched
- [x] Profile timeline (`users/notes`); notifications with readable labels +
      timestamps + paging (`i/notifications` has no `isRead` — no read styling)

## Quote posts (done 2026-10-16, `docs/quote-posts.md`)

- [x] `src/api/quote.ts`: one `getQuoteTarget()` normalizer (structured
      `renote`/`renoteId` + Pinetree `quoteTargetUri` /
      `quoteTargetUnavailable` / `quoteAuthorizationStatus`, else terminal
      `RE: <http(s) URL>` fallback) → single `QuoteTarget` for the UI;
      pure reposts normalize to null (retweet presentation kept)
- [x] Rendering regardless of authorization: `pending`/`unapproved`/
      `rejected`/`revoked`/missing all render when the target is
      accessible; status is a neutral label only (`approved`/missing show
      none, so approval is never claimed); visibility stays server-side
      (`ap/show` fails closed, cached private content is never shown to an
      unauthorized viewer)
- [x] Textual fallback: narrow terminal-`RE:` parse (trailing punctuation
      trimmed; credentials/non-web/relative/mid-sentence/multi-URL
      rejected); resolves via authed `ap/show` (Note-only, deduped
      in-flight + bounded completed cache incl. failures, seen-note reuse);
      suffix suppressed in view only when its card renders; failures keep
      the original text/link; structured wins on conflict (duplicate suffix
      suppressed, otherwise text intact); exactly one card
- [x] `NoteBody` is the single quote path (packed or resolved embeds reuse
      CW/media/poll + `depth` guard; note detail no longer renders a second
      "Renoted" card); unavailable targets get a stable fallback box;
      compose stays structured (`renoteId`, no `RE:` rewriting)
- [x] Evidence: `tsc --noEmit` clean, `npm run build` green, 64/64
      normalizer/resolver unit checks, live `ap/show` + quote-shape probe
      on both servers (see `../state/logs/2026-10-16-quote-posts.md`).
      Browser visuals not yet verified (no browser here).

## Quote polish + auto translation (built 2026-10-16, `docs/quote-polish-translate-handoff.md`; browser QA owner-handled on dvd.chat)

- [x] Quote visual parity (`NoteBody` + `global.css`): 16px card radius
      with 16px padding and `overflow:hidden`; quoted head is avatar +
      name + `@handle · time` (shared `components/time.ts` `formatTime`,
      extracted from `NoteCard`); quoted text clamps to 4 lines
      (`.trans-text` only — the toggle line never clamps); quoted media
      renders flush edge-to-edge (bottom corners clip to the card radius),
      multi-media quotes stack the same flush treatment, never the
      interactive strip; outer media still renders above the quote card
      (text → media → poll → cards → quote, unchanged); status/
      unavailable states and the "Open quoted note" link kept; no counts,
      badges, or colors added
- [x] Auto translation (`src/api/translate.ts` + `TranslatableText`,
      used for outer AND quoted text via the same `NoteBody` path):
      `meta.translatorAvailable` capability read once per session
      (external-aware via `apiCall`; falsy/missing/404 → never attempt);
      public `notes/translate` `{noteId, targetLang}` → `{sourceLang,
      text}` (shape verified live on dvd.chat — sourceLang is an English
      display name, targetLang lenient); module-level id-keyed cache
      (successes settle, failures retry after a 90s TTL, in-flight dedupe,
      404 → session-wide off); token-scope policy (`decideTranslation`):
      no request without mfm-derived prose (mentions, hashtags, URLs/links,
      emoji never count); identical normalized output never shows (kills
      misdetections like an English post labeled "German"); differing
      sourceLang shows labeled; a same-language claim with substantially
      changed foreign-script text shows under a generic `Translated` label
      (detection distrusted, no false source claim), same-script rewrites
      stay hidden (normalization/hallucination noise); original renders
      first with no skeleton, monochrome toggle line, CW-gated (fires only
      after reveal), logged-out-safe (no credential sent)
- [x] Evidence: `tsc --noEmit` clean, `npm run build` green, 39/39 policy
      checks (`node` over an esbuild bundle of the TS source —
      `/tmp/opencode/translate-check.mjs`), live `meta`/`notes/translate`
      probes against dvd.chat (misdetect + hashtag/label translation +
      hallucinated-essay observations — see
      `../state/logs/2026-10-16-translate-scope.md`). Browser behavior
      (toggle, logged-out, no-endpoint server) not yet verified — owner
      live-testing on dvd.chat.

## Tag bubbles + chips + fold + infinite scroll (built 2026-10-16; browser QA owner-handled on dvd.chat)

- [x] Tag blocks (`src/api/tags.ts` `parseTagBlocks`): 2+ consecutive
      top-level hashtags (whitespace/newline + unicode/custom emoji are
      spacers, anything else ends the run); every block pruned view-only
      via sequential-`indexOf` raw ranges; bubble/popup set is the pruned
      tags only (`blockedTags`, first-seen dedupe) — lone hashtags stay
      inline with their long-standing rendering and never enter the
      bubble; `NoteCard` header + quote head carry the `(#first +N)`
      bubble with an outside-click/Escape popup of `/search?tag=` rows
      (renote-menu dismiss pattern, monochrome chip language)
- [x] Inline chips (`MfmRenderer` + `global.css` `.mchip`): @mentions
      (verbatim acct, existing resolution) and bare/labeled URLs (truncated
      display, full target, existing safety) as pills; lone hashtags
      explicitly NOT chips; `.mchip` rhythm (`vertical-align: middle` —
      `overflow:hidden` re-baselines inline-blocks — plus tight
      line-height) so chipped lines keep the surrounding line rhythm
      (`docs/spacing.png`, follow-up `2026-10-16-chip-spacing.md`)  
- [x] Timeline fold (`src/api/fold.ts` `foldMfm`, 750 budget, mentions/
      links uncounted, hashtags counted, text/plain-only word-boundary
      cut, never-sliced tags, post-cut zero-count drop): threaded
      `foldText` (default true) `NoteCard → NoteBody → TranslatableText`,
      which folds the displayed original-or-translation with `…` + `Open
      post` link and no inline expand; detail main + parent unfolded,
      depth > 0 never folds, notifications unfolded
- [x] Infinite scroll everywhere paged (shared `InfiniteSentinel`, 800px
      preload, guards mirror each loader, Try-again keeps remembered
      cursor, skeletons + You're-caught-up kept; `FollowList` retry
      upgraded from reset-to-initial, replies gained skeleton + end
      state): `TimelineFeed`, `Profile` notes + follow lists,
      `Notifications`, `Note` replies. All `Load older` buttons/strings
      deleted; `Search` untouched (single-shot); Drive keeps its own
      sentinel
- [x] CW translation probe (one round, deferred with no code change):
      dvd.chat `notes/translate` on a real CW note returns the translated
      BODY only — no CW, no `-----` separator — so the upstream split
      shape does not hold on this fork
- [x] Leading-`RE:` triple fix (2026-10-16, see
      `../state/logs/2026-10-16-re-quote-prefix.md`): `RE:` recognized
      leading-or-terminal (`RE_PREFIX_PATTERN`, same narrow rules);
      per-marker suppression only when its own (textual) or the matching
      structured card renders; stripped markers also suppress the
      duplicate LinkCard; structured always wins; 45/45 checks, `tsc` +
      build green; local-backend `ap/show` probe not run here (no
      backends on this machine) — owner live-tests on dvd.chat
- [x] Mention chips show resolved avatar + display name (full `@acct` on
      title); unresolved rendering byte-identical; `mentionCache` keeps
      the full `UserLite`
- [x] Evidence: `tsc --noEmit` clean, `npm run build` green, 41/41 unit
      checks (esbuild-bundle + node: blocks, budgets, cuts, empty/error
      states — `/tmp/opencode/tags-fold-check.mjs`), live CW probe output
      recorded (see `../state/logs/2026-10-16-tag-bubbles-fold-scroll.md`).
      Browser behavior (bubble/popup, chips, fold vs detail, stall-free
      scroll on all four sites) not yet verified — owner live-testing.

## Deliberately deferred (do not build until scoped)

Streaming Stage B (verify the same client against pinetree `/streaming`
when its Phase 3 lands — currently empty stubs, no route; the client stays
disabled in pinetree mode), full profile editor beyond the bounded
`i/update` subset (`avatarId`/`bannerId`, decorations, fields[]),
user-list management (blocks `list`-source antennas; that source is hidden
until the subset lands), Drive folder navigation, dark mode.

## Slice 7 — Streaming Stage A (done, Misskey/Sharkey only)
- [x] `src/api/stream.ts`: native-`WebSocket` client, no new dependencies;
  `?i=` auth, per-call channel ids, `connect`/`disconnect` with `pong:true`
  ack, refcounted `subNote`/`unsubNote`, broadcast `noteUpdated`
  dispatch, reconnect with capped exponential backoff + jitter, fast-fail
  `error` after repeated refused connections, per-channel `unavailable`
  on missing ack (10s), fully disabled in pinetree mode
- [x] `TimelineFeed`: endpoint→channel mapping (home/local/global/antenna),
  streamed notes prepend with in-updater id dedupe (never double-inserts
  against a pending refresh), newest-50 live capture (reactions/polls
  reconcile via `notes/show`, deletions remove in place), `StreamBadge`
  status + retry; paging + refresh unchanged and socket-independent
- [x] `Notifications`: `main`-channel `notification` events raise a
  "N new — Refresh" count only (no unread model — backends pack no
  `isRead`); `Note` detail: live capture (quiet re-read, explicit
  deleted state); replies still refresh manually (no replies channel)
- [x] Contract verified in server source on both backends (WS
  `read:account` gate → 401, per-channel kind/auth matrix, silent-ignore
  of unservable channels, 2-min idle reap); `scripts/smoke_streaming.py`
  27/27 through the Vite WS proxies; pinetree `/streaming` confirmed
  absent (stubs only) — client disabled there

## Slice 4 — Reliability hardening (done, roadmap P0)

- [x] One-step Misskey-family sign-in (redundant grant screen removed);
  native `user.token` correctly treated as full-authority, memory-only;
  scoped token verified with `i` before storing; honest unsupported-state
  error for extra sign-in steps; best-effort `i/revoke-token` sign-out
  that always clears local state
- [x] `NoteBody`: single CW/media/poll/renote rendering path reused for
  quote embeds (embedded CW + sensitive gates always apply; depth guard)
- [x] Reaction picker (preset + custom emoji; ❤️→❤ normalization
  accounted for), `notes/unrenote` undo, server reconciliation after
  reactions/reposts/votes
- [x] Follow state re-derived from `users/show` (following / pending /
  none; request cancel); note/profile routes reload on `:id` change
- [x] Smoke suites checked in (`scripts/`, env-configurable URLs) and
  fully green: flows 44/44, writes 14/14

## Slice 5 — Drive + composer attachments (done, roadmap P1 Keystone side)

- [x] Multipart `uploadDriveFile` (`FormData`, no hand-set Content-Type);
  `read:drive` + `write:drive` scopes
- [x] `DriveBrowser`: upload (busy/per-file error/retry/dismiss), cursor
  paging, media-type filter, attach-select mode, delete (two-step),
  sensitive toggle; 403 → re-sign-in hint; Pinetree 404 → honest
  upload-only (verified `drive/files` → `UNKNOWN_API_ENDPOINT` there)
- [x] Composer attachments via `fileIds`; uploads survive failed posts
- [x] `/drive` route + nav; contract suite 44/44 (upload/list/sensitive/
  attach-after-reload/delete round-trips on both servers)

## Slice 6 — Antennas, composer completion, search (done, roadmap P2–P4 Keystone side)

- [x] Antennas list/create/edit/delete/feed (`/antennas`, `/antennas/:id`);
  bounded filter set (home/all/users/users_blacklist, nested keyword
  groups, common flags); `list` source hidden (needs user-list subset);
  keyword semantics verified in server source; feed matching proven live
- [x] Composer: CW (100-char cap), `specified` + recipient picker,
  `localOnly`, polls (Misskey-family only; hidden on Pinetree), limit
  from `meta.maxNoteTextLength` with fallback; state preserved on errors
- [x] Poll voting with server refresh; profile editor (bounded `i/update`
  subset); followers/following lists; `notifications/mark-all-as-read`;
  `/search` (users authed, notes policy-aware, tags); hashtag links
- [x] `docs/setup.md` (run Keystone with Misskey/Sharkey/Pinetree),
  `docs/api-surface.md` capability contract, permission-denied paths
  tested (pre-scope tokens 403 as designed)

## Slice 8 — External accounts + account card (built 2026-10-16, browser QA pending)

- [x] Keystone as an external client (additive — internal `signin-flow` +
      proxy flow untouched): `src/api/external.ts` (host normalize,
      MiAuth authorize URL, direct-fetch `miauth/:session/check` + `i`
      verify, per-host session storage); `apiCall`/`uploadDriveFile` route
      direct to the active external instance, `apiCallInternal` keeps the
      auth store's session ops on the proxy backend; streaming refuses
      sockets while external is active (no external token ever reaches the
      local `/streaming` endpoint)
- [x] Account card (`AccountCard`: avatar + name + handle rounded-rect,
      menu with Profile / Settings / Switch-account SVG icons, per-host
      switcher + remove, add-external link) in the sidebar footer and the
      mobile strip; `/settings` route (session info + shared bounded
      `ProfileEditor`); `/login` gains an External-server tab (host →
      instance approval tab → manual finish + `extcb` callback auto-finish)
- [x] Evidence: `tsc --noEmit` clean, `npm run build` green, 22/22
      external-helper checks (`normalizeHost`, MiAuth URL, session
      storage); internal API suites NOT re-run here (backend DB layer down
      — see log); live-instance browser round-trip not yet verified

## Verification per slice

Build green, desktop + mobile, real Misskey + Sharkey flows, 204 handling, no
console errors, no unsupported calls, no inert controls, no React
dependencies. Latest evidence: `../state/logs/2026-10-15-stonekey.md`.
