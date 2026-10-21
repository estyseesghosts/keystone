// Screen-supplied callbacks for post actions (slice 4.2). Composer and
// emoji picker live in other slices: screens connect them here (context)
// or per card (PostCard `handlers` prop). Missing callback = the matching
// control renders disabled with a reason, never inert.

import {createContext, useContext} from 'react'

import type {Post} from '@keystone/fedi'

import type {UserActionHandlers} from './menuModel'

export interface PostCardHandlers {
  onReply?: (post: Post) => void
  /** Open the composer quoting `post`. */
  onQuote?: (post: Post) => void
  /** Open the composer editing own `post`. */
  onEdit?: (post: Post) => void
  /**
   * Seam for the emoji picker: open it for `post`; when the user picks,
   * call `pick(key, emojiUrl)` (emojiUrl = custom emoji art or null).
   */
  onPickReaction?: (
    post: Post,
    pick: (key: string, emojiUrl: string | null) => Promise<void>,
  ) => void
  /** Open the clip picker for `post` (add-to-clip flow). */
  onClip?: (post: Post) => void
  /** Viewer language for translation (BCP47 primary subtag). */
  targetLang?: string
  user?: UserActionHandlers
  /** Per-post author handlers (app-wide provider; `user` wins when set). */
  userFor?: (post: Post, sessionId: string) => UserActionHandlers | undefined
}

export const PostCardHandlersContext = createContext<PostCardHandlers>({})

export function usePostCardHandlers(override?: PostCardHandlers): PostCardHandlers {
  const base = useContext(PostCardHandlersContext)
  return override ? {...base, ...override} : base
}
