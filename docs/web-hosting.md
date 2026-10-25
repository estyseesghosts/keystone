# Web hosting requirements (X2.3, security L1 / owner decision D2)

The web build is **not release-ready**. It stores every session bearer
token in `localStorage`-backed storage (`src/storage/tokens.web.ts`,
"dev-grade" by design: web has no OS keychain). Any cross-site scripting
(XSS) vulnerability exfiltrates all of the reader's account tokens, and
the persisted query cache alongside them. Do not ship the web build to
users until the token store moves to an `httpOnly`-proxied session (or
equivalent) — that move is out of scope for this repair program.

Until then, any hosted web deployment MUST serve these response headers
(they bound what a token-stealing payload can do; they do not fix the
storage itself):

- `Content-Security-Policy` — strict, with **no `unsafe-inline`** and
  **no `unsafe-eval`**. Example starting point (tighten `connect-src`
  to the instances you serve):
  `default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data: https:; media-src 'self' https:;
  connect-src 'self' https: wss:; frame-ancestors 'none';
  base-uri 'self'; form-action 'self'`.
- `frame-ancestors 'none'` (or `X-Frame-Options: DENY`) — the app must
  never render inside another origin's frame (clickjacking a sign-in or
  approval page turns into token theft here).
- `Referrer-Policy: no-referrer` — callback URLs carry one-time
  `code`/`state`/`session` values; they must never leak in a `Referer`
  header to third-party media, emoji, or preview hosts.
- `X-Content-Type-Options: nosniff` — never let the browser sniff a
  Drive attachment or preview response into an executable type.

Operational notes:

- Same-tab OAuth/MiAuth navigation unloads the page, so the one-time
  callback params never persist in history — the app additionally strips
  them from the address bar on consumption (`callbackCleanHref`).
- Link previews and remote-post resolution fetch third-party hosts from
  the reader's IP; the outbound policy (`isPublicHttpsUrl`) keeps those
  fetches off private networks, but the destination still sees the
  reader. Treat preview URLs as reader-identifying.
- Native builds are unaffected by this page: tokens live in the OS
  vault (ADR 0011), and cleartext/backup policy is enforced in
  `app.config.js` + `plugins/withAndroidHardening.js`.
