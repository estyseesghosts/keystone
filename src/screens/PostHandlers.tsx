import {useCallback, useContext, useMemo, useState} from 'react'
import {useNavigation, type NavigationProp} from '@react-navigation/native'
import {QueryClientContext, useQueryClient} from '@tanstack/react-query'

import {backendForSession, type Post} from '@keystone/fedi'

import {Dialog} from '#/components/Dialog'
import {EmojiPicker} from '#/components/EmojiPicker'
import {
  PostCardHandlersContext,
  type PostCardHandlers,
} from '#/components/Post/handlers'
import {toastError} from '#/components/Post/ActionBar'
import {showToast} from '#/lib/toast'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {graphControllerFor} from '#/state/queries'
import {useOptionalSessionStore, useSessionStore} from '#/state/session/SessionProvider'

// App-wide PostCard handlers (slice 4.6): reply/quote -> Compose route,
// reaction picker in a dialog, mute/block through the graph controller.
// Edit stays unset (Composer has no edit mode yet), so PostCard renders it
// disabled with a reason.

type PendingPick = {pick: (key: string, url: string | null) => Promise<void>}

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
  const {session} = useActiveBackend()
  const [pending, setPending] = useState<PendingPick | null>(null)

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
      return {
        onMute: run(
          () => controller.setMuted(sessionId, backend, post.author.id, true),
          'Muted',
        ),
        onBlock: run(
          () => controller.setBlocked(sessionId, backend, post.author.id, true),
          'Blocked',
        ),
      }
    },
    [store, qc],
  )

  const handlers = useMemo<PostCardHandlers>(
    () => ({
      onReply: post => nav.navigate('Compose', {replyToId: post.id}),
      onQuote: post => nav.navigate('Compose', {quoteId: post.id}),
      onPickReaction: (_post, pick) => setPending({pick}),
      userFor,
    }),
    [nav, userFor],
  )

  return (
    <PostCardHandlersContext.Provider value={handlers}>
      {children}
      <Dialog
        open={pending !== null && session !== null}
        onClose={() => setPending(null)}
        title="Pick a reaction"
        testID="reaction-picker">
        {session ? (
          <EmojiPicker
            sessionId={session.id}
            onPick={e => {
              const p = pending
              setPending(null)
              void p?.pick(e.key, e.url ?? null)
            }}
          />
        ) : null}
      </Dialog>
    </PostCardHandlersContext.Provider>
  )
}
