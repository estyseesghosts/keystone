# 2026-10-24 — Profile page layout (banner, background, bio/field cards) — agent

Branch: `main` (direct; owner override — the plan says branch, the
owner said main in-session).
Goal: restyle the profile header to the `docs/profilepage.jpg`
structure in the monochrome palette, plus the Misskey-family profile
background URL end to end.

## Did

- Fedi (`packages/fedi`):
  - `core/models.ts`: `Account.backgroundUrl: string | null` next to
    `headerUrl`, per the plan's doc comment.
  - `misskey/wire.ts`: optional `backgroundUrl?: string | null` and
    `background?: {url?: string | null} | null` on `UserDetailed`.
    Only `url` is read; the rest of the DriveFile is ignored.
  - `misskey/adapt.ts`: `backgroundUrlOf` (`backgroundUrl` wins, else
    packed `background.url`, else null — never the banner) wired into
    `adaptAccount`; `adaptMe` inherits via spread. Mapping comment
    updated.
  - `mastodon/adapt.ts`: `backgroundUrl: null` always.
  - Six `Account` literals missing the new required field gained
    `backgroundUrl: null` (typecheck-flagged only).
- App (`src/components/Profile/`):
  - `ProfileAvatar.tsx`: `PROFILE_AVATAR_SIZE` 72 → 88 (banner height
    unchanged; hover card untouched — it does not use this constant).
  - New `profileDetailLayout.ts`: pure
    `none | stack | split | center-bio | center-fields` function.
  - `ProfileHeader.tsx`: root keeps `profile-header` on `palette.bg`;
    decorative absolute-fill `profile-background` (`cover`, hides on
    error, no retry, no label); opaque `ProfileBanner` above it;
    avatar overlap `-44` with actions beside the avatar
    (`flexGrow 0, flexShrink 1`, top-margined past the banner edge);
    centered identity; bio in `profile-bio-card` and each field in its
    own `profile-field-i` (`bgSoft`, `radius.lg`, `space.md` padding);
    desktop (`useShellLayout() !== 'mobile'`) split / half-width
    centering, mobile stack; stats + follow caption unchanged and
    left-aligned. No `overflow: hidden` on the root (avatar overlap).
    `ProfileTabs`, feed, editor, hover cards untouched.
  - `index.ts` exports the layout helper + type.
- Tests:
  - New `profileDetailLayout.test.ts`: all 7 table rows.
  - New `profileLayout.test.tsx` (mobile-390/desktop-1280 holder):
    background absent/present/banner-separation, error-hides-image,
    bio card wrap/omit, per-field cards, stack/split/center-bio/
    center-fields/none. Decorative image needs
    `{includeHiddenElements: true}` in queries.
  - `misskey-adapt.test.ts`: fixture `backgroundUrl` null (no fixture
    packs either shape — none invented), `backgroundUrl` wins,
    packed-file fallback, null/empty shapes → null, Pinetree null.
  - `mastodon-adapt.test.ts`: `backgroundUrl` null.
  - `profile.test.tsx` / `profileFields.test.tsx`: pinned to a mobile
    viewport (established `useViewportWidth` mock pattern); assertions
    otherwise unchanged.

## Decided (→ no ADR)

- No ADR: background lives on `Account.backgroundUrl` exactly as the
  plan decided; no alternative presented itself. Deviation from plan:
  main, not a branch (owner override).
- `hasBio` also treats an empty parse (`bioNodes.length === 0` with
  empty `plain`) as absent, so an empty bio card never renders.
- Fixture files left without background shapes (plan: do not invent);
  new shapes are inline objects in tests.

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean.
- `pnpm lint` clean.
- `pnpm test` → **199 suites / 2551 tests green** (was 197/2530).
- Device/web visual: `not verified` (no browser attached; Misskey
  background not checked against a live server).

## Deviations (files touched outside the slice + why)

- None outside the plan's list. Untracked owner drops (`docs/*`,
  `ios/`) untouched.

## Next

- Owner: visual check on desktop (split) + mobile (stack), and a
  Misskey profile with a background image; push `main`.
