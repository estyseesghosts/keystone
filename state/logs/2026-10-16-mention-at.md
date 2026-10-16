# 2026-10-16 — double-@ mentions fix

**Report:** mentions render as `@@user` everywhere.

**Cause:** mfm-js packs the leading `@` into the mention node's `acct`
(`"@user@host"` — verified via `parse`), and `MentionLink` prepended
another one (`@{props.acct}`). Hashtags unaffected (`hashtag` prop has no
`#`); `handleOf` builds its own single `@` from raw parts — also fine.

## What changed

- `frontend/src/components/MfmRenderer.tsx`: render `acct` verbatim in
  both the linked and fallback branches (+ comment noting the packed `@`).

## Evidence

- `node -e parse(...)` confirmed `acct: "@someone@example.com"`.
- `npx tsc --noEmit` clean; `npm run build` green; no other `@{acct}`
  occurrences in `src/`.
- **Not yet verified:** visual single-@ in a real browser (owner rig).
