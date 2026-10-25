// Mention / hashtag tap routing for the sole renderer (D3.5 split from
// `RichText.tsx`). Pure handle resolution plus the two navigation
// side-effects (profile route, tag route) and the external-link fallback.
// No hooks, no JSX — `RichText.tsx` re-exports the public names so existing
// callers (`PostCard`, `NotificationRow`, tests) keep importing from
// `#/components/RichText`.

import {Linking} from 'react-native'

import {msg} from '@lingui/macro'

import {acctFromBridgeUrl, isBridgeUrl, parseAcct, safeHttpUrl, safeUrl} from '@keystone/fedi'

import {i18n} from '#/locale/i18n'
import {showToast} from '#/lib/toast'
import {navigationRef} from '#/navigationRef'

/** The vetted target of an outbound open, or null when the raw string is
 * not openable (defence in depth: AST hrefs are vetted at parse, but this
 * helper never trusts its caller). `mailto:` rides only when the caller
 * passes `allowMailto`. Pure. */
export function vettedExternalUrl(
  href: string,
  opts?: {allowMailto?: boolean},
): string | null {
  return opts?.allowMailto ? safeUrl(href) : safeHttpUrl(href)
}

export function openExternal(href: string, opts?: {allowMailto?: boolean}) {
  // One behavior with every other link surface (LinkCard, PostCard menu):
  // a failed open toasts, never swallows — and the toast never echoes the
  // URL (it may carry a token or a private host).
  const vetted = vettedExternalUrl(href, opts)
  if (vetted === null) {
    showToast(i18n._(msg`Could not open this link.`))
    return
  }
  void Linking.openURL(vetted).catch(() => showToast(i18n._(msg`Could not open this link.`)))
}

/** Profile navigation for a mention tap (E2): the `User` screen resolves
 * an `acct` (`user` or `user@host`) through the session backend. Silent
 * no-op in provider-less trees. */
function openMentionProfile(acct: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Main', {screen: 'User', params: {acct}} as never)
}

/** Tag navigation for a hashtag tap (E3): the tag route, never the
 * browser. Silent no-op in provider-less trees. */
function openTagPosts(tag: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Tag', {tag})
}

/** Best-effort account handle from a profile URL (`/@user`,
 * `/users/user` shapes — Mastodon/Misskey/Akkoma profile links).
 * Returns `user@host` (bare hostname, no port) or null. Used when the
 * mention label is not a full `user@host` handle — a bare `@user` label
 * on a remote href, or a display-name label — where the server-provided
 * URL is authoritative and the label is display text. Pure. */
export function acctFromProfileUrl(href: string | null | undefined): string | null {
  if (!href) return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const segments = url.pathname.split('/').filter(s => s.length > 0)
  let username: string | null = null
  if (segments.length >= 2 && segments[0] === 'users') username = segments[1] ?? null
  else if (segments.length >= 1 && segments[0]?.startsWith('@')) username = segments[0].slice(1)
  if (!username || !/^[\w-]+$/.test(username)) return null
  if (!url.hostname) return null
  return `${username}@${url.hostname}`
}

/** Bluesky profile URL → bridged fediverse handle (`bsky.app` only).
 * `https://bsky.app/profile/<handle>` names `<handle>@bsky.brid.gy`,
 * the AP actor Bridgy Fed serves for that Bluesky user — resolvable
 * through either family's `backend.account`, so the mention stays
 * in-app. Bare `bsky.app` links (not mentions) still open externally.
 * Pure. */
export function acctFromBskyAppUrl(href: string | null | undefined): string | null {
  if (!href) return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname !== 'bsky.app') return null
  const segments = url.pathname.split('/').filter(s => s.length > 0)
  if (segments.length !== 2 || segments[0] !== 'profile') return null
  const handle = segments[1] ?? ''
  if (!/^[\w-]+(?:\.[\w-]+)*$/.test(handle)) return null
  return `${handle}@bsky.brid.gy`
}

/** Default mention tap (E2): a full `user@host` label wins outright;
 * otherwise the server-provided profile URL names the account (a bare
 * `@user` label on a remote href, or a display-name label anywhere) —
 * the URL is authoritative, the label is display text. Bluesky profile
 * URLs map to their bridged fediverse actor (`/profile/<handle>` on
 * `bsky.app` → `<handle>@bsky.brid.gy`), and bridge redirect pages
 * (`bsky.brid.gy/r/…`, whose labels Mastodon truncates to `@<handle>`)
 * unwrap to the same actor — bridged mentions stay in-app instead of
 * flattening to a local lookup or opening the browser. A bare label with
 * no URL resolves locally (a bare label on a bridge URL stays put — the
 * href names a remote actor, never a local user); an unresolvable mention
 * with a non-bridge URL
 * leaves the app (plain links still can); an unresolvable mention on a
 * bridge URL stays put — a bridge URL is always an actor identity, never
 * a page to browse. */
export function defaultMentionPress(href: string | null, label: string): void {
  const ref = parseAcct(label)
  if (ref?.host) {
    openMentionProfile(`${ref.username}@${ref.host}`)
    return
  }
  const bridge = acctFromBridgeUrl(href)
  if (bridge) {
    openMentionProfile(bridge)
    return
  }
  const acct = acctFromProfileUrl(href) ?? acctFromBskyAppUrl(href)
  if (acct) {
    openMentionProfile(acct)
    return
  }
  // A bridge href is always a remote actor identity: a bare label must
  // never flatten to a local lookup, and the URL must never open the
  // browser. Unresolvable bridge mentions stay put.
  if (isBridgeUrl(href)) return
  if (ref) {
    openMentionProfile(ref.username)
    return
  }
  if (href) openExternal(href)
}

/** Default hashtag tap (E3): the Tag screen, everywhere. Hashtags never
 * open the browser — a tag is always a known in-app route. */
export function defaultHashtagPress(tag: string): void {
  openTagPosts(tag)
}
