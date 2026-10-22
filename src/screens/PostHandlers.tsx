import {useCallback, useContext, useMemo} from 'react'
import {useNavigation, type NavigationProp} from '@react-navigation/native'
import {QueryClientContext, useQueryClient} from '@tanstack/react-query'

import {backendForSession, type Post} from '@keystone/fedi'

import {
  PostCardHandlersContext,
  type PostCardHandlers,
} from '#/components/Post/handlers'
import type {ReportChooserValues} from '#/components/Post/menuModel'
import {toastError} from '#/components/Post/ActionBar'
import {showToast} from '#/lib/toast'
import type {RootParamList} from '#/routes'
import {graphControllerFor, relationshipQueryKey} from '#/state/queries'
import {useOptionalSessionStore, useSessionStore} from '#/state/session/SessionProvider'

// App-wide PostCard handlers (slice 4.6): reply/quote/edit -> Compose route,
// mute/block through the graph controller. Reaction picking lives in the
// action bar's anchored emoji popup, not here.

export function PostHandlersProvider({children}: {children: React.ReactNode}) {
  // Bare navigation trees (tests) have no session/query providers: no handlers.
  const store = useOptionalSessionStore()
  const qc = useContext(QueryClientContext)
  if (!store || !qc) return <>{children}</>
  return <LiveHandlersProvider>{children}</LiveHandlersProvider>
}

function LiveHandlersProvider({children}: {children: React.ReactNode}) {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  const qc = useQueryClient()
  const store = useSessionStore()

  const userFor = useCallback(
    (post: Post, sessionId: string) => {
      const s = store.getSnapshot().sessions.find(x => x.id === sessionId)
      if (!s || s.accountId === post.author.id) return undefined
      const run = (fn: () => Promise<void>, done: string) => async () => {
        try {
          await fn()
          showToast(done)
        } catch (e) {
          toastError(e)
        }
      }
      const controller = graphControllerFor(qc)
      const backend = backendForSession(s)
      // Relation snapshot for menu label flips (C16): whatever the cache
      // holds (possibly nothing — labels then keep defaults). Mute/block
      // toggles go through the controller where it owns the queue (it
      // invalidates the relationship query on settle); boost visibility
      // has no queue owner, so the toggle below re-reads `relationships`
      // itself and writes the cache, keeping the undo labels honest.
      const known = controller.relationship(sessionId, post.author.id)
      const renoteMuted = known?.isRenoteMuted
      const resync = async () => {
        try {
          const rows = await backend.relationships([post.author.id])
          const rel = rows[0]
          if (rel) qc.setQueryData(relationshipQueryKey(sessionId, post.author.id), rel)
        } catch {
          // Keep the snapshot: labels stay as they were, no error row.
        }
      }
      return {
        onMute: run(
          () => controller.setMuted(sessionId, backend, post.author.id, !(known?.isMuted ?? false)),
          known?.isMuted ? 'Unmuted' : 'Muted',
        ),
        onMuteBoosts: run(
          async () => {
            if (renoteMuted === true) await backend.unmuteRenotes(post.author.id)
            else await backend.muteRenotes(post.author.id)
            await resync()
          },
          renoteMuted === true ? 'Reposts unmuted' : 'Reposts muted',
        ),
        onBlock: run(
          () => controller.setBlocked(sessionId, backend, post.author.id, !(known?.isBlocking ?? false)),
          known?.isBlocking ? 'Unblocked' : 'Blocked',
        ),
        onReport: async (values: ReportChooserValues) => {
          try {
            const text = values.comment.trim()
            const mastodon = s.family === 'mastodon'
            // Misskey's `users/report-abuse` requires a non-empty comment;
            // Mastodon can file a report with the post + category alone.
            if (!mastodon && !text) throw new Error('Add a reason for the report.')
            await backend.reportAccount(
              post.author.id,
              mastodon
                ? {
                    comment: text,
                    // The reporter acted on THIS post: send it as backing
                    // evidence so the moderator sees what is being reported.
                    statusIds: [post.id],
                    category: values.category,
                    ruleIds: values.ruleIds,
                    forward: values.forward,
                  }
                : {comment: text},
            )
            showToast('Report sent')
          } catch (e) {
            toastError(e)
          }
        },
        muted: known?.isMuted,
        renoteMuted,
        blocking: known?.isBlocking,
        // P6.2: the DM row opens the inbox, and only when the session's
        // backend actually has the conversations module (capability-gated
        // in the menu — without the module the row stays disabled with
        // the "no composer connected" reason, never a dead tap). P6.2
        // §2.2: on a chat backend the row opens the 1-on-1 thread with
        // the author instead (Misskey account ids ARE user ids).
        ...(backend.conversations
          ? {onMessage: () => nav.navigate('Conversations')}
          : backend.chat
            ? {onMessage: () => nav.navigate('ChatUser', {userId: post.author.id})}
            : {}),
      }
    },
    [store, qc],
  )

  const handlers = useMemo<PostCardHandlers>(
    () => ({
      onReply: post => nav.navigate('Compose', {replyToId: post.id}),
      onQuote: post => nav.navigate('Compose', {quoteId: post.id}),
      onEdit: post => nav.navigate('Compose', {editId: post.id}),
      onClip: post => nav.navigate('Clips', {addNoteId: post.id}),
      userFor,
    }),
    [nav, userFor],
  )

  return (
    <PostCardHandlersContext.Provider value={handlers}>
      {children}
    </PostCardHandlersContext.Provider>
  )
}
