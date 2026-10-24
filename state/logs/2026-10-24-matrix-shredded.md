# 2026-10-24 — Mastodon-shredded Matrix IDs (live @ctr@mstdn.ca) — agent

Branch: `main` (direct; standing owner instruction).
Goal: owner curl request — Mastodon shoves redirect/hallucinated
mention markup into profile fields; strip it to working mention +
matrix chips.

## What the live account showed

`GET https://mstdn.ca/api/v1/accounts/lookup?acct=ctr@mstdn.ca`
(unauthenticated, recorded 2026-10-24), fields:

- `Meow: Test` — plain, already fine.
- `Meow: <span class="h-card" …><a
  href="https://mastodon.social/@disectamembra" class="u-url
  mention">@<span>disectamembra@mastodon.social</span></a></span>`
  — a REAL mention; already parsed to an in-app chip (pinned).
- `matrix: <span class="h-card" …><a href="https://mstdn.ca/@JM"
  class="u-url mention">@<span>JM</span></a></span>:nope.chat` — the
  user wrote `@JM:nope.chat`; Mastodon's autolinker linked `@JM` as a
  BOGUS mstdn.ca mention (no such account — a Matrix fragment) and
  left `:nope.chat` dangling. Parsed pre-fix as
  `[mention(@JM → mstdn.ca/@JM), text ":nope.chat"]`: a chip
  resolving to a hallucinated local profile plus dead text.

## Did (fedi, pure)

- `core/content/ast.ts`: new exported `mergeMatrixMentions` —
  rejoins a bare local mention + trailing `:server` text into one
  matrix node (hallucinated URL dropped with it). DNS-dot +
  no-space gate (prose `@user: hi`, `@3:30` never merge); recurses
  transparent containers (incl. headings); link/mention/hashtag/code
  labels never rewritten. Same keystrokes mean the same ID on every
  family.
- `core/content/fromMfm.ts`: local copy deleted, shared helper used
  (identical behavior, existing tests green).
- `core/content/fromHtml.ts`: merge applied at the end of
  `contentFromHtml` (covers posts AND fields, which parse through it).
- Tests: live payloads pinned in `content-html.test.ts` (real
  mention stays a mention; shredded Matrix rejoins, URL gone) + a
  ProfileHeader test driving the live `matrix` value through the
  real fields path (matrix chip, no mention chip).

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **199 suites / 2602 tests green**.
- Live rendering against the account in-app: `not verified`
  (parsers pinned on the recorded markup instead).

## Next

- Owner in-app check on the live profile; push `main`.
