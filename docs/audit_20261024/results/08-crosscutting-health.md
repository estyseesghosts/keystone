# Cross-Cutting Health Audit

Scope: whole repo — `packages/fedi/src` + `src` + `lint-rules` + `scripts` (453 TS/TSX files, 97,333 LOC).
Method: `wc -l`, `grep`, one Python paren-balance scan for multi-line defs, `jest --listTests`, adjacent-test glob compare.
Date: 2026-10-24.

## All files >650 LOC (full table with counts)

Command:

```
find packages/fedi/src src lint-rules scripts -type f \( -name "*.ts" -o -name "*.tsx" \) -exec wc -l {} + | sort -rn | awk '$1 > 650'
```

Output:

```
   97333 total
    1861 packages/fedi/src/core/backend.ts
    1687 packages/fedi/src/mastodon/backend.ts
    1570 packages/fedi/src/misskey/backend.ts
    1413 src/Navigation.tsx
    1329 packages/fedi/src/mastodon/endpoints.ts
    1215 src/components/Post/PostCard.tsx
    1062 src/components/RichText.tsx
    1000 src/screens/Drive.tsx
     983 packages/fedi/src/core/models.ts
     884 packages/fedi/src/core/detect.ts
     829 packages/fedi/src/mastodon/oauth.ts
     825 packages/fedi/src/core/content/ast.ts
     812 packages/fedi/src/mastodon/adapt.ts
     802 src/screens/Explore.tsx
     787 packages/fedi/src/misskey/stream.ts
     771 src/state/session/store.test.ts
     758 src/components/Composer/Composer.tsx
     730 src/screens/AdminReports.tsx
     725 src/screens/Login.tsx
     718 src/components/Settings/MutesSection.tsx
     698 packages/fedi/src/mastodon/stream.ts
     689 src/components/Composer/ComposerSections.tsx
     678 src/components/__tests__/post.test.tsx
     672 packages/fedi/src/mastodon/wire.ts
     668 src/components/__tests__/postactions.test.tsx
```

453 files / 97,333 LOC total (`find … | wc -l` → 453). 25 files exceed 650 (3 are tests:
`store.test.ts` 771, `post.test.tsx` 678, `postactions.test.tsx` 668 — test size is not a smell).
Just under the line and worth watching: `HoverPreview.tsx` 641, `misskey/wire.ts` 631,
`streaming.ts` 624, `Note.tsx` 613, `core/sessions.ts` 613, `session/store.ts` 588.

Distribution: the three `backend.ts` files alone are 5,118 LOC (5.3% of the audited corpus);
top 10 non-test files hold ~12,500 LOC (~13%).

## Worst long-parameter functions (top 20 with signatures+file:line)

The naive grep from the task brief is unusable verbatim — it matches the Lingui catalog
blobs (`src/locale/locales/*.ts`, single lines with 100+ commas). Excluding locale and
restricting to definitions with a `:` type annotation, plus a Python balanced-paren scan
for multi-line defs, yields 42 candidate defs with 5+ params. Hand-correction: the scan
overcounts commas inside `<…>` generics (`Map<string, Record<string, unknown>>`,
`Exclude<…>`, `Set<…>`), so the two `adaptV2*` hits (true arity 3), `streamUrl` (true 4),
`subscribeChannel` (true 4), and `settleText` (true 4) are demoted out of the ranking.
True counts below are hand-verified against the source.

| # | True arity | Location | Signature |
|---|---|---|---|
| 1 | 8 | `src/state/cache/postActions.ts:287` | `boolToggle(kind, sessionId, backend, post, next, baseValue, field, call)` |
| 2 | 8 | `src/state/queries/usePostThread.ts:146` | `infinitePages(sessionId, id, backend, queryKey, fetch, stale, gc, retry?)` |
| 3 | 8 | `src/state/queries/graph.ts:115` | `toggle(kind, sessionId, accountId, initial, backend, apply, run, next)` |
| 4 | 8 | `src/state/cache/postActions.ts:77` | `queueFor(kind, sessionId, post, confirmedNow, ctx, run, optimistic, settle)` |
| 5 | 6 | `packages/fedi/src/mastodon/auth.ts:78` | `firstPartyPasswordSignin(store, origin, redirectUri, username, password, flavor?)` |
| 6 | 6 | `src/state/cache/postActions.ts:51` (interface) | `setReaction(sessionId, backend, post, next, opts?)` |
| 7 | 5 | `src/state/queries/usePostFeedQuery.ts:61` | `fetchFeedPage(backend, parsed, cursor, limit = 20, rec?)` |
| 8 | 5 | `packages/fedi/src/misskey/external.ts:244` | `externalApiCall(scheme, host, token, endpoint, params = {})` |
| 9 | 5 | `packages/fedi/src/misskey/external.ts:259` | `externalUploadFile(scheme, host, token, file, opts = {})` |
| 10 | 5 | `packages/fedi/src/core/errors.ts:41` (ctor) | `ApiError(message, status, code?, kind?, params?)` |
| 11 | 5 | `packages/fedi/src/mastodon/auth.ts:102` | `firstPartyMfa(store, origin, redirectUri, opts, flavor?)` |
| 12 | 5 | `src/state/queries/graph.ts:97` (interface) | `setListMember(sessionId, backend, listId, accountId, next)` |
| 13 | 5 | `src/state/queries/graph.ts:98` (interface) | `resolveFollowRequest(sessionId, backend, accountId, accept)` — 4, listed for adjacency |
| 14 | 5 | `src/state/queries/composer.ts:227` | `uploadAll(backend, items, files, onUpdate, target = {})` |
| 15 | 5 | `src/components/Post/menuModel.ts:214` | `rel(key, label, activeLabel, active, fn?)` |
| 16–20 | props objects, not positional params (all correctly use a single destructured props object — no action, but they are the widest component APIs and the natural split points if the components grow): `PostFeedProps` 16 fields (`src/components/PostFeed/PostFeed.tsx:29`), `RichTextProps` 16 fields (`src/components/RichText.tsx:54`), `PostCardProps` 15 fields (`src/components/Post/PostCard.tsx:235`), `ThreadRowProps` 9 fields (`src/components/PostFeed/ThreadRow.tsx:29`), `TextFieldProps` 8 fields (`src/components/forms/TextField.tsx:8`) | | |

Exact source for the top 4 (pasted, not reconstructed):

```ts
// src/state/cache/postActions.ts:287
function boolToggle(
  kind: Exclude<PostActionKind, 'reaction' | 'delete'>,
  sessionId: string,
  backend: Backend | null,
  post: Post,
  next: boolean,
  baseValue: boolean,
  field: 'favourited' | 'renoted' | 'bookmarked',
  call: (b: Backend, to: boolean) => Promise<unknown>,
): Promise<void> {
// src/state/queries/usePostThread.ts:146
function infinitePages<PageT>(
  sessionId: string | null,
  id: string,
  backend: Backend | null,
  queryKey: AppQueryKey,
  fetch: (backend: Backend, cursor: Cursor | null) => Promise<{end: boolean; cursor: Cursor | null} & PageT>,
  stale: number,
  gc: number,
  retry?: number | false,
// src/state/queries/graph.ts:115
  function toggle<T>(
    kind: string,
    sessionId: string,
    accountId: string,
    initial: T,
    backend: Backend,
    apply: (rel: Relationship, v: T) => Relationship,
    run: (b: Backend, from: T, to: T) => Promise<void>,
    next: T,
// src/state/cache/postActions.ts:77
  function queueFor<T>(
    kind: PostActionKind,
    sessionId: string,
    post: Post,
    confirmedNow: T,
    ctx: QueueCtx,
    run: (backend: Backend, from: T, to: T) => Promise<void>,
    optimistic: (v: T) => void,
    settle: (v: T) => void,
```

Assessment: ranks 1–4 are all internal (non-exported) generic queue/toggle helpers in
`state/` — 8 positional params each, mostly `(sessionId, backend, …)` threading plus two
or three callbacks. They are the single best refactoring target for an options-bag
(e.g. `queueFor({kind, sessionId, post, …})`); all call sites are in the same two files.
Ranks 5–15 all end in an options bag or optional and are acceptable as-is; no function
takes more than 4 *required* positional params outside the four helpers. Misskey-family
modules specifically are clean (max true arity 5, always trailing `= {}`).

## Banned-pattern scan results (with counts)

All greps run against `packages/fedi/src src lint-rules scripts`, `--include=*.ts,*.tsx`.

### `any` — 249 total occurrences; top files by occurrence count

```
  19 src/screens/Drive.test.tsx
  13 src/screens/AdminReports.test.tsx
   9 src/screens/AdminInsight.test.tsx
   6 src/state/queries/notifications.ts
   5 src/screens/ProfileEditor.test.tsx
   5 src/screens/Following.test.tsx
   5 src/screens/Followers.test.tsx
   5 src/screens/ChatUser.test.tsx
   5 src/Navigation.tsx
   5 packages/fedi/src/mastodon/adapt.ts
   5 packages/fedi/src/core/backend.ts
   4 src/state/session/store.ts
   4 src/screens/FollowRequests.test.tsx
   4 src/screens/Conversation.test.tsx
   4 src/screens/ChatRooms.test.tsx
   4 src/screens/Channels.test.tsx
   4 src/components/Settings/TransferSections.test.tsx
   4 src/components/Settings/FiltersSection.test.tsx
   4 src/components/Profile/__tests__/profileFields.test.tsx
   4 src/components/__tests__/post-translation.test.tsx
   4 packages/fedi/src/misskey/client.ts
```

(Command: `grep -rn -o "\bany\b" … | cut -d: -f1 | sort | uniq -c | sort -rn`.)
Non-test prod-code files with `any`: `notifications.ts` (6), `Navigation.tsx` (5),
`mastodon/adapt.ts` (5), `core/backend.ts` (5), `session/store.ts` (4),
`misskey/client.ts` (4), `streaming.ts` (3). The long tail is tests. No file is
saturated; no cleanup mandate, but `notifications.ts` leads prod code.

### `as any` / `@ts-ignore` / `@ts-expect-error`

18 true hits (locale blobs excluded; 1 false positive: `ReportChooser.tsx:26` prose
"when it has any, forwarding" — the substring "as any" inside "has any,"):

```
packages/fedi/src/mastodon/adapt.ts:664:  adaptAccount(rawAccount as any)   (v2-group path)
packages/fedi/src/mastodon/adapt.ts:670:  adaptStatus(item.status as any)    (v2-group path)
packages/fedi/src/mastodon/adapt.ts:716:  adaptAccount(rawAccount as any)    (grouped path)
packages/fedi/src/mastodon/adapt.ts:721:  adaptStatus(rawStatus as any)      (grouped path)
packages/fedi/src/mastodon/backend.ts:1447: adaptStatus(raw as any)          (search-page map)
packages/fedi/src/mastodon/backend.ts:1500: adaptStatus(raw as any)          (search-page map)
src/state/queries/graph.test.tsx:110, src/screens/Settings.test.tsx:49,
src/screens/ProfileEditor.test.tsx:89,140, src/screens/FollowRequests.test.tsx:47,54,
src/components/Settings/AccountSection.test.tsx:46, src/components/Settings/MutesSection.test.tsx:50,
src/components/Profile/__tests__/profileFields.test.tsx:325,337,350,360   (all test fakes)
```

`@ts-ignore`: 0. `@ts-expect-error`: 1 (`src/locale/locale.test.ts:53`, intentional
invalid-code probe). The 6 prod `as any` are all at the same boundary — untyped
`Record<string, unknown>` → typed adapter input in `mastodon/adapt.ts` + `mastodon/backend.ts`.
A `WireRecord` branded type or unknown-narrowing adapter overload would delete all six.

### `console.*`

No bare `console.log` in app or fedi code. Remaining hits:

```
packages/fedi/src/mastodon/client.ts:42,46:  if (DEV_API_LOG) console.debug(...)   (dev-gated wire log)
packages/fedi/src/misskey/client.ts:211:     if (DEV_MISSKEY_API_LOG) console.debug(...) (dev-gated wire log)
scripts/fedi-smoke.ts:413,418,419,469 + fedi-w{4,5,8,sc}-probe.ts                  (CLI probe output — legitimate)
```

Verdict: clean. The two `console.debug` calls are flag-gated; scripts are CLIs.

### `innerHTML` / `dangerouslySetInnerHTML` / `WebView` — 0 code uses

Only three comment hits, all asserting the *absence* of the pattern (architecture rule intact):

```
packages/fedi/src/core/content/ast.ts:6:      // no `innerHTML`, no WebView, never the raw server string.
src/components/Post/body.ts:76:               * reaches `innerHTML`. Tag blocks are pruned ...
src/components/RichText.tsx:6-7:              // `contentFromHtml`) — never a raw server string. No `innerHTML`, no WebView.
```

### `window` / `document` inside `packages/fedi` — 0 code uses (forbidden rule holds)

Every grep hit is a comment or an unrelated identifier (`rate window`, `document order`,
`` `window.location` `` in a comment, `poll builder`, `discovery document`). No
`window.…` / `document.…` runtime access. `#/` imports in fedi: 0. `react` /
`react-native` / `expo*` imports in fedi: 0. All three lint-enforced boundaries
(`no-ui-in-fedi`, `no-wire-in-app`, `no-hardcoded-color` in `eslint.config.mjs` +
`lint-rules/`) verify clean by inspection of the grep output.

### `eslint-disable` — 4, all justified

All in `src/components/__tests__/richtext-wsb.test.tsx:67,71,74,80`
(`keystone/no-hardcoded-color` next-line suppressions for MFM color args under test).

## TODO/debt inventory

Zero. The case-sensitive grep for real debt markers returns nothing:

```
grep -rn -E "(TODO|FIXME|HACK|XXX)[^A-Z]" packages/fedi/src src lint-rules scripts | grep -vi mastodon
→ (no output)
```

(The unfiltered grep only matches `MASTODON_*` / `SCOPES_MASTODON` identifiers and the
prose word "Mastodon" inside HACK/XXX-tolerant patterns — no debt markers. There are no
`Not wired yet` code comments outside user-facing honest-disabled strings, no commented-out
blocks found in the large files, and no `not verified` shortcuts in shipped code.)

## Duplication map

9 shared basenames across the two families (identical module split — deliberate seam):

```
adapt.ts  admin.ts  auth.ts  backend.ts  client.ts  listMembership.ts  stream.ts  thread.ts  wire.ts
```

LOC pairs (deliberate vs suspicious):

```
1570 misskey/backend.ts  vs  1687 mastodon/backend.ts   (parallel impls of the Backend interface — by design)
 580 misskey/adapt.ts    vs   812 mastodon/adapt.ts     (mastodon heavier: v1+v2 notification shapes)
 631 misskey/wire.ts     vs   672 mastodon/wire.ts      (wire types — size-appropriate, no split needed)
 787 misskey/stream.ts   vs   698 mastodon/stream.ts    (channel vs SSE/WebSocket transports — by design)
 138 misskey/thread.ts   vs   137 mastodon/thread.ts    (near-identical size — check for mergeable logic)
 273 misskey/admin.ts    vs   473 mastodon/admin.ts     (mastodon heavier: admin reads/writes)
 156 misskey/auth.ts     vs   131 mastodon/auth.ts (+829 mastodon/oauth.ts — oauth is mastodon-only by protocol)
 384 misskey/client.ts   vs   469 mastodon/client.ts
  22 misskey/listMembership.ts vs 18 mastodon/listMembership.ts (trivial re-export shims — fine)
 229 misskey/recommendations.ts vs 237 core/recommendations.ts (family impl vs shared opts/types — check overlap)
 217 mastodon/tags.ts    vs   159 api/tags.ts           (family tags vs shared fold helper — check overlap)
```

Identical exported function names in both families (copy-paste probe):

```
2  export function toApiError
2  export function pageOf
2  export function isUnsupportedError
2  export function createStreamHandle
2  export function adaptPoll
2  export function adaptNotification
2  export function adaptAnnouncement
2  export function adaptAccount
2  export async function removeFromList / addToList / listsContaining / listRenoteMutes
```

These are same-name/different-wire parallel implementations (each adapts its own wire
types), not verbatim pastes — the correct shape for the adapter seam. No identical-block
pastes were found by name; the three pairs worth a human diff are `thread.ts` (138/137),
`listMembership.ts` (22/18), and `recommendations.ts` vs `core/recommendations.ts`
(229/237). If the thread/listMembership pairs turn out structurally identical, they are
candidates for hoisting into `core/`; the backends, streams, wires, and adapts are
irreducibly family-specific and should stay split.

## Test coverage gaps

Suites: `npx jest --listTests | wc -l` → **205** (59 `packages/fedi/test/*`, 143 `src/*`,
3 `lint-rules/__tests__/*`). `state/STATE.md` claims 199 suites / ~2582 tests — the +6
delta is the 3 lint-rule suites plus recent unpushed slices; suite count is healthy and
growing, not shrinking. (Note: `npx` warns about the pnpm devEngines field; harmless.)

Name-matched adjacent-test comparison (test basename contains source stem):
448 source files vs 202 test files → **129 sources with no name-matched test**, of which
**39 exceed 150 LOC** and **19 exceed 300 LOC**:

```
1413  src/Navigation.tsx
1329  packages/fedi/src/mastodon/endpoints.ts
1215  src/components/Post/PostCard.tsx
1062  src/components/RichText.tsx
 672  packages/fedi/src/mastodon/wire.ts
 631  packages/fedi/src/misskey/wire.ts
 522  packages/fedi/src/misskey/external.ts
 483  src/components/Recommendations/RecommendationsSettingsOverlay.tsx
 468  packages/fedi/src/core/content/fromHtml.ts
 439  src/routes.ts
 435  src/components/Popup.tsx
 425  packages/fedi/src/mastodon/presentation.ts
 424  src/components/Profile/ProfileHeader.tsx
 396  src/state/cache/postActions.ts          (hosts the four 8-param helpers — coverage would pin refactor)
 366  src/state/queries/adminReports.ts
 350  src/components/Post/PostQuote.tsx
 335  src/components/Post/ActionBar.tsx
 312  packages/fedi/src/mastodon/quoteMarker.ts
 306  src/state/queries/adminInsight.ts
 272  packages/fedi/src/misskey/customEmoji.ts
 ...plus DisplaySection (263), importExport (253), ReactionsSection (249), ReportChooser (244),
   fromMfm (218), ChatThread (212), hosting (208), PostMenu (203), softMute (192), pagination (191) …
```

Qualifications: (a) the three `backend.ts` files *are* covered via `mastodon-backend.test.ts`
/ `misskey-backend.test.ts` / `composer.test.ts` etc. (name contains the stem); (b) `PostCard`
is exercised indirectly by `post.test.tsx` / `postactions.test.tsx` / `quotes.test.tsx`;
(c) `wire.ts` files are types + pure helpers, low-risk untested. Genuine high-value gaps:
`mastodon/endpoints.ts` (1329, every paged GET untested by name), `RichText.tsx` (1062, the
universal renderer — only WSB/emoji-remote slices tested), `Navigation.tsx` (1413, deep-link
helpers are pure and trivially testable), `external.ts` (522, MiAuth/external-origin auth —
security-adjacent), `fromHtml.ts` (468, the entire Mastodon content path), `postActions.ts`
(396, optimistic-queue core), `quoteMarker.ts` (312), `presentation.ts` (425).

## Top 5 god-file priorities

Ranked by lines × distinct concerns (section headers + export/branch counts):

1. **`packages/fedi/src/core/backend.ts` (1861 LOC, 112 exports)** — the `Backend` interface
   plus every shared type: pagination, feeds, compose/upload/media-edit, profile patch,
   search, trending users/tags/links, recommendations, custom emoji, translation,
   notifications (flat + grouped). It is the contract the two family backends implement,
   so width is partly inherent — but at 112 exports it is also where every new capability
   lands by default. Priority: split off `notifications.ts` and `trending.ts` option/row
   types first; keep the `Backend` interface itself here.
2. **`packages/fedi/src/mastodon/backend.ts` (1687 LOC)** — whole-family implementation:
   error adaptation boundary, v1/v2 filter mapping, lists, search pages, grouped
   notifications, admin, quotes. Concerns are mostly "one family backend," so the risk is
   merge-conflict density across slices (per STATE.md, the Backend interface already rules
   out parallel work) rather than incoherence. Priority: extract the v2-filter-mapping and
   list-CRUD sections into modules; do not split by feature (that fights the interface).
3. **`packages/fedi/src/misskey/backend.ts` (1570 LOC)** — mirror of #2 (transport,
   compose-body mirror, backend, wire-shaped helpers). Same prescription; the two
   backends should be split symmetrically so porting diffs stay readable.
4. **`src/Navigation.tsx` (1413 LOC, ~37 defs)** — base-path hosting (N13), scroll memory
   (N14), tab bar, sidebar (rail + full), account menu (N16), unread badge (N18), mobile
   strip, collections, deep-link rewriting. At least 7 labeled concerns plus styling.
   Priority: extract `AccountMenu`, `Sidebar`, `ShellTabBar` into `src/components/shell/`;
   the pure helpers (`normalizeShellBase`, `stripShellBase`, `linkingPrefixesForBase`,
   `leafOf`) are already testable — add `nav-helpers` unit tests when moving them.
5. **`src/components/RichText.tsx` (1062 LOC, 29 defs, 105 branches — the most branch-dense
   file in the repo)** — universal renderer: node dispatch, mention/tag/link taps, MFM
   color/font allow-lists, heading scale, custom-emoji resolution + WS-C remote seam,
   mention-chip account resolution, link-title chips, lone-link rule. Priority: split the
   allow-listed style helpers (color/font/size) and the tap-navigation resolvers into
   modules; add renderer tests beyond the WSB/emoji-remote slices (see coverage gaps).

Runners-up (split only when touched): `Drive.tsx` (1000, file manager screen + detail
panel + uploads), `models.ts` (983, content/visibility/account/media/poll/reaction/post —
appropriately central, do not split), `detect.ts` (884, probing + flavor matrix + caps —
cohesive), `endpoints.ts` (1329, one function per endpoint — cohesive, needs tests not
splitting), `PostCard.tsx` (1215, card + translate seam + quote fallback + menus).
