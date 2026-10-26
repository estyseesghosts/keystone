# Settings / Nav / Session Audit

Scope: `src/Navigation.tsx`, `App.tsx`, `App.web.tsx`, `Root.tsx`, `routes.ts`,
`navigationRef.ts`, `src/screens/Settings.tsx`, `settings/*`, `Login.tsx`,
`LoginFlows.ts`, `AuthCallback.tsx`, `SysDebug.tsx`, `AdminInsight.tsx`,
`AdminReports.tsx`, `ProfileEditor.tsx`, `Compose.tsx`,
`src/components/Settings/*`, `src/state/session/store.ts`,
`SessionProvider.tsx`, `queries/me.ts`, `queries/moderation.ts`,
`queries/reports.ts`, `queries/adminInsight.ts`, `queries/adminReports.ts`,
`queries/composer.ts`, `src/state/appearance.ts`, `sideNav.ts`, `systemUI.ts`,
`hosting.tsx`, `customEmojiStores.ts`, `emojiPrefs.ts`, `reportPrefs.ts`
(note: `src/state/quotePolicy.ts` does not exist — quote policy lives in
`appearance.ts` as `onlyAuthorizedQuotes`), `src/storage/*`,
`src/platform/*`, `src/sys/*`, `src/lib/*` (skim), `src/locale/*` (skim),
`src/alf/*` (skim), `lint-rules/*`.

Method: full read of every in-scope file; `grep` for
`AsyncStorage|SecureStore|token`, `sessionId`, `any`, `TODO|FIXME|stub`;
`wc -l` for sizes; catalog comparison across all 8 locales via script;
`packages/fedi` consulted only to verify backend seams
(`uploadProfileImage`, `reportsQueue`, `adminInsight`).

## File sizes

Exact `wc -l` (repo root `/Users/terezi/keystone2`):

| File | LOC | >650? |
|---|---|---|
| `src/Navigation.tsx` | 1413 | YES — largest app file |
| `src/screens/AdminReports.tsx` | 730 | YES |
| `src/screens/Login.tsx` | 725 | YES |
| `src/components/Settings/MutesSection.tsx` | 718 | YES |
| `src/state/session/store.ts` | 588 | no (under threshold, but densest logic) |
| `src/screens/AdminInsight.tsx` | 586 | no |
| `src/screens/ProfileEditor.tsx` | 516 | no |
| `src/screens/LoginFlows.ts` | 417 | no |
| `src/components/Settings/TransferSections.tsx` | 440 | no |
| `src/routes.ts` | 439 | no |
| `src/state/queries/composer.ts` | 452 | no (out of scope-adjacent, measured for composer plumbing) |
| `src/state/queries/adminReports.ts` | 366 | no |
| `src/state/queries/adminInsight.ts` | 306 | no |
| `src/components/Settings/AccountSection.tsx` | 276 | no |
| `src/components/Settings/DisplaySection.tsx` | 263 | no |
| `src/components/Settings/ReactionsSection.tsx` | 249 | no |
| `src/state/emojiPrefs.ts` | 238 | no |
| `src/screens/Compose.tsx` | 257 | no |
| `src/components/Settings/FiltersSection.tsx` | 223 | no |
| `src/screens/AuthCallback.tsx` | 209 | no |
| `src/state/appearance.ts` | 188 | no |
| `src/Root.tsx` | 131 | no |
| `src/storage/schema.ts` | 147 | no |
| `src/components/Settings/rows.tsx` | 86 | no |
| `src/screens/Settings.tsx` | 82 | no (thin dispatcher — good) |
| `src/state/queries/reports.ts` | 71 | no |
| `src/state/hosting.tsx` | 68 | no |
| `src/components/Settings/FeedsSection.tsx` | 67 | no |
| `src/state/sideNav.ts` | 63 | no |
| `src/state/customEmojiStores.ts` | 96 | no |
| `src/state/reportPrefs.ts` | 75 | no |
| `src/storage/index.ts` / `tokens.ts` / `tokens.web.ts` / `mmkv.ts` | 81/52/44/64 | no |
| `src/App.tsx` / `App.web.tsx` / `navigationRef.ts` | 7/7/12 | no |
| `lint-rules/no-wire-in-app.js` / `no-ui-in-fedi.js` / `index.js` | 63/80/8 | no |

Just under the bar but notable: `AdminInsight.tsx` (586) and `store.ts`
(588) will cross 650 with the next feature each touches.

## Long-parameter functions

Ranked by prop/param count (destructured-props interfaces counted):

1. `InternalForm` — **12 props** (`src/screens/Login.tsx:656`:
   `kind, serverName, username, password, busy, mfa, mfaCode, error,
   onUsername, onPassword, onMfaCode, onPasswordSubmit, onMfaSubmit,
   onMfaCancel, onOAuth` — actually 15 fields). The worst offender; it
   duplicates the external-form field set inline in `LoginScreen` instead
   of sharing a model.
2. `ConfirmShell` — 8 props + `children` (`src/screens/AdminReports.tsx:266`:
   `title, action, busy, confirmDisabled, error, onConfirm, onCancel,
   children`). Acceptable for a confirm dialog, but 7 near-identical call
   sites (`assign/unassign/resolve/reopen/recategorize/note/forward`)
   differ only in strings + mutation — a table-driven map would halve
   `AdminReportScreen`.
3. `AccountList` — 7 props (`src/components/Settings/MutesSection.tsx:357`:
   `title, hint, testID, load, action, run, refreshKey`). Fine as a generic,
   but `load`/`run` closures re-created per render; works only because the
   effect deps are `[backend, refreshKey]`.
4. `WordField` — 7 props (`MutesSection.tsx:52`:
   `backend, me, onSaved, field, title, hint, placeholder`). Overlaps
   `FiltersSection` edit rows and `LikeEmojiRow`/`DomainBlockList` (see
   duplicated-patterns below).
5. `SectionState` — 7 props (`src/screens/AdminInsight.tsx:131`:
   `status, error, retry, testID, deniedReason, absentReason`). Rendered 9
   times with per-section reason strings; a `{deniedReason, absentReason}`
   lookup table keyed by section would remove ~60 lines.
6. `ExportRow` — 5 props + 7 `useState`s (`TransferSections.tsx:219`);
   `ImportRow` — 4 props + 3 states (`:106`). Both fine in isolation.
7. `AccountSection` — 4 navigation callbacks (`AccountSection.tsx:182`:
   `onAddAccount, onOpenFollowRequests, onOpenAdminInsight,
   onOpenAdminReports`); thin pass-through from
   `AccountSettingsScreen.tsx`, fine.
8. Navigation helpers are all small (`Sidebar({layout, leaf})`,
   `AccountMenu({onClose, testPrefix, overflowActions})`,
   `NotificationsUnreadBadge({sessionId, compact, testID})`,
   `stripShellBase(path, base)`, `handleLine(session)`). No long-parameter
   problem in `Navigation.tsx` — its size is breadth (many small
   components), not deep signatures.

No function takes >4 positional args; the pattern is uniformly
single-destructured-props, so the issue is prop-count on reused row
components, not call-site readability.

## Condensed responsibility

- **`src/Navigation.tsx` (1413 LOC) — YES, condensed.** One file owns:
  routing table wiring, base-path hosting strip/rewrite/prefix helpers,
  feed-scroll memory re-export, shell back policy (`goBackOrFeed`),
  deepest-leaf tracking, tab bar (mobile), sidebar (rail + full) with
  capability-gated collection rows, account menu with sign-out, unread
  badge, mobile strip, widgets stub, and the full stack/tab navigator
  assembly. Each piece is individually small and well-commented, but a
  change to sidebar gating re-runs the whole file's review surface. Split
  candidates that need no behavior change: `shell/linking.ts`
  (`normalizeShellBase`, `stripShellBase`, `getStateFromPathWithBase`,
  `linkingPrefixesForBase`), `shell/feedMemory.ts` re-export removal
  (import `#/state/feedMemory` directly), `shell/Sidebar.tsx`,
  `shell/TabBar.tsx` + `MobileStrip.tsx`, `shell/AccountMenu.tsx`.
- **`src/screens/Login.tsx` (725 LOC) — YES, condensed.** Internal
  first-party (misskey password / mastodon password / MFA / OAuth) +
  external third-party (detect / password / MFA / OAuth / MiAuth start +
  poll + cancel) + iOS inline OAuth completion + mode switching + prefill
  logic. The four `submit*Password/Mfa` pairs are near-duplicates
  differing only in origin/flavor/hosting flag. Candidate: extract a
  `usePasswordSignin(origin, flavor, hosting)` hook; `InternalForm`
  prop count then collapses.
- **`src/state/session/store.ts` (588 LOC) — cohesive, borderline.**
  Auth record management + vault persistence + device-mirror recovery +
  401/403 verify policy + scope-generation diff + in-memory permission
  markers + snapshot caching. Everything is session-credential-shaped, so
  this reads as one bounded context, not a grab-bag. Do not split by
  feature; if it grows, extract `scopeHealth.ts` (pure diff,
  `cachedAppScopes` + `computeScopeHealth`, ~80 lines) — it has no store
  deps except `readSessions`/`permissionDenied`.
- **`src/screens/Settings.tsx` (82 LOC) — fine.** Pure dispatcher over
  `section` param; each section owns its screen. No action.
- **`src/screens/AdminReports.tsx` (730 LOC) — condensed list+detail.**
  Queue list and detail live in one file sharing only pure label helpers.
  Split into `AdminReportsList.tsx` / `AdminReportDetail.tsx` (+ keep
  shared labels in place); the 7 `ConfirmShell` branches dominate the
  detail half.
- **`src/components/Settings/MutesSection.tsx` (718 LOC) — YES,
  condensed.** Word fields (3×), account search + state-aware mute/block,
  three account lists, domain blocks, renote-mute gating — five concerns
  sharing only `refreshKey`. Split candidates: `WordFields.tsx`,
  `MuteBlockSearch.tsx`, `DomainBlocks.tsx`; keep `AccountList` generic
  in `rows.tsx`-adjacent shared file.
- **`src/state/queries/adminInsight.ts` + `adminReports.ts` — fine.**
  Gate + section-state machine + hooks per surface; duplication between
  the two (`useSessionBackend`, `SectionPayload`, denied/absent mapping)
  is ~40 lines and identical semantics — extract `adminSection.ts` only
  if a third admin surface appears.

## Suspected bugs (`file:line`)

1. **Stale word-mute fields after account switch (real, user-visible).**
   `src/components/Settings/MutesSection.tsx:75-83` — `WordField` seeds
   its textarea from `me` at most once (`seeded` ref, never reset) and
   ignores later edits. `MutesSection` refetches `me` on
   `[backend, refreshKey]`, but after switching accounts the three
   `WordField`s keep the previous account's `mutedWords /
   hardMutedWords / mutedInstances` text. Saving then writes account A's
   filters onto account B. Fix: key `WordField` by session id
   (`key={session.id}` at `MutesSection.tsx:642-668`) or reset
   `seeded`/`edited` refs when `me?.id` changes.
2. **`errors.unsupported.avatar` is dead copy with false text.**
   `src/lib/localeErrors.ts:40` maps the code to *"Avatar and banner
   changes are not supported on the Mastodon family yet."* — but nothing
   in `packages/fedi/src` or `src/` throws that code (only reference is
   `localeErrors.test.ts:35`), and Mastodon **does** support avatar/banner
   upload via `uploadProfileImage`
   (`packages/fedi/src/mastodon/backend.ts:829`,
   `updateCredentialImage`, clickstone §1.8), which `ProfileEditor.tsx`
   correctly offers on both families. Either delete the entry or repurpose
   it; as-is it is untranslatable-in-practice copy asserting a falsehood.
   All 8 locales carry the string (en + 7 translations present).
3. **8 error keys ship English-only in all 7 non-en locales.**
   Verified by catalog comparison script: `errors.auth.savePending`,
   `errors.feeds.invalidDescriptor`, `errors.network.badPath`,
   `errors.network.unreachableBare`, `errors.reactions.likeUnsupported`,
   `errors.shape.createdList`, `errors.shape.updatedList`,
   `errors.unsupported.profileField` are byte-identical to `en` in
   `fr/de/ja/hi/zh-CN/zh-TW/yue-HK` (`src/locale/locales/*/messages.ts`).
   This matches the documented intent in `src/lib/localeErrors.ts:11`
   ("ship English-only until v2 adds them") for the feeds/reactions/list
   codes, but `savePending`, `badPath`, `unreachableBare`, and
   `profileField` are user-facing auth/network/profile strings with no
   such note. If "fr+7" in the brief means "French + 7" — there are
   exactly 7 non-en locales, all affected equally.
4. **`linkingPrefixesForBase` returns a bare path as a prefix
   (suspected, low-impact).** `src/Navigation.tsx:164-169` returns
   `[root, b]` where `b` is e.g. `/keystone` — a path, not a URL.
   React Navigation matches prefixes with `url.startsWith(prefix)`, so a
   full incoming URL never starts with `/keystone`; the base prefix is
   inert. Routing still works because `getStateFromPathWithBase` strips
   the base before parsing. Fix: return `[root, Linking.createURL(b)]`
   or drop the second entry. (The plain `linking` export at `:114` is
   *not* dead — `src/__tests__/nav.test.tsx` consumes it — but production
   mounts only `shellLinking`.)
5. **Internal server ID shown to users.** `AccountSection.tsx:79`
   renders *"Signed in as `{session.accountId}` on `{origin}`"* and
   `handleFor` (`:47-50`) falls back to `session.accountId` when `acct`
   is missing — yet `Navigation.tsx:340-354` (`handleLine`) documents
   `accountId` as *"the internal session key (a server-side ID like
   `are3i8gsgn…`), never the login name."* Same leak in
   `AccountSwitcher.tsx` (`label = displayName ?? accountId`) and
   `Navigation.tsx:512` (`displayName ?? accountId`). Low severity
   (IDs are not secrets) but the tree contradicts its own rule; prefer
   `user.acct`/handle with an "unknown handle" fallback.
6. **`ProfileEditor` effect deps omit `fieldCap`.**
   `src/screens/ProfileEditor.tsx:141` — deps `[backend]`. `fieldCap`
   derives from `session.family ?? backend.family`; a family change
   always swaps the `backend` object here (`useActiveBackend` memos on
   `[session]`), so this is latent rather than live — but the
   `// Load once per backend identity` comment states an invariant the
   deps don't enforce. Add `fieldCap` (or `isMastodon`) to deps.
7. **Misskey report detail limited to first 20 queue rows.**
   `src/state/queries/adminReports.ts:242` — `list({limit: 20})`, and
   `AdminReports.tsx:405-408` reports "not available, open from the queue
   list" for anything paged out. Honest but lossy: deep-linking
   `/admin/reports/:id` for an older report always 404s on Misskey (no
   show endpoint upstream — verified, file header). Consider raising the
   detail fetch limit or documenting the cap in the absent string.
8. **OAuth/MiAuth pending-store split is correct but fragile.**
   Mastodon pending flows live in `appStorage()` (`LoginFlows.ts:224`,
   `takePendingAuth` in `AuthCallback.tsx:158`), MiAuth pendings also in
   `appStorage()` (`:313-316`, `:108`) — consistent. But `Login.tsx`
   duplicates the completion logic in `finishOAuthCallbackUrl` (`:468`)
   for iOS inline vs `AuthCallback.tsx` for the link path; the two copies
   already drift in comments. Any change to verify-then-store must land
   in both. Extract `finishMastodonCallback(params, hosting)` shared by
   both call sites.
9. **NOT bugs (checked, clear):** token storage is per-`(sessionId,
   origin)` in both vaults (`tokens.ts:24-26`, `tokens.web.ts:16-18`);
   envelope MMKV copy is acknowledged tech debt with vault-wins hydrate
   (`store.ts:485-495`); `verifyActive` clears only on 401, never 403 or
   network (`store.ts:512-537`); every query key starts with `sessionId`
   (`queries/keys.ts:13-18`, enforced by throw on empty); composer
   remounts per session+target (`Compose.tsx:187`); custom-emoji stores
   rebuild on origin/token/family drift
   (`customEmojiStores.ts:41-51`); admin 403 maps to per-section
   `denied`, never session clear (`adminInsight.ts:130-138`,
   `adminReports.ts:169-178`); all moderation mutations are
   confirm-gated with refetch, no optimistic updates
   (`AdminReports.tsx:565-724`, `adminReports.ts:295-310`); callback
   pendings are read-and-delete replay-guarded (`LoginFlows.ts:260`,
   `:323-331`); web OAuth under a sub-path base still lands because both
   callback paths are routed and the address-bar cleanup preserves the
   base (`routes.ts:261-264`, `AuthCallback.tsx:73-81`).

## Quality issues

- **Duplicated settings-row patterns (biggest quality debt).** Four
  copies of the radio-dot row (`DisplaySection` `ColorModeRow` `:53`,
  `ContentModeRow` `:142`, `LanguageSection` `LocaleRow` `:53`,
  `EmojiStyleSetting` `:66`); three switch-row shapes (`FeedsSection`
  `FeedToggle` `:19` vs `QuotePolicyRow`/`DataSaverRow`); five
  TextField+Save+error clusters (`WordField`, `FiltersBody` add/edit,
  `LikeEmojiRow`, `FavouritesRow`, `DomainBlockList`). `rows.tsx` only
  shares the shell (`SettingRow`/`PlaceholderRow`/`SectionHint`). Add
  `RadioRow`, `SwitchRow`, `TextSaveRow` primitives next to `rows.tsx`.
- **Lint rules exist, pass, and have tests — with coverage gaps.**
  `lint-rules/{no-wire-in-app,no-ui-in-fedi,no-hardcoded-color}.js` are
  wired in `eslint.config.mjs` and each has a test
  (`lint-rules/__tests__/`). Gaps:
  - `no-wire-in-app` regex `/(^|\/)wire$/` only matches imports *ending*
    in `wire` — `…/wire/client` or deep file imports under a wire dir
    escape. Consider banning `\/wire(\/|$)` segments.
  - `no-ui-in-fedi` bans `window/document/localStorage` identifiers but
    not `globalThis.location/history`, `navigator`, `self`,
    `indexedDB`, or `fetch` — the exact seams (`LoginFlows.ts:63-69`
    uses `(globalThis as …).location`; `AuthCallback.tsx:76` uses
    `globalThis.history`) a future fedi contributor would reach for.
    Add `globalThis`, `navigator`, `self`, `fetch` to
    `BANNED_GLOBALS` (fedi injects fetch via seam already).
  - `no-hardcoded-color` exempts only `src/alf/themes.ts`; overlay
    chrome (`overlayChrome`) is correctly centralized. No gap found.
- **Dead routes: none.** Every `paths` entry has a `Stack.Screen` and a
  `linkingScreens()` leaf; `KeystoneCallback` is an intentional v1 alias,
  `SysDebug` (`/sys/debug`) is intentional. Flag instead: `SysDebug` is
  ungated in production nav — acceptable for a showcase today, but it
  should gain a `__DEV__` gate before release.
- **Accessibility gaps (minor):** unselected radio dots render
  `transparent` with no ring/border (`DisplaySection.tsx:76`,
  `EmojiStyleSetting.tsx:90`, `LanguageSection.tsx:81`) — selection is
  text+SR-label only, invisible at a glance in high-contrast; the
  `PlaceholderRow` uses `accessibilityRole="none"` + `disabled` state
  (`rows.tsx:64-65`), which some SRs skip silently rather than announce —
  `accessibilityRole="text"` with the reason in the label would be
  friendlier. `AdminReportScreen` note `TextInput` stays editable while
  `writeDenied` (`AdminReports.tsx:527-535`); disable with reason like
  the save button.
- **No `any` in scope source.** `grep` for `: any`/`as any`/`<any>`
  hits only `*.test.tsx` fakes (`MutesSection.test`,
  `FiltersSection.test`, `TransferSections.test`,
  `AccountSection.test`) — acceptable. One `as unknown as ViewStyle`
  trio in `Navigation.tsx` styles (`:1247-1254`) for web sticky
  positioning is the standard RN-web cast, fine.
- **No TODO/FIXME debt.** `grep` finds only intentional
  stub-with-reason placeholders (Pages sidebar row, widgets rail,
  Theme/Palette/Font rows) — each carries a user-facing reason string,
  per the project's honest-placeholder discipline. `App.tsx:4` "not
  built" comment is stale (shell exists) — one-line cleanup.
- **i18n mechanics are sound:** 8 locales in `SUPPORTED_LOCALES`
  (`locale/i18n.ts:28-37`), runtime switching via singleton +
  `I18nProvider`, validated `parseLocale` fallback to `en`. The only
  i18n defect is the 8 untranslated keys (§3 above).
- **`SectionShell` Back stacks Settings routes.**
  `SectionShell.tsx:19` uses `nav.navigate('Settings', {})` — from a
  section this pushes a *second* Settings route rather than popping, so
  repeated section→back→section grows the stack. Use `nav.popTo`/`goBack`
  or `CommonActions.reset` to the index.
- **`useExportCompletion` (`TransferSections.tsx:196`) reads the
  notifications cache but only sees rows already fetched** — mitigated by
  the explicit "Check for the file" button (`:273`), fine as designed.
  Session-scoping is correct (`queued ? sessionId : null`).
- **`store.switch()` is synchronous and emits; query caches are keyed,
  but in-flight mutations are not cancelled** — switching accounts
  mid-`assign`/`resolve` applies the mutation to the old session's
  backend (correct object) while the UI now shows the new account's
  queue; the `onSuccess` invalidation is session-keyed so no cross-talk,
  but the confirming dialog unmounts silently. Acceptable; do not add
  cross-session guards unless a report surfaces.

## Top 5 fix priorities

1. **Fix `WordField` stale-seed on account switch (P0, data corruption).**
   `MutesSection.tsx:75-83` — saving another account's filters onto the
   active account is the only in-scope defect that writes wrong data
   to the server. One-line fix: `key={session.id}` on the three
   `WordField`s (or reset refs on `me.id` change) + regression test
   (switch session, assert textarea reseeds).
2. **Remove or correct `errors.unsupported.avatar` (P1, false user copy).**
   `src/lib/localeErrors.ts:40` — dead code asserting Mastodon lacks
   avatar/banner support, contradicted by `mastodon/backend.ts:829` and
   `ProfileEditor.tsx`. Delete the entry (and the test line) or repoint
   it at a real condition. Grep-guard in CI (`errors.*` keys must be
   thrown somewhere in `packages/fedi/src`) prevents recurrence.
3. **Translate (or ticket) the 8 English-only error keys (P1, i18n).**
   `savePending`, `badPath`, `unreachableBare`, `profileField`,
   `likeUnsupported`, `invalidDescriptor`, `createdList`, `updatedList`
   ship in English inside all 7 non-en catalogs. Either send to
   translators or narrow the documented "English-only" comment in
   `localeErrors.ts:11` to exactly the codes it means.
4. **Split `Navigation.tsx` shell chrome out of the navigator file
   (P2, maintainability).** Extract `shell/linking.ts`,
   `shell/Sidebar.tsx`, `shell/TabBar.tsx`, `shell/AccountMenu.tsx` —
   zero behavior change, each independently reviewable; stops the
   1413-line file absorbing every future chrome feature. Same treatment
   for `MutesSection.tsx` (`WordFields` / `MuteBlockSearch` /
   `DomainBlocks`) and `AdminReports.tsx` (list vs detail) as P2
   follow-ups; add shared `RadioRow`/`SwitchRow` primitives to kill the
   four radio-dot copies.
5. **Tighten the two lint rules + gate `SysDebug` (P2, prevention).**
   `no-wire-in-app`: match `\/wire(\/|$)` segments, not just trailing
   `wire`. `no-ui-in-fedi`: add `globalThis`, `navigator`, `self`,
   `fetch` to banned globals. Gate `/sys/debug` behind `__DEV__`.
   Deduplicate `finishOAuthCallbackUrl` (`Login.tsx:468`) with
   `AuthCallback.tsx` into one shared `completeMastodonCallback` helper
   while touching auth code.
