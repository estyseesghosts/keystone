# 2026-10-23 — Hovercard blink root-cause + portal rewrite, P6.4 merge, branch prune — agent

Branch: `p6.4-sidebar-reshuffle` → merged to `main` (`2e4b55b`); branch pruned.
Goal: fix rapidly-blinking hovercards; merge sidebar slice; prune 48-branch pileup.

## Did

- **Blink root cause (verified in RNW source, not guessed):** the card
  rendered through RN Web `Modal`, which wraps content in two
  full-viewport `pointer-events:auto` layers (`ModalAnimation` fixed
  inset-0 z9999 div + `ModalContent` root View —
  `node_modules/react-native-web/src/exports/Modal/`). The overlay sits
  above the anchor and steals its hover the frame the card opens:
  `mouseleave` (relatedTarget = overlay, outside both subtrees) → 400ms
  close → unmount → anchor re-hovered → reopen. Self-sustaining ~800ms
  limit cycle. No leave-guard or scroll-grace could fix it (no scroll
  fires; relatedTarget is genuinely outside).
- **Fix (`416d39e`):** dropped RNW `Modal`. New `HoverLayer` appends an
  owned `div` to `document.body` (fixed inset-0, z-60,
  `pointer-events:none` end to end) and portals the card box into it via
  lazily-required `react-dom` `createPortal` (guarded: native bundles
  never evaluate it). Card box is the only `pointer-events:auto` node,
  native DOM enter/leave, explicit sans `fontFamily` stack. Escape /
  scroll / resize dismiss preserved with 500ms mount-settle grace.
  Anchor side unchanged (`onMouseEnter/Leave`,
  `leaveTargetStaysInside`, 400/400ms timers).
- **Tests:** `jest.mock('react-dom')` → inline portal (test renderer
  can't host a DOM portal); no-DOM inline fallback in `HoverLayer` (this
  repo's Jest env has no `document` — proven by probe; the old
  Modal-based tests only passed because RN's test-renderer Modal mock
  renders children inline, i.e. they never tested the Modal layer).
- **Merge + prune:** `p6.4-sidebar-reshuffle` merged to `main` (`2e4b55b`,
  `--no-ff`). Deleted all 46 branches already merged into `main` plus
  `pf-bio` (see below). Only `main` remains locally. `main` is now
  11 ahead of `origin/main` (10 pre-existing + this merge) — **not pushed**.
- **pf-bio verdict (2 commits, both superseded — branch deleted):**
  1. `82711a3` PF-E4 multi-line bio/field newlines — tests-only; the
     behavior landed via P6.4 content pass (`72f0167`); main already has
     `profileFields.test.tsx` + html tests.
  2. `3052f59` PF-E6 translation capability (`detect.ts` probe logic) —
     main's `detect.ts` is strictly newer (adds polls_hide_totals,
     no_quote, announcements, direct_messages, admin_read/write, …)
     and already contains the translation evidence fields
     (`translationAdvertised`, `akkoma:machine_translation`) via the
     merged translate-gate work. Merging pf-bio would have REGRESSED
     `detect.ts`. PF program is closed per STATE.md.

## Decided

- Never render hover floaters in RNW `Modal` (hover-stealing overlay);
  owned click-through portal is the pattern. No ADR (slice-local fix,
  recorded here).
- `main` left unpushed — owner pushes (rig creds / shared repo).

## Tests / verification

- `pnpm run typecheck` (ios+android+web) clean; `pnpm run lint` clean
  (one self-inflicted error fixed: disabled a nonexistent
  `@typescript-eslint/no-require-imports` rule — removed the comment).
- `pnpm test` → **193 suites / 2437 tests green**.
- Browser: `not verified` here (no local-Akkoma testing per owner);
  owner live-verified the fix on external Misskey/Mastodon servers.
- Serif report: cleared in Chromium; explicit card font stack kept.
- Akkoma banner note: local rig default `/images/banner.png` is a
  112-byte stub (200) — "banner doesn't load" there is a data
  artifact; live servers show real banners.

## Deviations

- Touched only `src/components/Profile/HoverPreview(.test).tsx` +
  docs/state files. Untracked owner drops (`docs/k1k2-…`, `ios/`, …)
  untouched.

## Next

- Owner: push `main` (11 ahead of origin).
- Wave 3.3 user moderation (per STATE.md Next steps).

## Follow-up: viewport clipping fix (same day, `20fd545`)

- Owner report: cards over anchors near the window top/bottom clip
  off-screen. Cause: the above/below flip estimates a fixed 380px
  card, but real cards vary with bio length. Fix: `HoverLayer`
  measures the mounted box (`getBoundingClientRect`, already
  viewport-relative) and shifts it inside with an 8px margin via pure
  `clampToViewport` (unit-tested: fits/bottom/top/right); a
  `ResizeObserver` re-clamps when banner/avatar loads resize the
  box. Correction resets whenever the anchor position changes.
- `pnpm test` → 193 suites / 2441 tests green; typecheck + lint clean.

## Follow-up: bio chips + Misskey banners (same day, `0febedc`, owner-verified live)

- Owner report: gray banner strip on every Misskey (dvd.chat/Sharkey)
  hovercard; bio mention chips static (handle, no avatar) on both
  families. Verified live: Sharkey packs note `user` WITHOUT
  `bannerUrl` (key absent); `users/show` returns it
  (`chatstorage.dvd.moe/...webp`, 200, no hotlink blocking) —
  missing data, not a broken image. Mastodon embeds are full.
- Fix: `useFullAccount` (`src/state/queries/accounts.ts`) — card
  shows the embed immediately, upgrades to `backend.account({id})`
  when `headerUrl` is missing (cached per session; Mastodon never
  fetches). Session `backend` threaded `HoverPreview` →
  `UserHoverCard` → bio `RichText` + mention-chip cards, so bio chips
  resolve (avatar + display name) everywhere.
- `pnpm test` → 193 suites / 2444 tests green; typecheck + lint clean.

## Follow-up: header time row, composer UX, bridged mentions (`<hash>`, owner-verified next)

- `· time` moved into the display-name row (bound to name width, not
  the handle's); handle on its own row below under the same hover
  zone; context rows already full-width above the avatar row.
- Both composers: `outlineWidth: 0` (no browser focus ring);
  `useAutogrowInput` grows/shrinks the field (inline 72–320,
  floating 120–480) with internal scroll past the cap.
- Bridged `@bsky.brid.gy` mentions: root cause was `parseAcct`
  rejecting dots in the username part (mfm-js parses them fine), so
  chips stayed static and taps fell through to the bsky.app URL in
  the browser. Dots now accepted (parseAcct + translated-handle
  scan); `bsky.app/profile/<h>` maps to `<h>@bsky.brid.gy` in-app;
  both families resolve via `backend.account` (Misskey users/show,
  Mastodon lookup). Malformed bsky URLs still open externally.
- Tests: 194 suites / 2449 green; typecheck + lint clean. Test-env
  note: `restoreAllMocks` was leaking `openURL` calls across tests
  in the routing block (no prior test ever recorded one) —
  `clearAllMocks` added.
