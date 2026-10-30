# 2026-10-29 — polish/6 regression + visual verification (Deliverable 6) — agent

Branch: `polish/6-regression` (cut from `polish/5-nav-polish`; inherited
tree dirt left alone; never `git push`; nothing committed — my touched
files share the tree with uncommitted P6.5-chain/slice-1–5 work, so not
cleanly separable; file list below)
Goal: regression + visual verification — combined coverage check,
gap-fill pins only, intl sweep, replies-doc note, web build
(`docs/visual-polish.md` Deliverable 6).

Did:

- Read `AGENTS.md`, `state/STATE.md`, polish-5 log (handoff: ~15 msgids
  pending, owner-eyeball list), polish-1 log (§3.2 line-71 note),
  `docs/visual-polish.md` Deliverable 6 + no-gos, `docs/tasks/visual-polish.md`
  in order; confirmed branch `polish/5-nav-polish`, cut `polish/6-regression`.
- Combined coverage check: every deliverable's acceptance tests exist and
  pass — D1 7 thread-order proofs (`Note`/`HomeFeed`/fedi backends), D2 8
  `widgetsPanel` + 8 `shell-chrome` panel tests, D3 40 widget unit tests
  (21 model + 11 store + 8 renderer), D4 10 editor flow tests, D5 11
  nav-polish tests. All green in the full run.
- Quote/repost risk review (verify, don't duplicate): grep confirms zero
  polish-chain imports in post paths — no hits for `Tooltip`,
  `shell/Sidebar|TabBar|AccountMenu|WidgetsPanel|MobileStrip`, `Pagehead`,
  `#/widgets`, `widgetsPanel` in `src/components/Post/` or
  `src/screens/Note.tsx`; `src/widgets/` mentions of `components/shell`
  are rule comments only. Slice 5 never changed shared `Pressable` itself.
  Existing quote (`Post/quotes`) + repost (`__tests__/post` boost headers)
  suites preserved untouched. No duplicated assertions added.
- Gap-fill (new `src/components/shell/polish-regression.test.tsx`, 7
  tests — the only test additions this slice; none of these assertions
  existed elsewhere, verified by grep before adding):
  - Pagehead (slice-5-touched, slice-5-untested): web Tooltip `Back` +
    a11y parity; press goes back with history, falls back to
    `Main/Home` on a deep link (navigationRef driven explicitly —
    container-less ref is never ready); null on mobile layout.
  - MobileStrip: web `Back` tooltip + parity, section title kept;
    no-history press falls back to the feed tab via `goMainTab`.
  - AccountMenu trigger: web `Account menu` tooltip + parity; press
    flips `expanded` and opens the menu (SessionProvider harness).
  - D6 risk pin: packed-quote PostCard + pure-renote PostCard render
    `post-quote-p1-card` + `boost-header-wrap` with zero Tooltip spans
    on web — Tooltip stays shell-only.
- `pnpm intl:extract` + `pnpm intl:compile` (repo convention per X9.8
  `ac3a4e0`: extract en + compile all). Result kept: `en/messages.po`
  +304/−223 (all ~15 polish msgids in: Edit/Collapse/Show widgets panel,
  Add widgets, Current widgets, No widgets yet[.+Add one below.],
  Move up/down, Widget(s), placeholder/unavailable copy, Back refs;
  plus P6.5-chain msgids; exactly ONE msgid removed — P6.5's own
  superseded `{unread, plural…}` string, legitimate `--clean` behavior;
  rest is `#:` reference-line churn). Compiled `messages.ts` ×9 updated
  with English fallbacks. Missing-count 1480 in carried locales is
  pre-existing (untranslated seeds fall back to source). No revert needed.
- `docs/replies.md` §3.2: added dated supersession blockquote (no ADR —
  slice-1 rationale stands: plan-level deliverable, not a new decision;
  section otherwise preserved as v1 historical record).
- `pnpm build-web` → success, `dist` exported (gitignored).
- Checked step-6 + "Each slice" + "No-gos" boxes in
  `docs/tasks/visual-polish.md`. Left `state/STATE.md` alone
  (coordinator owns it).

Decided (→ ADR or DECISIONS entry if load-bearing):

- None load-bearing (no ADR). Recorded: zero new regression assertions
  for quote/repost bodies (duplication refused — risk verified absent by
  import grep + preserved suites green/identical); intl churn kept (one
  legitimate obsolete-msgid removal, convention-matched extract+compile);
  replies-doc touch-up as dated note, not rewrite.

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → clean, no output.
- `pnpm lint` (oxlint + eslint) → clean, no output.
- New suite: `polish-regression.test.tsx` 7/7 pass.
- Full `pnpm test` → `Test Suites: 13 failed, 289 passed, 302 total` /
  `Tests: 90 failed, 4153 passed, 4243 total`. The 13 suites / 90 tests
  are ALL the pre-existing content/link/richtext/post reds
  (content-ast, content-html, content-link-disclosure, linkpreview,
  linkpreview-policy, LinkCard, PostCard-privacy, body, body-tags,
  quotes, profileFields, richtext, richtext-wsb) — identical set to the
  slice-5/2026-10-28 baseline (failures flat at 90; delta is exactly my
  +1 suite / +7 tests, all green: 4236→4243 total, 4146→4153 passed).
  Zero slice-attributable failures.
- `pnpm build-web` → success (`dist` exported). Wide/intermediate/phone
  visual inspection → `not verified` (no browser in this environment).
- Device/keyboard/touch runs → `not verified` (rig servers owner-run;
  no push).
- `MODEL_SHAPE_HASH`/`SCHEMA_VERSION` untouched (no `packages/fedi`
  changes on this slice; that tree dirt is inherited P6.5-chain work).

Deviations (files touched outside the slice + why):

- `docs/replies.md` (§3.2 note) — in-slice per explicit slice-6 brief
  (slice-1 note resolution).
- `src/locale/**` (extract+compile output) — in-slice per explicit
  slice-6 brief; mixes polish + P6.5-chain msgids, separability is the
  owner's call at merge.
- My files only: `src/components/shell/polish-regression.test.tsx`
  (new), `docs/replies.md` (note), `src/locale/**` (catalogs),
  `docs/tasks/visual-polish.md` (checkboxes), this log. No new
  dependencies. No prod-code changes this slice.

Next:

- Owner-run (left unchecked in task tracker): eyeball wide
  (≥1152, panel mounts) / intermediate (panel hidden, feed 720) / phone
  (mobile model); tooltip dwell on rail icons + strip/pagehead back +
  account trigger (web); inverted-pill rail quick actions (both themes);
  keyboard Tab focus rings through sidebar/chrome (web); group gap
  28→32; rail ScrollView-in-sticky-rail; Dialog editor on native;
  thread order on Misskey + Mastodon families. `docs/visual-polish.md`
  "acceptance boxes verified per deliverable" box stays unchecked until
  then.
- Audit backlog from slice 5 stands (Post/ActionBar:269 + Note:637 +
  ProfileEditor raw Pressables, ToastHost dismiss, post-action counts
  vs tooltips, Menu/PopupRow hover-title, hovercard polish) — separate
  product decisions, not D6.
- Bluesky reference paths consulted: none (in-repo precedents only:
  shell-chrome width-mock, nav-polish tooltip helpers + session harness,
  post.test boost construction, X9.8 extract+compile convention).
