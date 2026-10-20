# 2026-10-20 — W1 Foundations (gap closure) — agent

Branch: `main` (owner direction: main only; `p6.0-w1-foundations` untouched at the consolidation point)
Goal: close the W1 rows in `docs/parity-gaps.md` (S1, S3, N1, N2, MD15, MK15 + MK2 flag half).

## Did

- **S1 capability truth.** `ServerDetection` now keeps its `evidence`
  (`core/detect.ts`); `Session` persists `evidence?: DetectionEvidence | null`
  (`core/sessions.ts`, validated passthrough in `normalizeSession`);
  `backendForSession` + `activeBackend` forward it into both
  `createMisskeyBackend` (new `MisskeyBackendOptions.evidence`) and
  `createMastodonBackend` (existing `evidence` plumbed for the first time).
  Login (external detect + all three internal kinds via
  `firstParty.detection.evidence`), AuthCallback (both flows), and
  `SessionStore.add` (`NewSessionInput.evidence`) capture it. `translatorAvailable`
  promoted from cast-hack to a real `DetectionEvidence` field.
  All capability consumers (`PostHandlers`, `usePostFeedQuery`, `graph`,
  `PostCard`, `postActions`, `HomeFeed`, `menuModel`, `composeGates`) read
  `backend.capabilities`, so they inherit the evidence with no call-site changes.
- **S3 one route table.** `src/routes.ts` exports `linkingScreens()` (derived
  from `paths`) and `Navigation.tsx` consumes it; `nav.test.tsx` asserts every
  leaf equals the `paths` entry (fails on drift). `federated` vs `global`
  fixed the v1 way: `NetworkTab` is `social|local|federated`, the descriptor
  stays `timeline|global` (internal endpoint names unchanged), `/network/global`
  aliases to federated (`NETWORK_TAB_ALIASES` + `networkTabFromParam`).
- **N1 redirects.** `rewriteLegacyPath` (`/local`→`/network/local`,
  `/social`→`/network/social`, `/global`→`/network/federated`,
  `/search`→`/explore` preserving `?tag=`) wired via custom `getStateFromPath`.
- **N2 URL-backed tabs.** `NetworkScreen` reads `:tab` (alias-aware) and tab
  presses `setParams({tab})`, so reload/back restore the tab. Canonical URL
  is `/network/federated`.
- **MD15 Backend additions** (all optional, zero call-site changes):
  `DriveFoldersApi` + `DriveApi.folders?`, `ChannelsApi` + `Backend.channels?`,
  `AnnouncementsApi` + `Backend.announcements?`, `ListsApi.create?/update?/delete?`,
  `Backend.renoteMutes?`.
- **MK15/MK2 table corrections.**
  - Live probes: `:3101`/`:3102` down (connection refused); `:3000` (Pinetree)
    `POST /api/meta` → `MaxNoteTextLength 3000`, `translatorAvailable: false`,
    version `2026.10.1-alpha.0`; `:4000` (Akkoma) v1/instance features include
    `quote_posting`, `editing`, `pleroma_emoji_reactions`, `exposable_reactions`
    (no `akkoma:machine_translation` flag on this instance).
  - Applied: pinetree `translation: unsupported` (live); misskey/sharkey
    `polls_multi: supported` (v1 `docs/api-surface.md:67` documents `multiple`);
    misskey/sharkey `bookmarks: supported` (v1 shipped `i/favorites` +
    `notes/favorites/create|delete` — fixes MK2's gate half);
    misskey/sharkey `status_editing: supported` (v1 shipped `noteEdit.ts` —
    menu degrades honestly to "No editor is connected" until W3);
    misskey/sharkey `scheduled_posts` + `server_drafts: supported` (v1 shipped
    both; v2 backends implement both; date-picker/list UI stays W3).
  - Left honestly unknown: catodon edit/bookmarks/schedule, pinetree
    bookmarks/edit/schedule, live Sharkey/Misskey probes (rig down).
- Tests: new `packages/fedi/test/session-evidence.test.ts` (detect keeps
  evidence; session round-trip incl. corrupt-evidence drop; both backends
  raise caps from session evidence; `activeBackend` path); `composer.test.ts`
  Misskey-poll expectation corrected to pass `multiple` through;
  `feeds.test.ts` federated rename + alias test; `nav.test.tsx` redirect +
  federated/alias + drift tests; `store.test.ts` evidence-persistence test.

## Decided (→ DECISIONS entries, no ADR — W1-scoped)

- Evidence-on-session + table-as-floor (stored evidence raises, never lowers).
- Single route source + federated canonical + global alias.
- Flavor corrections listed above with sources; schedule/edit UI halves stay W3,
  saved-posts screen stays W4.
- Backend additions interface-only.
- Duplicate classifiers documented, unification deferred to W8 (MD13).

## Tests / verification (commands + results)

- `node_modules/.bin/tsc -p tsconfig.check.ios.json && -android && -web` → clean ×3.
- `node_modules/.bin/oxlint --quiet src && node_modules/.bin/eslint .` → clean.
- `NODE_ENV=test npx jest --forceExit --testTimeout=20000` → **77 suites / 961 tests passed**
  (was 76/950: +session-evidence suite, +nav/feeds/store/composer cases; same
  pre-existing force-exit worker warning).
- Rig probes (curl, 5–8s timeouts): `:3101`/`:3102` refused; `:3000/meta` 200
  (`translatorAvailable:false`); `:4000` v1/instance listed above.
- Device/web runs: **not verified** (no device/web pass this session; URL
  behavior is jest-covered only).

## Deviations (files touched outside the slice + why)

- `packages/fedi/test/composer.test.ts` (Misskey poll expectation): forced by
  the MK15 `polls_multi` correction — the test pinned the old wrong behavior.
- `src/components/Post/menuModel.ts`: NOT touched — translate/edit/ bookmark
  rows already gate correctly on the corrected flags (verified by read).
- `src/state/session/store.ts` + `Login.tsx` + `AuthCallback.tsx`: in-scope
  (S1 capture points), listed in W1 via "persist on Session".

## v1 / reference paths consulted

- `frontend/src/routes.ts`, `App.tsx` (route table + legacy redirects)
- `frontend/src/routes/MyNetwork.tsx` (`LEGACY_NETWORK_REDIRECTS`, `NetworkTab`,
  federated relabel note, Bubble-absence rationale)
- `frontend/src/misskey/favorites.ts`, `components/NoteMenu.tsx:306-327,393,490-495`
  (bookmarks endpoints; Pinetree explicitly unverified in v1)
- `frontend/src/misskey/schedule.ts`, `serverDrafts.ts`, `noteEdit.ts` (v1-shipped
  scheduling/drafts/edit — evidence for table corrections)
- `docs/api-surface.md:67` (poll `multiple` documented)

## Next

1. W2 Content & media (`docs/tasks/gap-closure.md`): mount Lightbox, media
   branches, Misskey quote mapping (F5 pairs with the now-truthful
   capabilities), mentions, polls UI, sanitizer `span.invisible`.
2. Then W3 Composer & post actions (edit UI, schedule picker + list,
   drafts UI) — do NOT run W2+W3 in parallel (shared `PostCard`/`RichText`/
   `Navigation` touch points).
3. Still blocked: live Sharkey/Misskey probes (`:3101`/`:3102` down), device
   back-button/URL round-trip on the Oppo, iOS anything (owner rig items).
