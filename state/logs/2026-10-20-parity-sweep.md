# 2026-10-20 — v1-parity sweep (6 slices, 5 subagents + popup) — orchestrator

Branch: `p3.1-signin-functional`. Committed as `ffffe08d` (trio 75/940
green at commit). Prior commit `5af86bf` (unlike queue-seed fix) included.

## Slices (all subagent work; files disjoint by design)

1. **Profile v1 parity** (`ses_ea4cbddc3ffewxE64qMXjg21e1`): `User.tsx`
   rewritten (ProfileHeader/Banner/Avatar/Tabs), shared FeedView reused.
   Header fixed above feed (ListHeaderComposition impossible without
   touching shared list — accepted).
2. **Tabs/taps/trap** (`ses_ea4cbddc3ffdl1skSrBVxVubuD`): persistent
   shell `ShellTabBar` (old bar unmounted on pushed screens — half the
   trap); chrome navigates via ref + Main hop; avatar/name/handle ->
   User, post -> Note; regression tests (trap fails pre-fix via stash
   round-trip).
3. **Threadlines** (`ses_ea4cbddc2ffeIjBfJ9c4n63pIW`): `ThreadRow`
   (avatar-column connector, first/middle/last) over
   `computeFeedThreadLinks`; HomeFeed integrated.
4. **Emoji + flat settings** (`ses_ea4c29225ffequkM0ctWXZ1ju`, phase 1):
   OpenMoji default + persisted picker; 2-section page (superseded).
5. **Post detail** (`ses_ea4cbddc1ffdK0CwtvW9rQ`): `Note.tsx` reworked onto
   `usePostThreadQuery`/`useThreadRepliesQuery` (session-first keys),
   ancestors + focused + ReplyBranch, pull-to-refresh, retry states.
6. **Settings tree, phase 2** (same session as 4, continued): 9 v1
   sections internally navigated (no navigator changes); REAL rows backed
   by ported state (feedPrefs, emojiPrefs, appearance ext, mutes,
   filters, import/export stubs); greyed placeholders with reasons for
   unwired rows (owner override: visible > omitted). Task
   `docs/tasks/p5.1-settings-tree.md`, 3 DECISIONS lines.
7. **Popup caret + entrance** (orchestrator, direct): `usePopupEnter`
   fade/scale on AnchoredPopup + Dialog; edge caret aimed at trigger
   centre, clamped, null until measured.

## Verification

- `pnpm typecheck` (ios+android+web) + `pnpm lint` + `pnpm test`: **75
  suites / 940 tests green** (output in background shell sh_15b5089d).
- Mid-flight breakage (settings agent's `Root.tsx`/missing modules)
  healed by that agent before landing — no residue.
- Helium visual pass NOT done: isolated CDP :9223 unresponsive (blank
  tab, load timeouts, eval hangs — browser wedged, needs relaunch).
  Retry before merge-review: profile, settings tree, tabs, threadlines,
  detail, popup caret vs v1 :5173.

## Next

- Relaunch isolated Helium (`--remote-debugging-port=9223` ...) and do
  the visual pass; screenshots into this log's successor.
- Owner merge-review of `p3.1-signin-functional`, then device runs.
