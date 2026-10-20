# 2026-10-20 — Butterfly composer + popups + motion — agent

Branch: `p3.1-signin-functional`
Goal: compact composer, anchored popups, instant motion (v1 parity),
proven in Helium against the live session.

## Did

- CompactComposer (`src/components/Composer/CompactComposer.tsx`): avatar +
  borderless input + CW, audience pill, hairline, icon toolbar
  (media/poll/smile/CW/more + counter + Post/Schedule/Reply/Quote),
  poll/uploads/schedule/drafts sections shared with the full Composer via
  extracted `ComposerSections.tsx` (same testIDs). Controller extracted as
  `useComposerController` (full render byte-identical, tests green).
  Home inline + Compose modal both use compact now.
- Audience vispick popup (icons + v1 copy + radio dots), More popup (Who
  can react radios, Local only, Schedule + datetime expand, Drafts +
  restore/delete), emoji picker popup at the smile button. Copy from v1's
  own `en.ts` locale.
- `AnchoredPopup` (`src/components/Popup.tsx`): Modal portal, anchor
  measurement, below/above flip, viewport clamp, instant open, backdrop
  dismiss, centered fallback when unmeasurable (jest). PopupRow/RadioDot/
  Desc/Sep/Head pieces.
- `Menu` + `PostMenu` migrated Dialog → AnchoredPopup (tiers + delete
  confirm preserved, testIDs kept). ProfileActions inherits it.
- Motion: stack `animation: 'none'`, compose transparentModal none,
  Popup/Dialog/Lightbox `animationType="none"` (v1 has no transitions).
- Icons added: Globe, Lock, At, PollBars, Schedule, Media, Smile.
- Fixed live-found popup bug: web `measureInWindow` is
  document-relative but the Modal portal is viewport-relative — subtract
  page scroll or scrolled feeds fling cards ~10k px off-screen. Found by
  measuring the card rect in Helium (y=-9703).
- Fixed live-found nav bug (prior session): post-login `reset` to Main.

## Decided (-> DECISIONS)

- Compact is the only composer chrome (full `Composer` stays for its
  tests/back-compat; revisit deletion later).
- No per-note noQuote in v2 composer state (backend wire supports it;
  future slice).
- Emoji picker dialog remains for the full composer; compact uses popup.

## Tests / verification

- `pnpm typecheck` (×3) green; `pnpm lint` exit 0.
- `pnpm test`: **63 suites / 845 tests pass** (new:
  `CompactComposer.test.tsx` ×4, icons ×5 new icons; updated Menu test).
- Failures fixed: RN `Pressable` takes no ref (RNPressable for anchors);
  Modal-subtree effects don't flush pre-assertion in tests (synchronous
  centered fallback position); `m-dialog`→item assertion.
- Helium proofs (viewed, live :8081 session): compact composer on home;
  audience popup anchored under pill; note ⋯ menu anchored at trigger
  with disabled-with-reason rows; overlay desktop + mobile.
- v1 reference: user's K1vK2 screenshots (all 17 viewed) + live :5173.

## Deviations / follow-ups

- `scripts/helium.mjs` gained `CDP_PORT`; shot holds one socket.
- HMR staleness seen once (full reload fixed it); watch for it.
- Inline composer autosave/draft-restore shared with modal (same id per
  session — two mounted composers share one draft id; acceptable, logged).
- Next: Sharkey `notes/like` behavior (spec received); then feed chrome,
  notifications, explore, settings pages.

## Bluesky reference paths consulted

- None (v1 carried the patterns; ADR-0001).
