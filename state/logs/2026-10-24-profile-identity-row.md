# 2026-10-24 — Profile identity row + larger avatar (follow-up) — agent

Branch: `main` (direct; standing owner instruction).
Goal: owner follow-up on the profile layout — actions sit to the
right of the name/handle in one visual row, identity left-justified
so long names never push the buttons, avatar ~10% bigger.

## Did

- `ProfileAvatar.tsx`: `PROFILE_AVATAR_SIZE` 88 → 96 (≈ +9%, the
  "about 10%" bump). Banner height unchanged.
- `ProfileHeader.tsx`:
  - Avatar row is avatar-only again (overlap `-48`, half of 96).
  - New identity row (`profile-identity-row`): left text column
    (`profile-identity`, `flex: 1, minWidth: 0`, left-justified —
    DisplayName is single-line so long names truncate, never pushing)
    plus the caller-supplied actions in `profile-identity-actions`
    (`flexShrink: 0`, vertically centered in the same row). No slot
    when the caller supplies no actions. Locked/bot captions ride in
    the text column. Stats/cards/background/tabs untouched.
- Tests (`profileLayout.test.tsx`): avatar-size pin (96);
  identity-row test (left-justified flex column, unshrinkable
  actions slot, name + handle + stub actions all inside one row);
  no-slot case. RNT note: `.parent` returns the element itself in
  this version — the row needed its own testID for `within`.

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **199 suites / 2554 tests green**.
- Device/web visual: `not verified`.

## Next

- Owner visual check; push `main`.
