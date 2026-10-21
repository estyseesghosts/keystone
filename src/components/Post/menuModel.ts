// Note-options menu model (slice 4.2). Pure: builds the two-tier menu from
// docs/note-options.md for one post. Every row is a function of capabilities
// plus injected handlers, so UI and tests share one source of truth.
//
// Rule: data-inapplicable rows are omitted (no remote link for a local
// post); unsupported or not-yet-wired rows render disabled WITH a reason.

import type {Capabilities, ServerFamily, Post} from '@keystone/fedi'
import {cachedRemotePostUrl, safeHttpUrl} from '@keystone/fedi'

import type {ActionGate} from '#/state/cache'

export type PostMenuItem = {
  key: string
  label: string
  disabled?: boolean
  reason?: string
  destructive?: boolean
  /** Ask for confirmation first; `run` only fires after "action". */
  confirm?: {title: string; action: string}
  run?: () => void | Promise<void>
  /** Opens tier 2. */
  submenu?: PostMenuSection[]
}

/** Sections are separated by a hairline in the UI. */
export type PostMenuSection = PostMenuItem[]

export interface UserActionHandlers {
  onMute?: () => void | Promise<void>
  onMuteBoosts?: () => void | Promise<void>
  onBlock?: () => void | Promise<void>
  /** Current relation snapshot for label flips (C16): `undefined` means
   * unknown and keeps the default (enable-direction) labels. */
  muted?: boolean
  renoteMuted?: boolean
  blocking?: boolean
}

export interface PostMenuInput {
  family: ServerFamily
  capabilities: Capabilities | null
  /** The post whose menu this is (already the appeared note for reposts). */
  post: Post
  origin: string
  isOwn: boolean
  copyAvailable: boolean
  bookmark: {gate: ActionGate; value: boolean; set: (next: boolean) => Promise<void>}
  del: {gate: ActionGate; run: () => Promise<void>}
  handlers: {
    copy: (text: string) => void | Promise<void>
    share: (url: string, text: string) => void | Promise<void>
    open: (url: string) => void
    translate: () => void | Promise<void>
    muteThread: () => void | Promise<void>
    togglePin: () => void | Promise<void>
    onEdit?: (post: Post) => void
    user?: UserActionHandlers
  }
}

const NO_CLIPBOARD = 'Clipboard is not available on this platform.'
const LATER = (what: string) => `${what} is not available in this build yet.`

/** The local permalink: the server's own `url`, else a family-shaped guess
 * only where the route is known (Misskey `/notes/:id`). Every candidate
 * goes through `safeHttpUrl` — model URLs are server strings, never
 * trusted schemes (F4). */
export function postLink(post: Post, family: ServerFamily, origin: string): string | null {
  const direct = safeHttpUrl(post.url)
  if (direct) return direct
  if (family === 'misskey') return safeHttpUrl(`${origin.replace(/\/$/, '')}/notes/${post.id}`)
  return safeHttpUrl(post.uri)
}

function copyRow(
  input: PostMenuInput,
  key: string,
  label: string,
  text: string,
  emptyReason?: string,
): PostMenuItem {
  if (!input.copyAvailable) return {key, label, disabled: true, reason: NO_CLIPBOARD}
  if (text === '') return {key, label, disabled: true, reason: emptyReason ?? 'Nothing to copy.'}
  return {key, label, run: () => input.handlers.copy(text)}
}

export function buildUserSubmenu(input: PostMenuInput): PostMenuSection[] {
  const {post, handlers} = input
  const author = post.author
  const handle = `@${author.acct}`
  const profileUrl = safeHttpUrl(author.url) ?? safeHttpUrl(author.uri) ?? ''
  const u = handlers.user
  // Relation labels follow the snapshot the provider attached (C16):
  // muted → Unmute, renote-muted → Unmute boosts, blocking → Unblock.
  // Unknown (undefined) keeps the enable-direction default.
  const rel = (key: string, label: string, activeLabel: string, active: boolean | undefined, fn?: () => void | Promise<void>): PostMenuItem =>
    fn
      ? {key, label: active ? activeLabel : label, run: fn, ...(key === 'block' && !active ? {confirm: {title: `Block ${handle}?`, action: 'Block'}} : {})}
      : {key, label, disabled: true, reason: 'Account relations are not connected to this view yet.'}
  const remoteUrl = safeHttpUrl(author.url)
  const remoteUser: PostMenuItem[] =
    author.host !== null && remoteUrl
      ? [{key: 'view-remote-user', label: 'View on remote instance', run: () => handlers.open(remoteUrl)}]
      : []
  return [
    [
      copyRow(input, 'copy-username', 'Copy username', handle),
      copyRow(input, 'copy-profile-url', 'Copy profile URL', profileUrl, 'No profile URL known.'),
      ...remoteUser,
    ],
    [
      {key: 'rss', label: 'Copy RSS', disabled: true, reason: LATER('RSS')},
      {key: 'search-notes', label: "Search this user's notes", disabled: true, reason: LATER('User search')},
    ],
    [
      {key: 'memo', label: 'Edit memo', disabled: true, reason: LATER('Memos')},
      {key: 'add-list', label: 'Add to list', disabled: true, reason: LATER('User lists')},
      {key: 'add-antenna', label: 'Add to antenna', disabled: true, reason: LATER('Antennas')},
      {key: 'notify', label: 'Notify about new posts', disabled: true, reason: LATER('Notifications')},
      {key: 'dm', label: 'Send a message', disabled: true, reason: LATER('Messaging')},
    ],
    [
      rel('mute', 'Mute', 'Unmute', u?.muted, u?.onMute),
      rel('mute-boosts', 'Mute boosts', 'Unmute boosts', u?.renoteMuted, u?.onMuteBoosts),
      rel('block', 'Block', 'Unblock', u?.blocking, u?.onBlock),
      {key: 'refresh-remote', label: 'Refresh remote data', disabled: true, reason: LATER('Refreshing remote data')},
    ],
  ]
}

export function buildPostMenu(input: PostMenuInput): PostMenuSection[] {
  const {post, family, capabilities, handlers, bookmark, del} = input
  const link = postLink(post, family, input.origin)
  const uri = safeHttpUrl(post.uri)
  const caps = capabilities

  const group1: PostMenuItem[] = [
    copyRow(input, 'copy-contents', 'Copy contents', post.content.plain, 'This post has no text.'),
    link
      ? copyRow(input, 'copy-link', 'Copy link', link)
      : {key: 'copy-link', label: 'Copy link', disabled: true, reason: 'This post has no known link.'},
  ]
  // Remote posts open best at their human page (`url`), not the raw AP
  // id (`uri`): the resolver cache holds the warmed page URL, falling
  // back to the raw id until (or when) it resolves (MK17).
  const remote = uri && uri !== link ? (cachedRemotePostUrl(uri) ?? uri) : null
  if (remote) {
    group1.push(
      copyRow(input, 'copy-remote-link', 'Copy remote link', remote),
      {key: 'view-remote', label: 'View on remote instance', run: () => handlers.open(remote)},
    )
  }
  group1.push(
    link
      ? {key: 'share', label: 'Share', run: () => handlers.share(link, post.content.plain)}
      : {key: 'share', label: 'Share', disabled: true, reason: 'This post has no known link.'},
  )

  const translatable = caps?.translation === 'supported'
  const group2: PostMenuItem[] = [
    translatable && post.content.plain !== ''
      ? {key: 'translate', label: 'Translate', run: handlers.translate}
      : {
          key: 'translate',
          label: 'Translate',
          disabled: true,
          reason: translatable ? 'This post has no text.' : 'This server has no translation service.',
        },
    caps
      ? {key: 'mute-thread', label: 'Mute thread', run: handlers.muteThread}
      : {key: 'mute-thread', label: 'Mute thread', disabled: true, reason: 'Sign in to do this.'},
  ]
  const bmLabel = family === 'misskey' ? 'Favorites' : 'Bookmark'
  group2.push(
    bookmark.gate.enabled
      ? {
          key: 'bookmark',
          label: bookmark.value ? `Remove from ${bmLabel.toLowerCase()}` : `Add to ${bmLabel.toLowerCase()}`,
          run: () => bookmark.set(!bookmark.value),
        }
      : {key: 'bookmark', label: `Add to ${bmLabel.toLowerCase()}`, disabled: true, reason: bookmark.gate.reason},
    {key: 'clip', label: 'Clip', disabled: true, reason: LATER('Clips')},
  )

  if (input.isOwn) {
    const edit = caps?.status_editing
    group2.push(
      edit !== 'supported'
        ? {key: 'edit', label: 'Edit', disabled: true, reason: 'This server does not support editing posts.'}
        : handlers.onEdit
          ? {key: 'edit', label: 'Edit', run: () => handlers.onEdit!(post)}
          : {key: 'edit', label: 'Edit', disabled: true, reason: 'No editor is connected to this view.'},
      {key: 'pin', label: post.pinned ? 'Unpin from profile' : 'Pin to profile', run: handlers.togglePin},
    )
  }
  group2.push({key: 'user', label: 'User', submenu: buildUserSubmenu(input)})

  const group3: PostMenuItem[] = [
    {key: 'report', label: 'Report', disabled: true, reason: LATER('Reporting')},
  ]
  if (input.isOwn) {
    group3.push(
      del.gate.enabled
        ? {
            key: 'delete',
            label: 'Delete',
            destructive: true,
            confirm: {title: 'Delete this post?', action: 'Delete'},
            run: del.run,
          }
        : {key: 'delete', label: 'Delete', destructive: true, disabled: true, reason: del.gate.reason},
    )
  }
  return [group1, group2, group3]
}

export function flatten(sections: PostMenuSection[]): PostMenuItem[] {
  return sections.flat()
}
