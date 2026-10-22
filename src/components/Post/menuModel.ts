// Note-options menu model (slice 4.2). Pure: builds the two-tier menu from
// docs/note-options.md for one post. Every row is a function of capabilities
// plus injected handlers, so UI and tests share one source of truth.
//
// Rule: data-inapplicable rows are omitted (no remote link for a local
// post); unsupported or not-yet-wired rows render disabled WITH a reason.

import {t} from '@lingui/macro'

// Locale boot (P5): this pure module evaluates `t` at call time against
// the shared singleton, which needs an activated locale. Importing the
// app locale module guarantees the boot (en fallback) runs first —
// without it, bare importers (unit tests) hit Lingui's no-locale error.
import '#/locale/i18n'

import type {Capabilities, ReportCategory, ServerFamily, ServerFlavor, Post} from '@keystone/fedi'
import {cachedRemotePostUrl, REDRAFT_WARNING, safeHttpUrl} from '@keystone/fedi'

import type {ActionGate} from '#/state/cache'
import {messagingUnavailableReason} from '#/lib/messaging'

export type PostMenuItem = {
  key: string
  label: string
  disabled?: boolean
  reason?: string
  destructive?: boolean
  /** Ask for confirmation first. Without a confirm `run`, the item's
   * `run` only fires after "action". */
  confirm?: {
    title: string
    action: string
    /** Extra explanatory line under the title (e.g. the data-loss warning
     * on delete-and-redraft). */
    message?: string
    /** When set, the dialog shows a required text field with this label. */
    commentLabel?: string
    run?: (comment?: string) => void | Promise<void>
  }
  run?: () => void | Promise<void>
  /** Opens the report chooser (category / optional rules / forward /
   * optional comment) instead of a bare confirm dialog. */
  report?: ReportMenuItem
  /** Opens tier 2. */
  submenu?: PostMenuSection[]
}

/** Sections are separated by a hairline in the UI. */
export type PostMenuSection = PostMenuItem[]

/** What the report chooser (clickstone §1.5) collects. `statusIds` is not
 * here: the reporter acts on ONE post and the screen that owns the backend
 * adds that post's id — the chooser never invents a status selection. */
export interface ReportChooserValues {
  comment: string
  category: ReportCategory
  ruleIds: string[]
  forward: boolean
}

/** The chooser branch of a menu item. Kept separate from `confirm` so the
 * existing confirm dialogs (delete/block) are untouched. */
export interface ReportMenuItem {
  title: string
  action: string
  /** Family whose report API this is (category/rules/forward only exist on
   * the Mastodon family). */
  family: ServerFamily
  /** The reported account's home server; null for a local account (no
   * forwarding toggle). */
  remoteHost: string | null
  run: (values: ReportChooserValues) => void | Promise<void>
}

export interface UserActionHandlers {
  onMute?: () => void | Promise<void>
  onMuteBoosts?: () => void | Promise<void>
  onBlock?: () => void | Promise<void>
  /** Report the author through the chooser (both families implement
   * `Backend.reportAccount`; the screen adds the reported post's id and the
   * backend states which fields it could not send). */
  onReport?: (values: ReportChooserValues) => void | Promise<void>
  /** Current relation snapshot for label flips (C16): `undefined` means
   * unknown and keeps the default (enable-direction) labels. */
  muted?: boolean
  renoteMuted?: boolean
  blocking?: boolean
  /** Open a message conversation for the author. The row is gated on
   * `direct_messages` first (P6.2); the opener navigates to the inbox. */
  onMessage?: (post: Post) => void | Promise<void>
}

export interface PostMenuInput {
  family: ServerFamily
  /** Detected flavor, when the session reported one — drives the per-flavor
   * DM unavailable reason (P6.2). Absent keeps the generic client-gap
   * sentence, never a server claim. */
  flavor?: ServerFlavor | null
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
    /** Delete the post, then open the composer seeded with its payload
     * (clickstone §1.7). The handler owns the delete; the row only confirms
     * first and shows the data-loss warning. */
    onRedraft?: (post: Post) => void | Promise<void>
    onClip?: (post: Post) => void
    user?: UserActionHandlers
  }
}

/** Clip row (v1 `NoteMenu` parity): expands to the add-to-clip flow when
 * the server supports clips and a picker is connected; otherwise an
 * honest disabled row with the reason. */
function clipRow(input: PostMenuInput): PostMenuItem {
  const {post, capabilities, handlers} = input
  if (capabilities?.clips !== 'supported') {
    return {key: 'clip', label: t`Add to clip`, disabled: true, reason: t`This server has no clips.`}
  }
  if (!handlers.onClip) {
    return {key: 'clip', label: t`Add to clip`, disabled: true, reason: t`No clip picker is connected to this view.`}
  }
  return {key: 'clip', label: t`Add to clip`, run: () => handlers.onClip!(post)}
}

const NO_CLIPBOARD = t`Clipboard is not available on this platform.`
const LATER = (what: string) => t`${what} is not available in this build yet.`

/** DM row (P6.2): enabled only when `direct_messages` is supported AND a
 * message opener is connected. Otherwise disabled WITH a reason — the row
 * never disappears. The reason is per-flavor: the missing inbox on
 * akkoma/pleroma without conversation support, no chat on pinetree, the
 * unverified client gap on catodon/unknown, the generic client gap
 * everywhere else (misskey/sharkey past the gate never reach it). */
function dmRow(input: PostMenuInput): PostMenuItem {
  const {post, capabilities, handlers} = input
  const onMessage = handlers.user?.onMessage
  if (capabilities?.direct_messages !== 'supported') {
    return {
      key: 'dm',
      label: t`Send a message`,
      disabled: true,
      reason: messagingUnavailableReason({family: input.family, flavor: input.flavor ?? null}),
    }
  }
  if (!onMessage) {
    return {
      key: 'dm',
      label: t`Send a message`,
      disabled: true,
      reason: t`No message composer is connected to this view yet.`,
    }
  }
  return {key: 'dm', label: t`Send a message`, run: () => onMessage(post)}
}

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
  if (text === '') return {key, label, disabled: true, reason: emptyReason ?? t`Nothing to copy.`}
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
      ? {key, label: active ? activeLabel : label, run: fn, ...(key === 'block' && !active ? {confirm: {title: t`Block ${handle}?`, action: t`Block`}} : {})}
      : {key, label, disabled: true, reason: t`Account relations are not connected to this view yet.`}
  const remoteUrl = safeHttpUrl(author.url)
  const remoteUser: PostMenuItem[] =
    author.host !== null && remoteUrl
      ? [{key: 'view-remote-user', label: t`View on remote instance`, run: () => handlers.open(remoteUrl)}]
      : []
  return [
    [
      copyRow(input, 'copy-username', t`Copy username`, handle),
      copyRow(input, 'copy-profile-url', t`Copy profile URL`, profileUrl, t`No profile URL known.`),
      ...remoteUser,
    ],
    [
      {key: 'rss', label: t`Copy RSS`, disabled: true, reason: LATER('RSS')},
      {key: 'search-notes', label: t`Search this user's notes`, disabled: true, reason: LATER('User search')},
    ],
    [
      {key: 'memo', label: t`Edit memo`, disabled: true, reason: LATER('Memos')},
      {key: 'add-list', label: t`Add to list`, disabled: true, reason: LATER('User lists')},
      {key: 'add-antenna', label: t`Add to antenna`, disabled: true, reason: LATER('Antennas')},
      {key: 'notify', label: t`Notify about new posts`, disabled: true, reason: LATER('Notifications')},
      dmRow(input),
    ],
    [
      rel('mute', t`Mute`, t`Unmute`, u?.muted, u?.onMute),
      rel('mute-boosts', t`Mute boosts`, t`Unmute boosts`, u?.renoteMuted, u?.onMuteBoosts),
      rel('block', t`Block`, t`Unblock`, u?.blocking, u?.onBlock),
      {key: 'refresh-remote', label: t`Refresh remote data`, disabled: true, reason: LATER('Refreshing remote data')},
    ],
  ]
}

/** Report row (v1 `NoteMenu` parity, clickstone §1.5): hidden for own
 * posts (a viewer never reports themselves), disabled with a reason when
 * signed out or when no reporter is connected, otherwise the chooser —
 * category, the server's rules when it publishes them, forwarding for a
 * remote account, and an optional comment (Misskey still needs the reason
 * text). */
function reportRow(input: PostMenuInput): PostMenuItem[] {
  if (input.isOwn) return []
  const onReport = input.handlers.user?.onReport
  if (!input.capabilities) {
    return [{key: 'report', label: t`Report`, disabled: true, reason: t`Sign in to do this.`}]
  }
  if (!onReport) {
    return [
      {
        key: 'report',
        label: t`Report`,
        disabled: true,
        reason: t`Account actions are not connected to this view yet.`,
      },
    ]
  }
  const handle = `@${input.post.author.acct}`
  return [
    {
      key: 'report',
      label: t`Report`,
      report: {
        title: t`Report ${handle}`,
        action: t`Send report`,
        family: input.family,
        remoteHost: input.post.author.host,
        run: onReport,
      },
    },
  ]
}

export function buildPostMenu(input: PostMenuInput): PostMenuSection[] {
  const {post, family, capabilities, handlers, bookmark, del} = input
  const link = postLink(post, family, input.origin)
  const uri = safeHttpUrl(post.uri)
  const caps = capabilities

  const group1: PostMenuItem[] = [
    copyRow(input, 'copy-contents', t`Copy contents`, post.content.plain, t`This post has no text.`),
    link
      ? copyRow(input, 'copy-link', t`Copy link`, link)
      : {key: 'copy-link', label: t`Copy link`, disabled: true, reason: t`This post has no known link.`},
  ]
  // Remote posts open best at their human page (`url`), not the raw AP
  // id (`uri`): the resolver cache holds the warmed page URL, falling
  // back to the raw id until (or when) it resolves (MK17).
  const remote = uri && uri !== link ? (cachedRemotePostUrl(uri) ?? uri) : null
  if (remote) {
    group1.push(
      copyRow(input, 'copy-remote-link', t`Copy remote link`, remote),
      {key: 'view-remote', label: t`View on remote instance`, run: () => handlers.open(remote)},
    )
  }
  group1.push(
    link
      ? {key: 'share', label: t`Share`, run: () => handlers.share(link, post.content.plain)}
      : {key: 'share', label: t`Share`, disabled: true, reason: t`This post has no known link.`},
  )

  const translatable = caps?.translation === 'supported'
  const group2: PostMenuItem[] = [
    translatable && post.content.plain !== ''
      ? {key: 'translate', label: t`Translate`, run: handlers.translate}
      : {
          key: 'translate',
          label: t`Translate`,
          disabled: true,
          // `unknown` means this session predates the translation probe
          // (detection stores the flag at login) — the server was never
          // asked, so say that instead of blaming the server.
          reason: translatable
            ? t`This post has no text.`
            : caps?.translation === 'unknown'
              ? t`Sign in again to refresh server features.`
              : t`This server has no translation service.`,
        },
    caps
      ? {key: 'mute-thread', label: t`Mute thread`, run: handlers.muteThread}
      : {key: 'mute-thread', label: t`Mute thread`, disabled: true, reason: t`Sign in to do this.`},
  ]
  const bmLabel = family === 'misskey' ? t`Favorites` : t`Bookmark`
  group2.push(
    bookmark.gate.enabled
      ? {
          key: 'bookmark',
          label: bookmark.value ? t`Remove from ${bmLabel.toLowerCase()}` : t`Add to ${bmLabel.toLowerCase()}`,
          run: () => bookmark.set(!bookmark.value),
        }
      : {key: 'bookmark', label: t`Add to ${bmLabel.toLowerCase()}`, disabled: true, reason: bookmark.gate.reason},
    clipRow(input),
  )

  if (input.isOwn) {
    const edit = caps?.status_editing
    group2.push(
      edit !== 'supported'
        ? {key: 'edit', label: t`Edit`, disabled: true, reason: t`This server does not support editing posts.`}
        : handlers.onEdit
          ? {key: 'edit', label: t`Edit`, run: () => handlers.onEdit!(post)}
          : {key: 'edit', label: t`Edit`, disabled: true, reason: t`No editor is connected to this view.`},
      {key: 'pin', label: post.pinned ? t`Unpin from profile` : t`Pin to profile`, run: handlers.togglePin},
    )
  }
  group2.push({key: 'user', label: t`User`, submenu: buildUserSubmenu(input)})

  const group3: PostMenuItem[] = reportRow(input)
  if (input.isOwn) {
    // Delete-and-redraft (clickstone §1.7): the only redraft path on a
    // server without `status_editing` (upstream Misskey) and the explicit
    // "start over" path everywhere else. Delete stays its own row: this one
    // reopens the composer, so the destructive warning must say so.
    group3.push(
      del.gate.enabled
        ? handlers.onRedraft
          ? {
              key: 'redraft',
              label: t`Delete and redraft`,
              destructive: true,
              confirm: {
                title: t`Delete and redraft this post?`,
                action: t`Delete and redraft`,
                message: REDRAFT_WARNING,
              },
              run: () => handlers.onRedraft!(post),
            }
          : {
              key: 'redraft',
              label: t`Delete and redraft`,
              disabled: true,
              reason: t`No composer is connected to this view.`,
            }
        : {key: 'redraft', label: t`Delete and redraft`, disabled: true, reason: del.gate.reason},
    )
    group3.push(
      del.gate.enabled
        ? {
            key: 'delete',
            label: t`Delete`,
            destructive: true,
            confirm: {title: t`Delete this post?`, action: t`Delete`},
            run: del.run,
          }
        : {key: 'delete', label: t`Delete`, destructive: true, disabled: true, reason: del.gate.reason},
    )
  }
  return [group1, group2, group3]
}

export function flatten(sections: PostMenuSection[]): PostMenuItem[] {
  return sections.flat()
}
