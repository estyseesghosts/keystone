# Keystone rebuild: one React Native app (web, Android, iOS) on the Bluesky model

Status: proposal, 2026-10-20. Needs owner sign-off on §7 (open decisions) before Phase 1.
Inputs read: `estyseesghosts/keystone` @ `9e4ff89` (main, 2026-10-20), `bluesky-social/social-app` @ `cf16c1d` (main, 2026-10-20).

---

## 1. Recommendation

1. **Start a new codebase.** One Expo + React Native app that ships iOS, Android and web (`react-native-web`). Copy Bluesky's stack, folder layout, conventions and tooling as closely as possible. Pin Bluesky commit `cf16c1d` as the reference.
2. **Keep Keystone's data layer.** `frontend/src/{core,misskey,mastodon,api}` is about 17k lines of mostly framework-free TypeScript with ~560 tests and 29 recorded server fixtures (Misskey, Sharkey, Mastodon, Akkoma). Port it into a workspace package `packages/fedi`. This is the most valuable thing Keystone built.
3. **Do not port the UI.** The ~60 Solid components and routes and the 4.4k-line CSS do not transfer. Rebuild screens on Bluesky's component set. Keep the *product rules* (capability gating, no inert controls, token per origin, raw visibility passthrough).
4. **Freeze old Keystone.** Tag it, mark the README frozen, keep it as a read-only reference. Same treatment Keystodon got.
5. **Build the deck from day one in the data model, ship it in Phase 5.** Every feed is addressed by a `FeedDescriptor` string (Bluesky does this already). A deck column is just `{descriptor, sessionId, options}`. Widgets are a typed registry.

### Why this, and not the current path

- The native work so far (SymbioteNative) spent most of each phase on renderer bugs: `Animated.View` resolves to a string, `onChangeText` passes an event object, published RN 0.86 has no `hermesc` for release builds, no Detox harness for Solid. Bluesky ships the same three targets on Expo with none of these problems.
- The shared-primitives plan (Solid on two renderers) needs a web backend, a style compiler and a navigation layer that do not exist. React Native + `react-native-web` is that, already built.
- Bluesky already solved the problem the reaction guide took a full session on: `src/state/cache/post-shadow.ts` (optimistic overlay) + `src/lib/hooks/useToggleMutationQueue.ts` (click coalescing, server state feeds the next write). We reuse the pattern and extend it to Misskey reactions.

### What it costs

- A React rewrite of every screen. Budget it as the bulk of Phases 3-6.
- Reverses the AGENTS.md rule "SolidJS only, no React". Record the reversal (§7, D1).
- Larger web bundle than the Solid SPA. Bluesky's web is acceptable in practice; measure in Phase 7.
- `react-native-web` has no CSS grid and limited hover. The deck uses flex rows and horizontal scroll, which is fine.
- Desktop (Tauri) is dropped for now. Web covers desktop. Revisit after Phase 7.

---

## 2. Target architecture

```
packages/fedi/            pure TS. No react, react-native, DOM or window.
  core/                   models, detect (family/flavor/capabilities), backend interface,
                          http, sessions (storage injected), content AST, feed descriptors
  misskey/                wire, adapt, client, backend, auth, stream (WebSocket)
  mastodon/               wire, adapt, client, backend, oauth, stream (WebSocket)
  test/fixtures/          recorded server responses (carried over)

src/                      the app (Bluesky layout)
  alf/                    tokens, atoms, themes (Keystone grey light/dark), breakpoints
  components/             Button, Dialog, Menu, TextField, RichText, Post, ...
  screens/                one dir per route
  features/deck/          deck layout, columns, column picker
  features/widgets/       widget registry, host, built-in widgets
  state/session/          accounts, active session, token storage
  state/queries/          TanStack Query hooks over the Backend interface
  state/cache/            post shadow (optimistic like/react/repost/bookmark/delete)
  state/preferences/      UI prefs (React context, Bluesky pattern)
  storage/                MMKV + zod schema (device and per-account scopes)
  locale/                 Lingui
  lib/                    helpers, hooks (incl. useToggleMutationQueue)
  Navigation.tsx, routes.ts
```

Rules:

- The UI only sees `packages/fedi` domain models (`Post`, `Account`, `Notification`, `Capabilities`). Wire types never cross into `src/`. Enforced by lint (Slice 1.2).
- Every query key includes `sessionId`. This is what makes multi-account deck columns free later.
- Every action is gated on a `Capabilities` flag. Unsupported means hidden or disabled with a reason. Never inert.
- Content (MFM or HTML) is parsed in `packages/fedi` into one allow-listed inline AST. One `RichText` component renders it on all three targets. No `innerHTML`, no WebView.

### Feed descriptors (the deck's foundation)

```ts
type FeedDescriptor =
  | 'timeline|home' | 'timeline|local' | 'timeline|social' | 'timeline|global'
  | `list|${string}` | `antenna|${string}` | `channel|${string}` | `clip|${string}`
  | `tag|${string}` | `search|${string}` | 'bookmarks' | 'mentions'
  | `user|${string}|${'posts' | 'replies' | 'media' | 'featured'}`
```

`usePostFeedQuery(sessionId, descriptor)` serves every timeline screen and every deck column. Notifications are a separate column kind.

### Layout modes

- `classic` (default, all targets): Bluesky's shell. Phone: bottom tabs. Tablet/desktop web: left nav, ~600px center column, right rail. The right rail hosts widgets.
- `deck` (tablet/desktop web): horizontal row of columns, each independently scrolling. Phone: pager of columns, optional (Slice 5.8).

---

## 3. What carries over from Keystone

| Item | Action | Notes |
|---|---|---|
| `core/models.ts`, `detect.ts`, `backend.ts`, `http.ts`, `quoteUri.ts` | Port | Remove i18n imports. Data layer returns error codes and message keys; UI localizes. |
| `core/sessions.ts` | Port with seam | Replace `localStorage` with injected KV + secure-store interfaces. |
| `core/config.ts`, `hosting.ts`, `boot.ts` | Split | Hosting detection stays (web first-party mode). `window.location` use moves behind a `getOrigin()` param. |
| `misskey/*` (wire, adapt, client, backend, auth, sub-modules) | Port | `customEmoji.ts`, `stream.ts`, `translate.ts` use Solid signals: replace with plain emitters/maps. `stream.ts` builds the URL from `window.location`: use the session origin. |
| `misskey/reactionActions.ts`, `myReactions.ts` | Reference only | Replaced by post shadow + toggle queue (Slice 4.1). Keep the six test cases. |
| `mastodon/*` | Port | `sanitize.ts` uses `DOMParser`: replace with `htmlparser2` into the shared AST (Slice 2.4). `stream.ts` uses `EventSource` (SSE): replace with Mastodon's WebSocket streaming (`/api/v1/streaming`), which works on native. `oauth.ts` imports `../routes`: pass the callback path in. |
| `api/fold.ts`, `tags.ts`, `linkpreview.ts`, `emoji.ts`, `emojiAssets.ts` | Port | Check each for DOM use first. |
| `test/*.test.ts` for the above + `test/fixtures/` | Port | Vitest to Jest (mechanical: `vi` to `jest`). Test count per ported file must match. |
| `i18n/locales/*.ts` (8 locales, ~1100 keys) | Convert | Script maps old English values to Lingui source strings and writes PO files. Only exact matches carry over. |
| `docs/api-surface.md`, `mastoapi-contract.md`, `mfm.md`, `twemoji.md`, `setup.md`, `note-options.md`, `quote-posts.md`, `replies.md` | Copy to `docs/` | Still authoritative for server behaviour. |
| AGENTS.md §4 state protocol (STATE.md + dated logs) | Keep | Shorter. See §5. |
| AGENTS.md §5 backend contract rules | Keep verbatim | Sharkey 400s unknown fields, 204 handling, never send cross-origin tokens, etc. |
| Solid components, CSS, routes, `mobile/`, `src-tauri/`, shared-primitives docs | Drop | Reference only, in the frozen repo. |

Known lessons to encode as tests, not prose:

- Provider tree regression (`ContentModeProvider` lost in a merge killed every feed): add a test that renders `App` with a fixture session and asserts a post appears.
- Akkoma has no `/api/v2/instance`; v2 to v1 fallback only on 404/405 (`detect.test.ts` covers it, keep it).
- Account switch must not show the previous account's timeline (query keys include `sessionId`, plus a test).

---

## 4. Agent operating rules (put in the new AGENTS.md)

- One slice per session. One branch per slice: `p<phase>.<slice>-<topic>` (e.g. `p2.3-mastodon-port`). Merge to `main` only after the slice acceptance passes and the owner approves.
- Read order every session: `AGENTS.md`, `state/STATE.md`, latest `state/logs/*`, this plan's slice.
- Touch only the files the slice lists. If another file must change, stop and record why in the log.
- When Bluesky has a pattern for the thing, copy it. Look in the reference clone at `cf16c1d` first. Record the source path in the log, not in code comments. Keep Bluesky's MIT notice in `NOTICE.md`.
- Unpublished Bluesky deps (`link:./modules/*`) are not available. Use the closest published package and record the swap in `docs/DECISIONS.md`.
- Every slice ends with `pnpm typecheck && pnpm lint && pnpm test` green, pasted into the log. Native or web runs are pasted as screenshots or `not verified`.
- Never claim verification that did not run.
- Conventions are enforced by lint and typecheck, not by prose. If an agent keeps breaking a rule, add a lint rule (Slice 1.2 pattern).

### Slice template (every slice below uses it)

- **Goal**: one sentence.
- **Read first**: files and docs.
- **Files**: create / modify. Nothing else.
- **Steps**: numbered.
- **Acceptance**: commands + manual checks.
- **Deliverables**: branch, tests, `state/STATE.md` update, `state/logs/YYYY-MM-DD-<slice>.md`.
- **Out of scope**: what not to touch.

---

## 5. Phases and slices

### Phase 0: Decide and freeze

**0.1 Decisions record.** Owner + agent.
- Files: `docs/DECISIONS.md` (new repo).
- Steps: record answers to §7 D1-D8.
- Acceptance: every decision has a date and a one-line reason.

**0.2 Freeze old Keystone.**
- Steps: (1) commit and push local-only docs that STATE.md references but the remote lacks (`docs/shared-primitives-plan.md`, `docs/shared-primitives-phase0-handoff.md`, `mobile/docs/prototype-report.md`, `mobile/docs/primitives-evaluation.md`, phase 6 and mobile-report logs). (2) Tag `solid-final`. (3) Add a "Frozen, see <new repo>" line to README. (4) Final STATE.md entry.
- Acceptance: `git ls-remote --tags` shows `solid-final`; the four docs exist on the remote.
- Out of scope: any code change.

**Gate G0**: decisions signed, old repo tagged.

### Phase 1: Scaffold (Bluesky skeleton)

**1.1 Expo app skeleton.**
- Read first: Bluesky `package.json`, `app.config.js`, `babel.config.js`, `metro.config.ts`, `tsconfig*.json`, `pnpm-workspace.yaml`, `jest/jestSetup.js`, `prettier.config.ts`.
- Files: same set at the new repo root, plus `index.ts`, `index.web.ts`, `src/App.tsx`, `src/App.web.tsx`, `packages/fedi/package.json`.
- Steps:
  1. Same versions as Bluesky `cf16c1d`: Expo 57, RN 0.86, React 19.2, React Compiler, `react-native-web` 0.21, TanStack Query 5, React Navigation 7, Lingui 5, Reanimated 4, gesture-handler 3, MMKV 3, zod 3, expo-image.
  2. Same script names (`start`, `web`, `android`, `ios`, `test`, `lint`, `typecheck`, `typecheck:{ios,android,web}`, `build-web`, `prettier`).
  3. `#/` alias to `src/`. `@keystone/fedi` workspace alias to `packages/fedi/src`.
  4. Drop Bluesky-only parts: lexicons, Sentry, Statsig, EAS updates, share extensions, notification service extensions.
  5. App renders one "Keystone" text.
- Acceptance: `pnpm typecheck && pnpm lint && pnpm test` green. `pnpm web` shows the text. `pnpm android` runs on the Oppo. `pnpm ios` on simulator, or the Xcode blocker recorded.

**1.2 Repo rules and lint gates.**
- Files: `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`), `NOTICE.md`, `state/STATE.md`, `state/README.md`, `docs/` (carried docs from §3), `lint-rules/`.
- Steps:
  1. AGENTS.md = Bluesky's AGENTS.md sections (structure, ALF, components, i18n, state, navigation, platform files, aliases, footguns) + Keystone sections: backend contract rules (old §5), product rules (capability gating, no inert controls, no fake data), state protocol (old §4, shortened), §4 of this plan.
  2. Lint rules: copy Bluesky `use-prefixed-imports`, `avoid-unwrapped-text`, `lingui-msg-rule`. Add `no-ui-in-fedi` (no `react`, `react-native`, `expo*`, `#/` imports, no `window`/`document` in `packages/fedi`) and `no-wire-in-app` (no `@keystone/fedi/*/wire` imports from `src/`).
  3. One test per custom rule (good + bad case).
- Acceptance: lint fails on a planted violation of each rule, passes after removal.

**1.3 ALF and themes.**
- Read first: Bluesky `src/alf/*`, `src/components/Typography.tsx`.
- Files: `src/alf/{index.tsx,atoms.ts,tokens.ts,themes.ts,breakpoints.ts,fonts.ts,typography.tsx}`, `src/components/Typography.tsx`.
- Steps: depend on `@bsky.app/alf` like Bluesky. Replace the palette with Keystone's black/white/grey (values from old `styles/global.css` `:root`). Light default, dark follows system. No accent colour.
- Acceptance: a debug screen (`/sys/debug`, Bluesky's Storybook pattern) shows text sizes and both colour modes on all three targets.

**1.4 Base components.**
- Read first: Bluesky `src/components/{Button,Pressable,Link,Dialog,Menu,Prompt,Loader,Divider,Toast,forms/TextField}`.
- Files: same paths.
- Steps: copy, strip Bluesky analytics/logging, swap unpublished deps (bottom sheet) for published ones and log each swap in DECISIONS.md. All strings through Lingui.
- Acceptance: each component on the debug screen. Dialog is a bottom sheet on Android/iOS, modal on web. `control.close(cb)` footgun test copied.

**1.5 Shell and navigation.**
- Read first: Bluesky `src/Navigation.tsx`, `src/routes.ts`, `src/lib/routes/types.ts`, `src/view/shell/*`, `src/components/Layout/*`.
- Files: same names; screens are placeholders labelled "not built".
- Steps:
  1. Routes and web paths keep Keystone's URLs: `/`, `/network/:tab`, `/notifications`, `/explore/*`, `/notes/:id`, `/users/:id`, `/tags/:tag`, `/lists/:id`, `/settings/*`, `/login`, `/auth/callback`.
  2. Native: bottom tabs Home, Network, Explore, Notifications, Profile. Web desktop: LeftNav + center + empty RightNav.
- Acceptance: web deep link `/notes/abc` opens the Note placeholder; Android hardware back pops the stack; browser back works.

**Gate G1**: three targets run; lint enforces §1.2 rules; owner reviews the shell on a phone and a desktop browser.

### Phase 2: Data layer port (`packages/fedi`)

**2.1 Core.**
- Read first: old `frontend/src/core/*`, `test/{models,detect,config,http,sessions}.test.ts`.
- Files: `packages/fedi/src/core/*`, `packages/fedi/test/*`.
- Steps: copy; replace i18n calls with error codes (`{code, params}`); convert tests to Jest.
- Acceptance: per-file test counts equal the originals (table in the log). `no-ui-in-fedi` passes.

**2.2 Misskey adapter.**
- Files: `packages/fedi/src/misskey/*`, fixtures `misskey/`, `sharkey/`, tests `misskey-*.test.ts`, `adapt.test.ts`, `thread.test.ts`, `quote-re.test.ts`, `translate.test.ts`.
- Steps: copy; replace Solid signals in `customEmoji`, `translate`, `stream` with a small emitter (Bluesky uses `eventemitter3`); stream URL from session origin.
- Acceptance: test counts equal; a new test opens the stream against a mock WebSocket and receives a `note` event.

**2.3 Mastodon adapter.**
- Files: `packages/fedi/src/mastodon/*`, fixtures `mastodon/`, `akkoma/`, tests `mastodon-*.test.ts`, `client-routing.test.ts`.
- Steps: copy; `oauth.ts` takes the callback URL as a parameter; replace SSE with WebSocket streaming (`/api/v1/streaming?stream=...`), keep polling fallback.
- Acceptance: test counts equal (minus SSE-only tests, listed in the log); new WebSocket stream test.

**2.4 Content AST.**
- Goal: one inline AST for MFM and HTML.
- Files: `packages/fedi/src/core/content/{ast.ts,fromMfm.ts,fromHtml.ts}` + tests.
- Steps: node set = text, link, mention, hashtag, customEmoji, unicodeEmoji, bold, italic, strike, code, codeBlock, quote, br, plus MFM extras as `fn` nodes that degrade to children. HTML via `htmlparser2`, allow-list only. Port cases from old `sanitize.ts` and `MfmRenderer.tsx`.
- Acceptance: XSS cases (script, `javascript:` href, event attributes) produce text or are dropped; Akkoma post with MFM source uses the MFM path.

**2.5 Sessions and storage seam.**
- Files: `packages/fedi/src/core/sessions.ts` (interfaces), `src/storage/{index.ts,schema.ts}`, `src/state/session/*`.
- Steps: Bluesky `#/storage` pattern (MMKV + typed schema, device and account scopes). Tokens in `expo-secure-store` on native, storage on web (dev-grade, same as today). Session = `{id, origin, family, flavor, accountId, token, grant, hosting}`.
- Acceptance: test that a request built from session A never carries session B's token or origin (port from `sessions.test.ts`).

**2.6 Contract smoke.**
- Files: `scripts/fedi-smoke.ts`.
- Steps: read-only calls (detect, meta/instance, public timeline, one note, one user) against a server URL, printed as a table. Rig per `docs/setup.md` (Misskey :3101, Sharkey :3102, Mastodon).
- Acceptance: table pasted for every server available on the rig.

**Gate G2**: all ported tests green; smoke table green; `packages/fedi` has zero UI imports.

### Phase 3: Read path (classic layout)

**3.1 Login and accounts.**
- Steps: Misskey: Keystone-owned `signin-flow` + MiAuth token (old AGENTS §5 flow). Mastodon: OAuth PKCE with `expo-web-browser` + app scheme on native, `/auth/callback` on web. Akkoma password grant + MFA. Account switcher (Bluesky `AccountList` pattern). Sign out, sign out everywhere.
- Acceptance: sign in to one Misskey-family and one Mastodon-family server on each target; switch accounts; tokens stay per origin.

**3.2 Query layer.**
- Read first: Bluesky `src/lib/react-query.tsx`, `src/state/queries/{index,util,post-feed}.ts`.
- Steps: `createQueryKey`, `STALE`, persisted query storage, `usePostFeedQuery(sessionId, descriptor)` with `useInfiniteQuery`, `FeedDescriptor` parse/format in `packages/fedi`.
- Acceptance: unit tests for descriptor round-trip and key scoping by session.

**3.3 Post component and feed.**
- Read first: Bluesky `src/components/Post/*`, `src/view/com/posts/PostFeed*.tsx`, `src/view/com/util/List*.tsx`.
- Files: `src/components/Post/*`, `src/components/RichText.tsx`, `src/components/PostFeed/*`.
- Steps: avatar, name, handle, time, CW toggle, RichText from AST, media grid, quote embed, renote header, reply context, counts, reaction chips (read-only here). Empty/loading/error states.
- Acceptance: App-render test with fixture session shows posts (provider regression guard). Screenshots on three targets.

**3.4 Home and Network screens.** Home + `/network/:tab` (social, local, global) with old feed-visibility rules (Local hidden while Social exists, Federated never default). Pull to refresh, new-posts pill (Bluesky `NewPostsPill`).

**3.5 Thread screen.** Ancestors, focused post, replies. Misskey `notes/conversation` + `notes/children`; Mastodon `context`. Port `thread.ts` behaviour.

**3.6 Profile screen.** Header, tabs posts/replies/media/featured, follow state (read).

**3.7 Notifications.** Mastodon grouped (v2, v1 fallback), Misskey notifications, filter chips, mark all read.

**3.8 Media.** Lightbox (Bluesky `components/Lightbox`), `expo-video`, alt text.

**3.9 Emoji display.** Custom emoji from packed URLs only; Twemoji per `docs/twemoji.md`.

**3.10 Streaming.** Live updates into feed caches; pill instead of jumping scroll; reconnect with backoff.

**Gate G3**: read-only parity list (from old README "What it does", reading parts) ticked on all three targets against the rig; owner review.

### Phase 4: Write path

**4.1 Post shadow and toggle queue.**
- Read first: Bluesky `src/state/cache/post-shadow.ts`, `src/lib/hooks/useToggleMutationQueue.ts`, `src/state/queries/post.ts` (`usePostLikeMutationQueue`); old `claude/reaction-optimistic-guide.md`.
- Steps: shadow fields `myReaction: string | null`, `reactionDelta`, `renoted`, `bookmarked`, `isDeleted`. Generalise the queue from boolean to "desired value" (reaction string or null). Delete-then-create for reaction change on Misskey. Pending custom emoji renders a fixed 16x16 box, never `:code:` text.
- Acceptance: old T1-T6 rewritten as Jest tests (sync flip; rollback on reject; unlike; like-then-unlike in flight gives create, delete, no third call; no `:code:` text; heart regression).

**4.2 Post actions and menu.** Like, react (picker), repost, quote, bookmark, delete, edit, copy link, translate, mute thread. Menu per `docs/note-options.md`. Capability gated.

**4.3 Composer.** Bluesky `src/view/com/composer` as the model. Text, CW, visibility with `raw` passthrough, reply, quote, polls, media upload (`expo-image-picker`; Misskey `drive/files/create` multipart; Mastodon `v2/media`), alt text, char limit from server, mention/hashtag/emoji autocomplete, drafts (local), reaction acceptance, scheduling (capability).

**4.4 Social graph.** Follow/unfollow, requests, mute, block, soft mute, lists membership.

**4.5 Emoji picker.** Unicode + server custom emoji, recent, search.

**Gate G4**: write actions verified live on rig for both families; optimistic tests green.

### Phase 5: Deck and widgets

**5.1 Layout schema.**
- Files: `src/features/deck/schema.ts`, `src/storage/schema.ts` (add), tests.
- Steps: zod schema, versioned:
  ```ts
  DeckLayout = { version: 1, mode: 'classic' | 'deck', columns: Column[], rail: WidgetInstance[] }
  Column = { id, kind: 'feed' | 'notifications' | 'widgets', sessionId, descriptor?, width: 'narrow' | 'regular' | 'wide', options }
  WidgetInstance = { id, type, props }
  ```
  Stored per device. Migration function per version bump.
- Acceptance: parse/migrate tests; invalid stored data falls back to default classic layout.

**5.2 Deck shell.** Wide breakpoint only. Horizontal scroll of columns. Column header (title, account avatar, refresh, menu). Each column renders `PostFeed` for its descriptor with its own scroll. Add, remove, reorder (Bluesky `components/DraggableList`), width presets.

**5.3 Column picker.** Dialog listing all descriptors plus notifications, gated by capabilities (antennas and channels Misskey only, etc.). Lists/antennas/clips loaded from the server.

**5.4 Per-column account.** Column runs queries and actions as its `sessionId`. Header shows which account.

**5.5 Detail panel.** On deck, opening a post or profile opens a transient detail column on the right; back closes it. Classic layout keeps normal navigation.

**5.6 Widget framework.** `src/features/widgets/registry.ts`: `{type, propsSchema, defaultProps, capability?, Component, Settings?}`. Host renders in the right rail (classic) and in `widgets` columns (deck). Error boundary per widget.

**5.7 First widgets.** Real data only: clock, memo (local text), trending tags (Misskey `hashtags/trend`, Mastodon `trends/tags`), compact notifications, server info (meta/instance). One slice per widget if needed.

**5.8 Phone deck (optional).** Pager of columns (`react-native-pager-view`), same schema.

**5.9 Sync (optional, D6).** Misskey family: store layout in `i/registry`. Others: local only.

**Gate G5**: deck with 4+ columns from two accounts on desktop web; widgets in rail; layout survives reload; owner review.

### Phase 6: Parity long tail

One slice per row, owner orders: Explore (users, tags, posts, news), search with `#`/`@` autocomplete, hashtag screen, lists CRUD, antennas, clips, channels, drive browser, favourites/bookmarks, filters, mutes/blocks settings, profile editor, translation, import/export, scheduled posts, server drafts, settings (appearance, language, feeds, reactions), `keystone-terminal` theme as an ALF theme, user font override (web; native = bundled fonts only).

**6.x Translations import.** Script from §3 writes PO files for fr, de, zh-CN, zh-TW, yue-HK, ja, hi. Report matched/unmatched counts. Unmatched stay English.

### Phase 7: Ship

- **7.1 Web build + hosting modes.** `pnpm build-web`; carry `deploy/` nginx and Caddy configs (first-party and third-party), CSP updated for the Expo export.
- **7.2 Android release.** Signed release build (gradle or EAS local). Install on the Oppo.
- **7.3 iOS release.** Needs Xcode license (known blocker). Record if still blocked.
- **7.4 E2E.** Maestro flows (Bluesky `__e2e__` pattern): login, read feed, like, post, deck add column. Run against the rig.
- **7.5 Perf.** Feed scroll on the Oppo (Bluesky uses flashlight); web bundle size table.
- **7.6 Retire.** Point old repo README at the new app.

---

## 6. Verification matrix

Rows: Misskey, Sharkey, Pinetree, Mastodon, Akkoma, Pleroma. Columns: web desktop, web phone, Android, iOS. Each gate names the cells it must turn green. A cell is green only with pasted evidence.

---

## 7. Open decisions (owner)

- **D1** React reversal: replace "SolidJS only" with "React Native + Expo, Bluesky conventions". Recommend yes.
- **D2** New repo or same repo with a new root. Recommend new repo; old one frozen at `solid-final`.
- **D3** App name, bundle IDs, URL scheme (needed for OAuth redirect in 3.1).
- **D4** License for the new repo (old one has none). Bluesky code reuse needs MIT notice either way.
- **D5** Desktop: web only for now, or RN-web inside Tauri later.
- **D6** Deck layout storage: local only, or Misskey `i/registry` sync.
- **D7** Deck on phones: pager of columns, or classic only.
- **D8** Multi-account columns in v1 deck, or single account first. Schema supports both.
- Carried from the reaction guide: RC6 (unliked icon when the like emoji is custom), URL source for remote custom emoji.
