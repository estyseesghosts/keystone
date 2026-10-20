import {useCallback, useEffect, useRef, useState} from 'react'
import {View} from 'react-native'
import {useRoute, type RouteProp} from '@react-navigation/native'

import {appearNoteOf, appendOlder, type Cursor, type Post} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import type {RootParamList} from '#/routes'
import {useActiveBackend, PostRow, FeedHeading} from '#/screens/HomeFeed'

// Thread (`/notes/:id`): ancestors, the focused post, then branched replies.
//
// Thread behaviour lives in `packages/fedi` and is CALLED here, never
// reimplemented: Misskey `notes/conversation` (+ the packed-parent fallback
// for servers without it) and Mastodon `context` both hide behind
// `backend.thread(post)` / `backend.threadReplies(id)`.
const MAX_DEPTH = 64

function ReplyBranch({
  parentId,
  backend,
  expandedByDefault,
  depth,
}: {
  parentId: string
  backend: NonNullable<ReturnType<typeof useActiveBackend>['backend']>
  expandedByDefault: boolean
  depth: number
}) {
  const [expanded, setExpanded] = useState(expandedByDefault)
  const [items, setItems] = useState<Post[]>([])
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const page = await backend.threadReplies(parentId, {})
      setItems(page.items)
      setCursor(page.cursor)
      setHasMore(!page.end)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [backend, parentId])

  useEffect(() => {
    if (expanded && items.length === 0 && !loading && !error) void load()
  }, [expanded])

  const fetchMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const page = await backend.threadReplies(parentId, {cursor})
      setItems(prev => appendOlder(prev, page.items).items)
      setCursor(page.cursor)
      setHasMore(!page.end)
    } catch (err) {
      setError(err)
    } finally {
      setLoadingMore(false)
    }
  }, [backend, parentId, cursor, hasMore, loadingMore])

  if (!expanded) {
    return (
      <View style={[atoms.px_md, atoms.py_sm]}>
        <Button
          label="Show replies"
          variant="secondary"
          onPress={() => setExpanded(true)}
          testID={`show-replies-${parentId}`}
        />
      </View>
    )
  }

  return (
    <View style={{paddingLeft: depth > 0 ? 12 : 0}} testID={`replies-${parentId}`}>
      {expandedByDefault ? null : (
        <View style={[atoms.px_md, atoms.py_sm]}>
          <Button
            label="Hide replies"
            variant="secondary"
            onPress={() => setExpanded(false)}
            testID={`hide-replies-${parentId}`}
          />
        </View>
      )}
      {loading ? (
        <View style={[atoms.centered, atoms.py_sm]}>
          <Loader testID={`replies-loading-${parentId}`} />
        </View>
      ) : null}
      {error ? (
        <View style={[atoms.px_md, atoms.py_sm]}>
          <Caption color="faint">Could not load replies.</Caption>
          <Button label="Retry" variant="secondary" onPress={() => void load()} testID={`replies-retry-${parentId}`} />
        </View>
      ) : null}
      {items.map(child => {
        const shown = appearNoteOf(child)
        return (
          <View key={child.id}>
            <PostRow post={child} testID={`reply-${child.id}`} />
            {depth + 1 >= MAX_DEPTH ? (
              <Caption color="faint">Thread is too deep to expand here.</Caption>
            ) : (
              <ReplyBranch
                parentId={shown.id}
                backend={backend}
                expandedByDefault={false}
                depth={depth + 1}
              />
            )}
          </View>
        )
      })}
      {hasMore && items.length > 0 ? (
        <View style={[atoms.px_md, atoms.py_sm]}>
          <Button
            label={loadingMore ? 'Loading…' : 'Load more replies'}
            variant="secondary"
            onPress={() => void fetchMore()}
            testID={`more-replies-${parentId}`}
          />
        </View>
      ) : null}
    </View>
  )
}

export function NoteScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Note'>>()
  const id = route.params.id
  const {session, backend} = useActiveBackend()
  const [post, setPost] = useState<Post | null>(null)
  const [ancestors, setAncestors] = useState<Post[]>([])
  const [incomplete, setIncomplete] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const generationRef = useRef(0)

  const load = useCallback(async () => {
    if (!session || !backend) {
      setLoading(false)
      return
    }
    const generation = ++generationRef.current
    setLoading(true)
    setError(null)
    try {
      const loaded = await backend.post(id)
      if (generationRef.current !== generation) return
      // A pure-renote wrapper is not the thread subject: every ancestor
      // and reply query targets the original (appearNoteOf semantics).
      const focused = appearNoteOf(loaded)
      const thread = await backend.thread(focused)
      if (generationRef.current !== generation) return
      setPost(loaded)
      setAncestors(thread.ancestors)
      setIncomplete(thread.incomplete)
    } catch (err) {
      if (generationRef.current !== generation) return
      setError(err)
    } finally {
      if (generationRef.current === generation) setLoading(false)
    }
  }, [session, backend, id])

  useEffect(() => {
    setPost(null)
    setAncestors([])
    setIncomplete(false)
    setLoading(true)
    setError(null)
    void load()
  }, [load])

  const focused = post ? appearNoteOf(post) : null

  return (
    <View style={atoms.flex1} testID="note-screen">
      <FeedHeading title="Thread" />
      {!session || !backend ? (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Body>Sign in to see this thread.</Body>
        </View>
      ) : loading ? (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Loader testID="thread-loading" />
          <Caption color="faint">Loading thread…</Caption>
        </View>
      ) : error || !focused ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Could not load this thread.</Body>
          <Caption color="faint">It may be deleted, private, or on an unreachable server.</Caption>
          <Button label="Retry" variant="secondary" onPress={() => void load()} testID="thread-retry" />
        </View>
      ) : (
        <View style={atoms.flex1} testID="thread-body">
          {ancestors.map(a => (
            <PostRow key={a.id} post={a} testID={`ancestor-${a.id}`} />
          ))}
          {incomplete ? (
            <View style={[atoms.px_md, atoms.py_sm]}>
              <Caption color="faint">Earlier reply context unavailable.</Caption>
            </View>
          ) : null}
          <PostRow post={focused} testID={`focused-${focused.id}`} />
          <ReplyBranch
            parentId={focused.id}
            backend={backend}
            expandedByDefault
            depth={0}
          />
        </View>
      )}
    </View>
  )
}
