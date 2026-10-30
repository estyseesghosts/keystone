# Streaming

Feeds never depend on a socket: paging + manual refresh always work, and
streaming is an enhancement with a `pending → subscribed → unavailable`
lifecycle. When no handle exists (or the channel is unsupported), the app
falls back to paging plus a local diff — never a stuck badge or faked
inserts.

## Misskey family: channels over `/streaming`

One pooled `WebSocket` per session origin (`misskey/stream.ts:206`), token
as `?i=` on the same origin only. Native WebSocket, no extra dependencies.

Client → server frames:

- `connect {channel, id, params?, pong: true}`, `disconnect {id}`
- `subNote {id}` / `unsubNote {id}` — per-note capture, refcounted
  (`misskey/stream.ts:746`); broadcast `noteUpdated {id, type:
reacted|unreacted|deleted|pollVoted, body}` arrives only for captured
  notes and is always reconciled by re-reading the note, never rendered
  optimistically

Server → client frames: `connected {id}` (ack, only because `pong: true`
was sent), `channel {id, type, body}`.

Channels (`misskey/stream.ts:879`):

| Feed source     | Channel                                    | Auth                                           |
| --------------- | ------------------------------------------ | ---------------------------------------------- |
| `home`          | `homeTimeline`                             | Credential with `read:account` required        |
| `local`         | `localTimeline`                            | Public                                         |
| `social`        | `hybridTimeline`                           | Credential required                            |
| `global`        | `globalTimeline`                           | Public                                         |
| `antenna\|<id>` | `antenna` + `antennaId`                    | Credential required                            |
| `list\|<id>`    | `userList` + `listId`                      | Credential required                            |
| `channel\|<id>` | `channel` + `channelId`                    | Public (server filters by note `channelId`)    |
| `tag\|<tag>`    | `hashtag` + `tag`                          | Public                                         |
| Note capture    | `main` + `subNote`                         | Credential required                            |
| Chat room / 1:1 | `chatRoom {roomId}` / `chatUser {otherId}` | Credential required (`misskey/stream.ts:1014`) |

A channel the server will not serve is silently ignored (no ack, socket
stays open) — a missing `connected` ack after 10s reads as "live updates
unavailable". Reconnect uses capped exponential backoff (1s → 30s +
jitter); after 5 consecutive opens-closed-within-2s the client stops
retrying and surfaces an explicit error with a retry button. The server
pings every 60s and drops connections idle past ~2min; every subscribe is
re-sent on reconnect.

## Mastodon family: WebSocket over `/api/v1/streaming`

WebSocket only — there is no SSE path in the code, even though servers
offer one. The socket dials the advertised streaming origin
(`configuration.urls.streaming` on v2, `urls.streaming_api` on v1),
falling back to the session origin's `ws(s)` mapping; the advertisement
is validated (same host, subdomain, or sibling under a shared parent with
matching scheme) and foreign/IP-literal/userinfo URLs are refused with the
REST origin dialed instead (`mastodon/instance.ts`, `mastodon/stream.ts`).

The URL never carries a token: auth rides the `Sec-WebSocket-Protocol:
Bearer, <token>` pair (`mastodon/stream.ts:260`). One pooled socket per
`(stream, params)` key, created lazily on first subscribe
(`mastodon/stream.ts:239`).

Streams (`mastodon/stream.ts:183`):

| Feed source      | Stream               | Notes                                                            |
| ---------------- | -------------------- | ---------------------------------------------------------------- |
| `home`           | `user`               | Post updates ride the shared `user` stream, id-filtered per post |
| `local`          | `public:local`       |                                                                  |
| `global`         | `public`             |                                                                  |
| `list\|<id>`     | `list` + `list`      |                                                                  |
| `tag\|<tag>`     | `hashtag` + `tag`    |                                                                  |
| `social`         | —                    | No mapping; paging-only by design (`mastodon/stream.ts:183`)     |
| Per-post capture | shared `user` stream | Feed-level deletes stay unsubscribed by interface design         |

Wire: text frames `{event, payload}` with double-encoded payload —
`update`/`status.update` (Status), `delete` (bare id string),
`notification`, `conversation`, `filters_changed`; unknown events ignored.
Akkoma's bare text `ping` is answered with `pong`; `kill` closes for good
(no reconnect). Reconnect is bounded: 10s open/`connected` ack watchdog
(`CONNECT_ACK_TIMEOUT_MS`) plus a breaker after 5 fast closes that marks
the entry `stopped` with a manual retry — never a forever-"Reconnecting".

## Unsupported

- Misskey clones without a `/streaming` route — `stream()` returns null and everything
  is paging-only.
- External (third-party) Misskey sessions: the external token never opens
  a local socket.
- Environments without a `WebSocket` implementation: handle is null,
  polling fallback.

## Coverage

| Area                                                      | Status                               | Evidence                                                       |
| --------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Misskey channels + note capture + chat channels           | Supported                            | `misskey/stream.ts`; mock-WS note-event stream test            |
| Mastodon WS streams + subprotocol auth + watchdog/breaker | Supported                            | `mastodon/stream.ts`; WS stream test                           |
| Advertised-origin validation                              | Supported                            | `mastodon/stream.ts:107`, `instance.ts` streaming-origin logic |
| SSE transport                                             | Unsupported (deliberate)             | No SSE code anywhere; WS covers both families                  |
| Servers without a streaming route / no-WS runtimes        | Unsupported (honest paging fallback) | Null handle / null stream mapping                              |

Gaps: none in transport — notification-prepend semantics (all-listings
only, filtered views invalidate) live in the app layer, not here.

## Sources

- `packages/fedi/src/misskey/stream.ts:29` (frame shapes), `:140` (backoff base), `:206` (`createStreamPool`), `:746` (note capture), `:879` (channel map), `:930` (`createStreamHandle`), `:1014` (chat channels)
- `packages/fedi/src/mastodon/stream.ts:1` (protocol + bounded reconnect), `:107` (origin validation), `:156` (backoff), `:162` (ack timeout), `:168` (fast-close breaker), `:183` (stream names), `:239` (`createStreamHandle`)
- `packages/fedi/src/mastodon/instance.ts` (streaming-origin resolution)
