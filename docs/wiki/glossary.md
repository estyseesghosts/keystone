# Glossary

One-sentence definitions, grounded in how this repo uses each word.

- **Session.** One signed-in account in the app: server address, user, and token together. See `src/state/session/`.
- **FeedDescriptor.** A short text label that names one feed, like a home timeline or a tag search. The app reads feeds by label instead of hard-coding each one. Defined in `packages/fedi`.
- **Deck column.** One panel showing one feed for one account. A deck is several columns side by side.
- **Capabilities.** The list of things one server can actually do (password sign-in, reactions, clips, and so on). The app checks this list before showing each button.
- **MFM.** Misskey Flavored Markdown. The rich-text format Misskey family servers use for posts: emoji codes, mentions, and formatting in one text.
- **MMKV.** Fast on-device storage the app uses for settings and cached data. Think of it as a small local database on your phone.
- **TanStack Query.** The library that fetches server data, caches it, and refreshes it. Every cached request is tagged with the active account so accounts never mix.
- **Origin.** A server's address (for example `https://example.social`). Tokens are stored per origin and never sent anywhere else.
- **MiAuth.** The Misskey way of signing in through the browser: approve on your server's page, the app gets a token. The app never sees your password.
- **OAuth.** The Mastodon way of signing in through the browser. Same idea as MiAuth: approve on the server, the app gets a token.
- **Antenna.** A saved search on Misskey family servers that collects matching new posts for you automatically.
- **Clip.** A saved collection of posts on Misskey family servers.
- **Boost / favourite.** Mastodon words for repost and like.
- **Streaming.** A live connection where the server pushes new posts as they arrive. When it is off, the app shows a badge and you refresh by hand.
- **Fixture.** A saved copy of a real server reply, stored in `packages/fedi/test/fixtures/` so tests can run without a live server.
