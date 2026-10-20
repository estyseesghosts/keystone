import type {Backend, Capabilities, ServerFamily} from '@keystone/fedi'

// Capability gates for write actions (slice 4.1). An unsupported action is
// hidden or shown disabled WITH the reason; the controller refuses to run
// it and never flips any optimistic state for it.

export type PostActionKind = 'reaction' | 'favourite' | 'renote' | 'bookmark' | 'delete'

export type ActionGate =
  | {enabled: true}
  | {enabled: false; reason: string; reasonCode: string}

const off = (reasonCode: string, reason: string): ActionGate => ({enabled: false, reason, reasonCode})

export interface GateInput {
  capabilities: Capabilities | null | undefined
  /** Needed for `bookmark` (the optional sub-module) and as a presence check. */
  backend?: Pick<Backend, 'bookmarks'> | null
  /** Needed for `delete`: the viewer authored the post. */
  isOwn?: boolean
}

export function gateAction(kind: PostActionKind, input: GateInput): ActionGate {
  const caps = input.capabilities
  if (!caps) return off('gate.noSession', 'Sign in to do this.')
  switch (kind) {
    case 'reaction':
      return caps.reactions === 'supported'
        ? {enabled: true}
        : off('gate.noReactions', 'This server does not support emoji reactions.')
    case 'favourite':
      return caps.favourites_distinct_from_reactions === 'supported'
        ? {enabled: true}
        : off('gate.noFavourites', 'This server has no separate favourites.')
    case 'bookmark':
      if (caps.bookmarks !== 'supported' || !input.backend?.bookmarks) {
        return off('gate.noBookmarks', 'This server does not support bookmarks.')
      }
      return {enabled: true}
    case 'renote':
      // No capability flag exists: both families repost. Needs a session only.
      return {enabled: true}
    case 'delete':
      return input.isOwn ? {enabled: true} : off('gate.notYours', 'You can only delete your own posts.')
  }
}

/**
 * Which toggle the plain "like" button drives. Misskey family: a reaction.
 * Mastodon family: the favourite, or (Akkoma without favourites) a reaction.
 * Null = no like control at all (hide it).
 */
export function likeKind(
  family: ServerFamily,
  capabilities: Capabilities | null | undefined,
): 'reaction' | 'favourite' | null {
  if (!capabilities) return null
  const canReact = capabilities.reactions === 'supported'
  const canFav = capabilities.favourites_distinct_from_reactions === 'supported'
  if (family === 'misskey') return canReact ? 'reaction' : null
  if (canFav) return 'favourite'
  return canReact ? 'reaction' : null
}
