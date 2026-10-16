# 2026-10-16 — profile card `ref` prop root cause + fix

**Reported reason:** `users/show: no username or user id in profile link;
lookup: Cannot read properties of undefined (reading 'replace')` for
`https://dvd.chat/@jm` — a ref with `rawUrl` but no other fields, which
`parseProfileUrl` cannot produce.

**Root cause (verified in the installed transform, not guessed):**
`<ProfileCardLoader ref={ref} />` — `ref` is compiler-reserved on
components. `babel-plugin-jsx-dom-expressions` wraps non-`const` LVal
`ref` values (a `<For>` callback param here) in a generated `ref(r$)`
method, so `props.ref` arrived as a function: `.rawUrl` undefined (no
throw in a template literal), every field access misses. Same defect in
`BasicChip`'s `ref` prop. DOM-element refs (`sentinel`, AccountCard)
were correct and untouched.

**Fix:** prop renamed `ref` → `profile` on `ProfileCardLoader` and
`BasicChip` + call site; pitfall recorded in `solidjs.md` §7.

## Evidence

- `npx tsc --noEmit` clean; `npm run build` green.
- Transform source read directly (`babel-plugin-jsx-dom-expressions`
  `index.js`, component-props `ref` branch: `!isConstant &&
  isLVal(value)` → `objectMethod("ref", ...)` wrapper).
- **Not yet verified:** the `@jm` post in the owner's browser — expected
  now: full DetailedCard (jm resolves unauthenticated, verified).
