import {useCallback, useSyncExternalStore, useState} from 'react'
import {View} from 'react-native'
import {useQueryClient, type InfiniteData} from '@tanstack/react-query'

import {msg} from '@lingui/macro'

import {
  TRANSFER_EXPORT_ENTITY,
  isPermissionError,
  isUnsupportedError,
  type Backend,
  type Notification,
  type Page,
  type TransferExportKind,
  type TransferImportKind,
  type TransferPhase,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {pickTransferFile} from '#/lib/documentPicker'
import {i18n} from '#/locale/i18n'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useActiveSession} from '#/state/session/SessionProvider'

import {PlaceholderRow, SectionHint, SettingRow} from './rows'

// Import / export (clickstone §2.3, ADR-0004): the twelve v1
// `/settings/import` + `/settings/export` rows, one data family at a
// time (following, mutes, blocking, bookmarks, notes — plus the
// lists/antennas/clips exports the same endpoints serve).
//
// - The Misskey family exposes `Backend.transfer`: imports pick a file
//   (Drive upload → `i/import-*` with `{fileId}`, never `{file}`) and
//   exports only ENQUEUE — completion arrives as the `exportCompleted`
//   notification (1.11), never a spinner on the POST.
// - The Mastodon family has no MastoAPI import/export (server-side CSV
//   through the instance UI — verified absent in the local Mastodon
//   checkout), so every row stays an honest disabled placeholder there.
// - Imports additionally need the Drive capability: a flavor without it
//   disables the import rows with a reason (exports need no upload).

const IMPORT_ROWS: Array<{kind: TransferImportKind; title: string; hint: string}> = [
  {
    kind: 'following',
    title: 'Import following',
    hint: 'A Misskey following export (CSV). The file uploads to your Drive first.',
  },
  {
    kind: 'blocking',
    title: 'Import blocks',
    hint: 'A Misskey blocking export (CSV). The file uploads to your Drive first.',
  },
  {
    kind: 'mute',
    title: 'Import mutes',
    hint: 'A Misskey mute export (CSV). The file uploads to your Drive first.',
  },
  {
    kind: 'notes',
    title: 'Import notes',
    hint: 'A Sharkey notes export (CSV). Fork-only: stock Misskey has no notes import.',
  },
]

const EXPORT_ROWS: Array<{kind: TransferExportKind; title: string; hint: string}> = [
  {kind: 'following', title: 'Export following', hint: 'Who you follow.'},
  {kind: 'blocking', title: 'Export blocks', hint: 'Who you block.'},
  {kind: 'mute', title: 'Export mutes', hint: 'Who you mute.'},
  {kind: 'notes', title: 'Export notes', hint: 'Your posts (once a day).'},
  {kind: 'user-lists', title: 'Export lists', hint: 'Your lists.'},
  {kind: 'antennas', title: 'Export antennas', hint: 'Your antennas.'},
  {kind: 'clips', title: 'Export clips', hint: 'Your clips.'},
  {kind: 'favorites', title: 'Export favorites', hint: 'Your bookmarks.'},
]

/** Honest failure text for a transfer action (never a raw code dump). */
function transferErrorMessage(kind: string, action: 'import' | 'export', err: unknown): string {
  if (isPermissionError(err)) return i18n._(msg`Your account cannot do that here.`)
  if (isUnsupportedError(err)) {
    if (action === 'import') {
      return kind === 'notes'
        ? i18n._(msg`This server has no notes import (a Sharkey/fork endpoint).`)
        : i18n._(msg`This server has no ${kind} import.`)
    }
    return i18n._(msg`This server has no ${kind} export.`)
  }
  if (err instanceof Error && err.message) return err.message
  return action === 'import'
    ? i18n._(msg`Could not import.`)
    : i18n._(msg`Could not start the export.`)
}

function phaseLabel(phase: TransferPhase): string {
  switch (phase) {
    case 'uploading':
      return i18n._(msg`Uploading to your Drive…`)
    case 'submitting':
      return i18n._(msg`Submitting the import…`)
    case 'done':
      return i18n._(msg`Done.`)
  }
}

function ImportRow({
  backend,
  kind,
  title,
  hint,
}: {
  backend: Backend
  kind: TransferImportKind
  title: string
  hint: string
}) {
  // `phase` doubles as the busy flag: anything past idle disables the
  // button until the run settles. Cancel returns to idle with no error.
  const [phase, setPhase] = useState<'idle' | 'picking' | TransferPhase>('idle')
  const [doneMessage, setDoneMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = phase === 'picking' || phase === 'uploading' || phase === 'submitting'

  const run = async () => {
    if (busy || !backend.transfer) return
    setError(null)
    setDoneMessage(null)
    setPhase('picking')
    let picked: {file: File; name: string} | null
    try {
      picked = await pickTransferFile()
    } catch (err) {
      setError(transferErrorMessage(kind, 'import', err))
      setPhase('idle')
      return
    }
    // Picker cancel: a silent no-op — never an error, never a backend call.
    if (!picked) {
      setPhase('idle')
      return
    }
    try {
      const result = await backend.transfer.importFile(kind, picked.file, {
        onPhase: next => setPhase(next),
      })
      setDoneMessage(result.message)
      setPhase('done')
    } catch (err) {
      setError(transferErrorMessage(kind, 'import', err))
      setPhase('idle')
    }
  }

  const label =
    phase === 'picking'
      ? i18n._(msg`Choosing…`)
      : phase === 'uploading' || phase === 'submitting'
        ? phaseLabel(phase)
        : phase === 'done'
          ? i18n._(msg`Import another file`)
          : i18n._(msg`Choose file`)

  return (
    <SettingRow title={title} hint={hint} testID={`transfer-import-${kind}`}>
      <View style={[atoms.gap_sm]}>
        <Button
          label={label}
          variant="secondary"
          disabled={busy}
          onPress={() => void run()}
          testID={`transfer-import-pick-${kind}`}
        />
        {busy && (phase === 'uploading' || phase === 'submitting') ? (
          <Caption color="faint" testID={`transfer-import-status-${kind}`}>
            {phaseLabel(phase)}
          </Caption>
        ) : null}
        {doneMessage ? (
          <Caption color="faint" testID={`transfer-import-status-${kind}`}>
            {doneMessage}
          </Caption>
        ) : null}
        {error ? <Caption testID={`transfer-import-error-${kind}`}>{error}</Caption> : null}
      </View>
    </SettingRow>
  )
}

/**
 * True when the session's notifications cache already holds a matching
 * `exportCompleted` row (the server built the file). Subscribes to the
 * cache so a notification that lands after the enqueue flips the row
 * without a refetch. Session-scoped: another account's completion never
 * completes this row.
 */
function useExportCompletion(sessionId: string | null, entity: string): boolean {
  const queryClient = useQueryClient()
  const subscribe = useCallback(
    (onStoreChange: () => void) => queryClient.getQueryCache().subscribe(onStoreChange),
    [queryClient],
  )
  const getSnapshot = useCallback((): boolean => {
    if (!sessionId || entity.length === 0) return false
    const queries = queryClient.getQueriesData<InfiniteData<Page<Notification>> | undefined>({
      queryKey: [sessionId, 'notifications'],
    })
    for (const [, data] of queries) {
      for (const page of data?.pages ?? []) {
        for (const item of page?.items ?? []) {
          if (item.kind === 'exportCompleted' && item.ext?.exportedEntity === entity) return true
        }
      }
    }
    return false
  }, [queryClient, sessionId, entity])
  return useSyncExternalStore(subscribe, getSnapshot)
}

function ExportRow({
  backend,
  sessionId,
  kind,
  title,
  hint,
}: {
  backend: Backend
  sessionId: string | null
  kind: TransferExportKind
  title: string
  hint: string
}) {
  const entity = TRANSFER_EXPORT_ENTITY[kind]
  const [busy, setBusy] = useState(false)
  // `queued` persists after the POST resolves: the file is NOT ready yet
  // (no spinner — the server builds it in the background).
  const [queued, setQueued] = useState<string | null>(null)
  const [payloadBytes, setPayloadBytes] = useState<number | null>(null)
  const [checkedFound, setCheckedFound] = useState(false)
  const [checkedMissing, setCheckedMissing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cacheCompleted = useExportCompletion(queued ? sessionId : null, entity)
  const completed = checkedFound || cacheCompleted

  const run = async () => {
    if (busy || !backend.transfer) return
    setError(null)
    setPayloadBytes(null)
    setCheckedFound(false)
    setCheckedMissing(false)
    setBusy(true)
    try {
      const result = await backend.transfer.exportList(kind)
      if (result.status === 'queued') {
        // Enqueued only: the message names the rate window and the
        // `exportCompleted` notification to watch. Nothing spins here.
        setQueued(result.message)
      } else {
        setPayloadBytes(JSON.stringify(result.payload ?? null).length)
        setQueued(null)
      }
    } catch (err) {
      setError(transferErrorMessage(kind, 'export', err))
    } finally {
      setBusy(false)
    }
  }

  // Explicit re-read for the completion notification: the cache watcher
  // above only sees rows the Notifications screen (or stream fan-in) has
  // already fetched, so a queued export needs a way to ask the server.
  const check = async () => {
    if (checking) return
    setChecking(true)
    setError(null)
    setCheckedMissing(false)
    try {
      const page = await backend.notifications({
        includeTypes: ['exportCompleted'],
        limit: 20,
      })
      const found = (page.items ?? []).some(
        item => item.kind === 'exportCompleted' && item.ext?.exportedEntity === entity,
      )
      if (found) setCheckedFound(true)
      else setCheckedMissing(true)
    } catch (err) {
      setError(transferErrorMessage(kind, 'export', err))
    } finally {
      setChecking(false)
    }
  }

  return (
    <SettingRow title={title} hint={hint} testID={`transfer-export-${kind}`}>
      <View style={[atoms.gap_sm]}>
        <Button
          label={busy ? i18n._(msg`Requesting…`) : i18n._(msg`Export`)}
          variant="secondary"
          disabled={busy}
          onPress={() => void run()}
          testID={`transfer-export-run-${kind}`}
        />
        {queued && !completed ? (
          <Caption color="faint" testID={`transfer-export-status-${kind}`}>
            {queued}
          </Caption>
        ) : null}
        {payloadBytes !== null ? (
          <Caption color="faint" testID={`transfer-export-status-${kind}`}>
            {i18n._(msg`The server returned the file directly (${payloadBytes} bytes).`)}
          </Caption>
        ) : null}
        {completed ? (
          <Caption color="faint" testID={`transfer-export-status-${kind}`}>
            {i18n._(msg`Your export is ready — find it in Notifications.`)}
          </Caption>
        ) : null}
        {queued && !completed ? (
          <Button
            label={checking ? i18n._(msg`Checking…`) : i18n._(msg`Check for the file`)}
            variant="secondary"
            disabled={checking}
            onPress={() => void check()}
            testID={`transfer-export-check-${kind}`}
          />
        ) : null}
        {checkedMissing && !completed ? (
          <Caption color="faint">
            {i18n._(msg`Not there yet — the server builds the file in the background.`)}
          </Caption>
        ) : null}
        {error ? <Caption testID={`transfer-export-error-${kind}`}>{error}</Caption> : null}
      </View>
    </SettingRow>
  )
}

const NO_TRANSFER_REASON =
  'Needs a Misskey-family server. Mastodon has no import/export API — use the instance website.'

export function ImportSection() {
  const session = useActiveSession()
  const {backend} = useActiveBackend()
  if (!session || !backend) {
    return (
      <View style={[atoms.gap_sm]} testID="settings-section-import">
        <SectionHint>Sign in to move data in.</SectionHint>
      </View>
    )
  }
  // Family gate: no `transfer` member means no import/export API at all.
  if (!backend.transfer) {
    return (
      <View style={[atoms.gap_sm]} testID="settings-section-import">
        {IMPORT_ROWS.map(row => (
          <PlaceholderRow
            key={row.kind}
            title={row.title}
            hint={row.hint}
            reason={NO_TRANSFER_REASON}
            testID={`placeholder-import-${row.kind}`}
          />
        ))}
      </View>
    )
  }
  // Capability gate: imports upload through the Drive — a flavor without
  // it cannot take a file. Unknown stays disabled too (an unverified
  // flag never unlocks an upload affordance).
  if (backend.capabilities.drive !== 'supported') {
    const reason =
      backend.capabilities.drive === 'unsupported'
        ? 'Needs the Drive — this server has no file storage.'
        : 'Drive support is unknown on this server — imports stay off.'
    return (
      <View style={[atoms.gap_sm]} testID="settings-section-import">
        {IMPORT_ROWS.map(row => (
          <PlaceholderRow
            key={row.kind}
            title={row.title}
            hint={row.hint}
            reason={reason}
            testID={`placeholder-import-${row.kind}`}
          />
        ))}
      </View>
    )
  }
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-import">
      {IMPORT_ROWS.map(row => (
        <ImportRow key={row.kind} backend={backend} kind={row.kind} title={row.title} hint={row.hint} />
      ))}
    </View>
  )
}

export function ExportSection() {
  const session = useActiveSession()
  const {backend} = useActiveBackend()
  if (!session || !backend) {
    return (
      <View style={[atoms.gap_sm]} testID="settings-section-export">
        <SectionHint>Sign in to move data out.</SectionHint>
      </View>
    )
  }
  // Family gate: exports enqueue through the same member. Fork-level gaps
  // (an endpoint a flavor dropped) surface as honest action-time errors.
  if (!backend.transfer) {
    return (
      <View style={[atoms.gap_sm]} testID="settings-section-export">
        {EXPORT_ROWS.map(row => (
          <PlaceholderRow
            key={row.kind}
            title={row.title}
            hint={row.hint}
            reason={NO_TRANSFER_REASON}
            testID={`placeholder-export-${row.kind}`}
          />
        ))}
      </View>
    )
  }
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-export">
      {EXPORT_ROWS.map(row => (
        <ExportRow
          key={row.kind}
          backend={backend}
          sessionId={session.id}
          kind={row.kind}
          title={row.title}
          hint={row.hint}
        />
      ))}
    </View>
  )
}
