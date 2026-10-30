// Page action bar (P6.5 Pages, slice 2): like, copy link, share, owner
// menu, report, moderator delete. Every control is capability-gated;
// signed-out viewers and owners see no like control (PG-10: Misskey
// shows a button that 401s / says YOUR_PAGE — never an inert control).

import {useState, useSyncExternalStore} from 'react'
import {Platform, Share, StyleSheet, View} from 'react-native'
import {msg} from '@lingui/macro'

import {misskeyAdminRoleOf, type Backend, type PageModel} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Dialog} from '#/components/Dialog'
import {HeartIcon} from '#/components/icons'
import {Menu, type MenuItem} from '#/components/Menu'
import {toastError} from '#/components/Post/ActionBar'
import {ReportChooser} from '#/components/Post/ReportChooser'
import type {ReportChooserValues} from '#/components/Post/menuModel'
import {canCopy, copyText} from '#/lib/clipboard'
import {putRedraftSeed} from '#/lib/redraft'
import {showToast} from '#/lib/toast'
import {i18n} from '#/locale/i18n'
import {navigationRef} from '#/navigationRef'
import {useBackendForSessionId} from '#/screens/HomeFeed'
import {useSessionStore} from '#/state/session/SessionProvider'
import {meQueryKey} from '#/state/queries/keys'
import {useMe} from '#/state/queries/me'
import {usePageLikeQueue} from '#/state/queries/pages'
import {useQueryClient} from '@tanstack/react-query'

const ICON = 16

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4},
  count: {flexDirection: 'row', alignItems: 'center', gap: 4},
})

function mePinnedPageId(me: {ext?: unknown} | null): string | null {
  const bag = (me?.ext ?? null) as {me?: {pinnedPageId?: unknown}} | null
  const id = bag?.me?.pinnedPageId
  return typeof id === 'string' ? id : null
}

export function PageActions({
  page,
  sessionId,
  testID,
}: {
  page: PageModel
  /** Owning session (null = signed out: no like, embeds unavailable). */
  sessionId: string | null
  testID?: string
}) {
  const theme = useTheme()
  const backend = useBackendForSessionId(sessionId)
  const {me} = useMe(sessionId)
  const queryClient = useQueryClient()
  const like = usePageLikeQueue(sessionId, page, {backend})
  const store = useSessionStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const accountId =
    sessionId != null ? (snapshot.sessions.find(s => s.id === sessionId)?.accountId ?? null) : null
  const isOwner = accountId != null && accountId === page.author.id
  const [reportOpen, setReportOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const role = backend?.family === 'misskey' ? misskeyAdminRoleOf(me) : null
  const moderator = role === 'admin' || role === 'moderator'
  const canUsePages = backend?.pages != null
  const showLike = sessionId != null && !isOwner && canUsePages
  const pinned = mePinnedPageId(me) === page.id

  const copyLink = async (): Promise<void> => {
    try {
      await copyText(page.url)
      showToast(i18n._(msg`Copied`))
    } catch (e) {
      toastError(e)
    }
  }

  const shareAsPost = (): void => {
    const key = `page:${page.id}`
    putRedraftSeed(key, {text: `${page.title || page.name}\n${page.url}`})
    navigationRef.navigate('Compose', {redraftId: key} as never)
  }

  const share = async (): Promise<void> => {
    // Native share where available; otherwise the Compose resharing flow
    // (web desktop has no share target — and signed-out trees have no
    // composer, so a failure there surfaces honestly instead of faking).
    const canNativeShare =
      Platform.OS !== 'web' ||
      (typeof navigator !== 'undefined' && 'share' in navigator && sessionId != null);
    if (!canNativeShare && sessionId) {
      shareAsPost()
      return
    }
    const text = page.title || page.name
    try {
      await Share.share({message: text ? `${text}\n${page.url}` : page.url, url: page.url})
    } catch (e) {
      toastError(e)
    }
  }

  const togglePin = async (): Promise<void> => {
    if (!backend?.pages || !sessionId) return
    setBusy(true)
    try {
      await backend.pages.pin(pinned ? null : page.id)
      await queryClient.invalidateQueries({queryKey: meQueryKey(sessionId)})
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const runDelete = async (): Promise<void> => {
    if (!backend?.pages) return
    setBusy(true)
    try {
      await backend.pages.delete(page.id)
      await queryClient.invalidateQueries({queryKey: [sessionId, 'pages']})
      setDeleteOpen(false)
      navigationRef.navigate('Pages')
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const report = async (values: ReportChooserValues): Promise<void> => {
    if (!backend) return
    try {
      const text = values.comment.trim()
      if (!text) {
        showToast(i18n._(msg`Add a reason for the report.`))
        return
      }
      await backend.reportAccount(page.author.id, {comment: text})
      setReportOpen(false)
      showToast(i18n._(msg`Report sent`))
    } catch (e) {
      toastError(e)
    }
  }

  const items: MenuItem[] = []
  if (isOwner && canUsePages) {
    items.push({
      key: 'edit',
      label: i18n._(msg`Edit`),
      onSelect: () => navigationRef.navigate('PageEdit', {id: page.id}),
    })
    items.push({key: 'pin', label: pinned ? i18n._(msg`Unpin`) : i18n._(msg`Pin`), onSelect: () => void togglePin()})
    items.push({key: 'delete', label: i18n._(msg`Delete`), onSelect: () => setDeleteOpen(true)})
  } else if (sessionId && !isOwner) {
    if (canUsePages) {
      items.push({key: 'report', label: i18n._(msg`Report author`), onSelect: () => setReportOpen(true)})
    }
    if (moderator && canUsePages) {
      items.push({key: 'delete', label: i18n._(msg`Delete`), onSelect: () => setDeleteOpen(true)})
    }
  }

  return (
    <View testID={testID} style={styles.row}>
      {showLike ? (
        <Button
          label={like.liked ? i18n._(msg`Unlike, ${like.count} likes`) : i18n._(msg`Like, ${like.count} likes`)}
          variant="secondary"
          compact
          onPress={() => like.toggle().catch(toastError)}
          disabled={like.busy}
          testID={testID ? `${testID}-like` : undefined}
        />
      ) : (
        <View style={styles.count} testID={testID ? `${testID}-count` : undefined}>
          <HeartIcon size={ICON} color={theme.palette.muted} filled={false} />
          <Caption color="muted">{String(like.count)}</Caption>
        </View>
      )}
      <Button
        label={i18n._(msg`Copy link`)}
        variant="secondary"
        compact
        disabled={!canCopy()}
        onPress={() => void copyLink()}
        testID={testID ? `${testID}-copy` : undefined}
      />
      <Button
        label={i18n._(msg`Share`)}
        variant="secondary"
        compact
        onPress={() => void share()}
        testID={testID ? `${testID}-share` : undefined}
      />
      {items.length > 0 ? (
        <Menu
          label={i18n._(msg`Page options`)}
          items={items}
          testID={testID ? `${testID}-menu` : undefined}
        />
      ) : null}
      {reportOpen && backend ? (
        <Dialog open onClose={() => setReportOpen(false)} title={i18n._(msg`Report author`)} testID={testID ? `${testID}-report` : undefined}>
          <ReportChooser
            title={i18n._(msg`Report author`)}
            action={i18n._(msg`Send report`)}
            family={backend.family}
            remoteHost={page.author.host}
            sessionId={sessionId}
            initialComment={`Page: ${page.url}\n-----\n`}
            onSubmit={(values: ReportChooserValues) => void report(values)}
            onCancel={() => setReportOpen(false)}
          />
        </Dialog>
      ) : null}
      {deleteOpen ? (
        <Dialog open onClose={() => setDeleteOpen(false)} title={i18n._(msg`Delete this page?`)} testID={testID ? `${testID}-delete` : undefined}>
          <Body>{page.title || page.name}</Body>
          <Button
            label={i18n._(msg`Delete`)}
            variant="secondary"
            disabled={busy}
            onPress={() => void runDelete()}
            testID={testID ? `${testID}-delete-confirm` : undefined}
          />
        </Dialog>
      ) : null}
    </View>
  )
}
