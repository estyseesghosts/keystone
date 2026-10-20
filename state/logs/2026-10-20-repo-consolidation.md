# 2026-10-20 — repo consolidation (one main) — agent

Branch: `p6.0-w1-foundations` (branched from `main` after the merge)
Goal: consolidate the three branches into one `main` without losing docs,
build fixes or any uncommitted progress.

## Did

- Backed up before touching history (no remote configured):
  - tag `pre-merge-2026-10-20` at `e6cf34d` (the old working-branch tip);
  - `git bundle create ~/Downloads/keystonev2-premerge-2026-10-20.bundle --all`;
  - `git bundle verify` → "complete history", 5 refs; 911 KB;
    sha256 `185c074641939151a71521b51134c2f78ee30f30e87e2c45dd4bdd2c02223e1f`.
- Topology check before merging: `main` was a strict ancestor of
  `p3.1-signin-functional` (0 main-only commits, 4 ahead); `p1.1-expo-skeleton`
  was already fully merged into `main`; no stashes, tags, remotes or extra
  worktrees.
- Committed the working tree in logical commits (oldest first):
  - `e21216a` fix(shell): derive layout from viewport width, not inert media
    queries (breakpoints + tests + shell log).
  - `a4e7c25` state: point at gap closure; record shell + register decisions.
  - `c87466b` docs: add v1 parity gap register and closure program
    (`docs/parity-gaps.md`, `gap-closure.md`, `handoff-gap-closure.md`,
    docs/tasks indexes, gap-audit log).
  - `111bd06` build(android): check in prebuild with minSdk 31; includes
    `.serena/project.yml`.
  - `f5b333a` docs: commit K1 vs K2 reference screenshots.
  - Note: the state commit landed one position earlier than planned because
    two commits were attempted in parallel and collided on `.git/index.lock`;
    the docs commit was retried sequentially. No content lost.
- Moved the machine-specific `org.gradle.java.home` line out of
  `android/gradle.properties` into `~/.gradle/gradle.properties`; the tracked
  file now documents the Java 17 requirement instead of pinning one machine.
- Committed `android/` source (36 files; `build/`, `.gradle`,
  `local.properties`, `.cxx/` stay ignored by `android/.gitignore`), so the
  minSdk 31 build fix is no longer untracked work.
- Committed `docs/K1vK2/` (17 PNGs + README) as the owner-requested
  reference evidence; no app or test reads them.
- Verified the trio **before** merging (`tsc` ios/android/web, full
  oxlint+eslint, jest).
- Fast-forwarded `main`: `2cdd6ba..f5b333a`, 185 files, +11892/−1003, no
  merge commit, no conflicts.
- Deleted `p1.1-expo-skeleton` and `p3.1-signin-functional`; created
  `p6.0-w1-foundations` from the merged `main`.
- Docs preserved in history: parity register, gap program, handoff prompt,
  audit log, all task files/ADRs/DECISIONS/STATE/logs, build notes and the
  K1-vs-K2 evidence. `docs/` was not touched destructively at any point.

## Decided (→ DECISIONS entries)

- Android native project is tracked (bare/prebuild workflow) so the working
  minSdk 31 build survives a clean clone; the JDK pin is machine-local.
- `docs/K1vK2/` screenshots are committed as reference evidence.
- One `main` + tag + full bundle is the backup until the owner adds a remote.

## Tests / verification (commands + results)

- `node_modules/.bin/tsc -p tsconfig.check.{ios,android,web}.json` → clean.
- `node_modules/.bin/oxlint --quiet src && node_modules/.bin/eslint .` → clean.
- `NODE_ENV=test npx jest --forceExit --testTimeout=20000` → **76 suites /
  950 tests passed** (same pre-existing worker force-exit warning).
- `git merge --ff-only p3.1-signin-functional` → fast-forward, no conflicts.
- Branch list after cleanup: `main` and `p6.0-w1-foundations`, both at
  `f5b333a`.
- Bundle: `git bundle verify` OK; complete history; 5 refs.

## Deviations (files touched outside the slice + why)

- `android/gradle.properties`: removed the machine-specific JDK path
  (replaced with a comment). Created `~/.gradle/gradle.properties` outside
  the repo with the actual pin.
- Added `android/` and `.serena/` to history (previously untracked).
- `docs/DECISIONS.md`, `state/STATE.md`, this log: consolidation record.

## Next

- Start **W1 Foundations** (`docs/tasks/gap-closure.md`) on
  `p6.0-w1-foundations`: capability evidence into sessions/backends, one
  route table, legacy redirects, URL-backed Network tabs, Backend additions.
- Owner: add a remote when ready and push `main`; the bundle in
  `~/Downloads` is the only off-repo backup until then.
