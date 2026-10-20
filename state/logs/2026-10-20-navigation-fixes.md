# 2026-10-20 — navigation fixes (tab bars, profile/post press wiring, Settings trap) — subagent

Branch: `p3.1-signin-functional` (already checked out; no branch switch, no merge)

Goal: three navigation fixes — v1-parity tab bars, avatar/name/handle → User
+ body/card → Note wiring, and the Settings trap (can't navigate away).

Did:

- `src/Navigation.tsx` (only chrome file touched):
  - Deleted `useActiveLeaf` + all `useNavigation` shell-chrome usage.
    Leaf state is tracked once via the container `onReady`/`onStateChange`
    and handed to `Sidebar` / `MobileStrip` / `ShellTabBar` as a prop, so
    chrome re-renders on EVERY navigation (tab switches included — the old
    per-component `'state'` listener missed tab changes).
  - Deleted `ButterflyTabBar` (the tab navigator's bar, which unmounted
    with `Main` on every pushed screen). New `ShellTabBar` renders in the
    shell on mobile BELOW the stack, so it stays mounted on Settings, Note,
    Tag, List, Login. Same v1 styling (equal `flex:1` tabs, icon over 10px
    label, active inverted, `Home / My Network / Search / Notifications /
    Profile / Sign in` wording) with metrics set to v1's
    `.mobilenav .navlink` values (9px/3px padding, 3px gap).
  - New `goMainTab(key)`: shell chrome navigates via the root ref with an
    explicit `Main` hop (`navigate('Main', {screen: key})`). Focusing `Main`
    pops pushed stack screens, so every tab always escapes.
  - `MainTabs` no longer installs a custom `tabBar` (default bar hidden via
    `tabBarStyle: display none`).
  - Sidebar entries + signed-out Sign in now go through `goMainTab`.
  - `MobileStrip` back reads `navigationRef.canGoBack()/goBack()` live at
    press time instead of a render-captured value.
  - New `isTabFocused`: Profile reads active only for the viewer's own
    profile id (v1 never lights it on someone else's profile).
- `src/components/Post/PostCard.tsx` (header/avatar press wiring + Avatar):
  - `Avatar` wrapped in a `link`-role Pressable → author profile
    (`testID avatar-press-<authorId>`; inner `avatar[-fallback]-<id>` kept).
  - Header split into two stops: name+handle Pressable → profile
    (`author-press-<id>`), time Pressable → post detail (`post-time-<id>`).
  - Body `RichText` wrapped in a `link`-role Pressable → post detail
    (`post-open-<id>`). Link taps stamp a 400ms guard so nested
    mention/hashtag/URL presses don't double-navigate via bubbling.
  - Default link behaviour preserved when the card supplies no handler
    (external URLs open out; bare hashtags open the Tag route — previously
    inert when `href` was null). All behind `navigationRef.isReady()`, so
    presentational trees stay silent no-ops.
  - `openAuthorProfile` navigates `Main → User {id}` (User is a tab, not a
    stack screen); `openPostDetail` → `Note {id}`; `openTagPosts` → Tag.
- Tests:
  - New `src/__tests__/nav-escape.test.tsx` (3 tests): tab bar mounted on
    Settings + tab escapes; strip back leaves Settings; tab→tab switch
    inside Main. `#/screens/Settings` is stubbed (testID shell only) —
    see Deviations.
  - New `src/components/__tests__/post-navigation.test.tsx` (4 tests):
    avatar/header → User route, body/time → Note route (mocked ref), plus
    the no-container no-op case.
  - `src/components/__tests__/post.test.tsx`: one assertion updated for
    the intentional header split (handle and time are separate stops now).
- Verified the new escape tests FAIL on pre-fix `Navigation.tsx`
  (`git stash` round-trip): `tab-Home` missing on Settings; strip-back
  press a silent no-op (timeout).

Decided (→ DECISIONS/ADR: none load-bearing; shell-chrome navigation scope
rule recorded here for the parent):

- Shell chrome must never navigate by bare route name — it lives outside
  every navigator. Always `navigationRef` with an explicit `Main` hop.
- Pushed screens (any stack screen) strand users unless chrome persists
  outside the stack navigator. Tab bar and sidebar now do.
- `MobileStrip` back must read `canGoBack()` at press time, not render.

Tests / verification (paste commands + results):

- `NODE_ENV=test npx jest src/__tests__/nav-escape.test.tsx
  src/components/__tests__/post.test.tsx
  src/components/__tests__/post-navigation.test.tsx
  src/components/__tests__/richtext.test.tsx
  src/components/__tests__/postfeed.test.tsx
  src/components/__tests__/postactions.test.tsx
  src/components/__tests__/media.test.tsx --forceExit`
  → 7 suites / 62 tests pass (exit 0).
- `npx eslint` on the 5 touched/new files → exit 0.
- `npx tsc --project tsconfig.check.ios.json --noEmit` → single error
  `src/Root.tsx(7,62): ';' expected` — sibling breakage (see Deviations),
  zero errors in touched files.
- Pre-fix guard check: same escape suite vs stashed (original)
  `Navigation.tsx` → 2 failed (missing `tab-Home`; strip-back timeout).
- Native/web runs → `not verified`. Live v1 at :5173 (HTTP 200) not
  screenshotted; styling taken from source + K1vK2 shots instead.

Deviations (files touched outside the slice + why):

- `src/components/__tests__/post.test.tsx` assertion updated (intentional,
  justified above).
- Test-only stub of `#/screens/Settings`: a sibling agent is concurrently
  rewriting `src/screens/Settings.tsx` (119 lines, imports
  `./Settings/*` section modules that do not exist yet) and separately
  broke `src/Root.tsx` line 7 (`...appearance'import {ToastHost}...`,
  missing separator — fails the whole jest suite for any importer of Root
  and `tsc`). Did NOT touch either file (out of scope). The stub keeps the
  shell-escape regression test independent of settings-content churn; the
  escape mechanics are identical for every pushed screen.
- K1vK2 screenshots used: `3.45.32` (desktop composer over rail: K brand,
  icon column, active-inverted Home) and `3.47.05` (Note thread page).
- v1 sources consulted (patterns only, no verbatim code):
  `frontend/src/components/Layout.tsx` (`MobileNav`, `.sitenav`,
  back-in-strip, `AccountCard` footer, 5-tab mobile set, prefix-active
  Network/Profile), `frontend/src/styles/global.css` (`.navlink`,
  `.navlink.active`, `.mobilenav`, `.mobile-account`, `.compose-fab`,
  rail/full cut points), `frontend/src/components/NoteCard.tsx`
  (`openDetail` with interactive-content guard, `avatarlink`/`namelink`
  → `/users/:id`, time link → `/notes/:id`).

Next:

- Parent: merge-review; note the sibling collision (Settings rewrite +
  Root.tsx syntax error) blocks the full trio + `nav.test.tsx` until healed.
- Follow-ups (not this slice): `PostRow` (HomeFeed/Note thread) avatars
  still static (feed lists out of scope); reply-context/boost-header rows
  not linked; safe-area insets still fixed padding (probe: SafeAreaProvider
  hangs in jest — needs a native-run follow-up); no live device/web proof.
- STATUS: done, verified to the extent the shared tree allows.
