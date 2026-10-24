# 2026-10-24 — Hovercard late-revive fix (crossing-only) — agent

Branch: `main` (direct; standing owner instruction).
Goal: owner-verified failure — after a card fades out, moving the
pointer back into its former screen area fades it back in. A prior
400ms time-grace gate did not fix it (any entry inside 400ms of any
leave resurrected, including returns from far away).

## Rule (replaces the time gate)

A card-enter revives IFF (a) its `relatedTarget` is inside the anchor
subtree — a certain direct anchor→card crossing (its anchor-leave was
skipped as stays-inside, so no timestamp exists) — or (b) it lands
within the 150ms visible-fade window after the last genuine leave (a
fast gap crossing while the card still fades). Anything later is a
revisit of a corpse: no close-cancel, no refade, unmount proceeds.
Slow crossers recover with one anchor wiggle (anchor re-enter refades
instantly). Anchor enters unchanged (pointer over the anchor = intent,
plus the pointer-freshness gate).

## Did (subagent, integrated by lead)

- `HoverPreview.tsx`: `shouldReviveOnCardEnter` (pure, unit-pinned);
  card `onMouseEnter` takes the event and gates on it;
  `HoverLayer.onEnterCard` widened to receive the event. Leave
  stamping, timers (still event-scheduled only), drift-dismiss, and
  freshness gate untouched.
- `RichText.tsx`: identical rule in `MatrixHover` via the shared
  helper. Mention-press untouched.
- Tests: revive moved +200ms→+100ms; +450ms ignored + unmounts;
  outside-relatedTarget enter at +300ms ignored + unmounts;
  `shouldReviveOnCardEnter` branch suite (helper-level: host refs
  are opaque mocks under this renderer, so branch (a) can't be
  driven at component level — documented in the test).
- Lead review: diff coherent, no cross-talk with the translation
  commit (disjoint regions).

## Tests / verification

- Targeted: hover/matrix/anchor suites green at handoff.
- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- Full `pnpm test` → green (see tail after commit run).

## Next

- Owner hover-feel check; push `main`.
