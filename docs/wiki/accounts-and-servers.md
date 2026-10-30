# Accounts and servers

## Servers in plain terms

You cannot use Keystone without an account on some server. Pick the server first, then sign in.

- **Misskey** is one type of fediverse server software. It has reactions (emoji responses), antennas, clips, channels, and Drive file storage. Compatible forks speak the same API — the app treats them as Misskey.
- **Mastodon** is the best-known server software. It has boosts (reposts), favourites (likes), lists, filters, and direct-message conversations.
- **Akkoma and Pleroma** speak the Mastodon protocol. The app treats them as Mastodon family.

## One session per account

Each login creates one **session**. A session is just the app's memory of one signed-in account: which server, which user, and which token.

- You can add several sessions (several accounts, possibly on different servers).
- Only one session is active at a time.
- Switching sessions switches everything: timelines, notifications, drafts.

## Tokens stay with their server

A **token** is a secret password the server gives the app so it does not have to ask for your real password every time.

Rule: a token is only ever sent to the server that issued it. The app stores tokens per server address ("per origin"). A request built for account A never carries account B's token. This is enforced by automated tests.

## How sign-in works

The app first checks what kind of server you typed in. Then it picks a method:

- **Misskey family:** browser sign-in. The app opens your server's approval page. You approve there. The app never sees your password.
- **Mastodon family:** two options. Browser sign-in (approve on the server's page), or typing your username and password directly into the app on some servers.
- **Two-factor codes:** if your account needs one, the app asks for it after the password step.

You land on the Home tab after sign-in.

## "This server" vs "Another server"

On a hosted install, the sign-in screen can show two tabs:

- **This server.** The server the app install belongs to. Just type username and password.
- **Another server.** Any other server address. The app detects its type first, then signs you in.

On a plain install with no home server, you only get the server-address form.

## Signing out

Sign-out asks the server to cancel the token, then always deletes local data for that session. Other sessions stay signed in.
