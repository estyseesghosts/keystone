# 2026-10-20 — Butterfly feed slice (post card + composer entry) — agent

Branch: `p3.1-signin-functional`
Goal: post cards and composer entry laid out exactly like Keystone v1,
proven against signed-in v1 in Helium.

## Did

- Drove signed-in v1 in Helium (external Akkoma login as `akk1` test
  account — documented rig creds; no personal account touched) and an
  isolated headless Helium profile (port 9223, separate user-data-dir) as
  the v2 comparison seat, so the owner's session was never disturbed.
- Time: `formatRelativeTime` now v1 `time.ts` behavior (narrow relative
  + locale date, invalid echoes) + `time.test.ts`.
- Action bar rewritten to v1: inline muted 13px icon+count buttons (reply,
  boost, heart/custom-like, smile, ⋯ pinned right), active-inverted,
  capability-gated with reasons, static spans when signed out
  (`StaticActionBar`). `Menu` + `PostMenu` gained `trigger` props (dialog
  backend stays; anchored popups are the popup slice).
- PostCard: header (bold clipped name + muted handle/time, 220px clip),
  40px avatar + 1px border, counts line deleted, CW box v1 bordered.
- ReactionChips: v1 pill padding + bg-soft, mine-inverted.
- PostMediaGrid: single fit-width (maxH 320, radius 6, border, measured
  aspect) / 2+ horizontal strip (220px items); sensitive gate kept.
- Home: inline Composer on top when signed in (v1 parity); `onClose`
  optional (Cancel hidden inline — no inert control).
- Compose route: floating overlay (v1 `.postbox-overlay`) — dimmed
  `position:fixed` backdrop over the whole viewport incl. sidebar,
  centered 600px radius-16 card desktop, full-bleed mobile; stack option
  `transparentModal`; strip hides under Compose on mobile.
- Fixed live-found bug: stack Login/AuthCallback `navigate('Home')`
  resolves nowhere — both `reset` to Main now.

## Decided (-> DECISIONS)

- Helium verdict: yes, controllable (CDP 9222 + isolated 9223).
- Compact inline composer + composer icon-toolbar chrome deferred to
  the composer slice (inline currently renders the full form).
- Anchored popups deferred (dialogs stay until the popup slice).

## Tests / verification

- `pnpm typecheck` (×3) green; `pnpm lint` exit 0.
- `pnpm test`: **62 suites / 841 tests pass** (new: time + icon tests;
  updated: post/postactions expectations to v1 behavior).
- Failures fixed mid-session: time import path; ICU narrow-hour variance
  ("22h" vs "22 hrs" — test pins engine's own rendering in device
  locale); `useNavigationState` above container (container callbacks);
  `absoluteFillObject` typo; `onClose?` optional chaining.
- Helium proofs (viewed): v2-Akkoma home vs v1-Akkoma home side by
  side (structure now mirrors: header line, action row, ⋯ right);
  overlay desktop (dim + centered card) + mobile (full-bleed, no strip);
  rail/mobile/light from the shell session still hold.
- v1 reference served at `:5199` (`vite --port 5199`, default Pinetree
  proxy); signed in via external Akkoma flow. Left running for later.

## Deviations / follow-ups

- Signed-in v1 pixels compared, not v1-signed-in Misskey (no working
  creds; approval-as-owner refused — owner can sign v1 into dvd.chat
  and I will re-shoot).
- Composer modal internals still v2-styled (toolbar, no avatar row).
- No `packages/fedi` changes. Icons test + time test added.
- `scripts/helium.mjs` gained `CDP_PORT` env.

## Next

- Feed chrome slice: separators, thread connectors, empty/loading/error
  states, skeletons, "N new posts" pill decision, grammar ("1 boosts").
- Popup slice: anchored menus (account, note, repost, visibility,
  emoji picker chrome).
- Composer slice: v1 toolbar + compact inline.
- Then: notifications, explore, settings pages (surveyed this session:
  9 settings subpages, explore tabs/search/autocomplete, feed prefs
  incl. showLocal/showFederated rule).

## Bluesky reference paths consulted

- None (v1 `frontend/src` carried the patterns; ADR-0001).
- v1 paths read: `routes/Settings.tsx` (full), `routes/Explore.tsx`
  (full), `components/TranslatableText.tsx` (translate affordance).
