import {useEffect, useState} from 'react'
import {Image, Keyboard, View} from 'react-native'

import {msg} from '@lingui/macro'

import {
  buildPostDraft,
  type ScheduledNote,
  type ServerDraft,
} from '@keystone/fedi'

import {space} from '#/alf/tokens'
import {Body, Caption} from '#/alf/typography'
import {TextField} from '#/components/forms/TextField'
import {Dialog} from '#/components/Dialog'
import {EmojiPicker} from '#/components/EmojiPicker'
import {Loader} from '#/components/Loader'
import {
  useCancelScheduled,
  useDeleteServerDraft,
  useSaveServerDraft,
  useScheduledPosts,
  useServerDrafts,
} from '#/state/queries/composer'

import {Chip} from './Chip'
import type {ComposerController} from './Composer'
import {SuggestionList} from './Autocomplete'
import {i18n} from '#/locale/i18n'

// Shared composer sections: the full (`Composer`) and compact
// (`CompactComposer`) chromes render the same blocks, so testIDs and
// behavior stay identical in both.

const POLL_DURATIONS: Array<{label: string; seconds: number}> = [
  {label: '5 min', seconds: 300},
  {label: '1 hour', seconds: 3600},
  {label: '1 day', seconds: 86400},
  {label: '7 days', seconds: 604800},
]

export function CwSection({c}: {c: ComposerController}) {
  if (!c.state.cwEnabled) return null
  return (
    <TextField
      label={i18n._(msg`Content warning`)}
      value={c.state.cw}
      onChangeText={cw => c.patch({cw})}
      testID="composer-cw"
    />
  )
}

export function PollSection({c}: {c: ComposerController}) {
  if (!c.state.poll) return null
  return (
    <View style={{gap: space.sm}} testID="composer-poll">
      {c.state.poll.choices.map((choice, i) => (
        <TextField
          key={i}
          label={i18n._(msg`Choice ${i + 1}`)}
          value={choice}
          onChangeText={t =>
            c.patch({
              poll: {...c.state.poll!, choices: c.state.poll!.choices.map((x, j) => (j === i ? t : x))},
            })
          }
        />
      ))}
      <View style={c.styles.row}>
        {c.state.poll.choices.length < c.limits.maxPollOptions ? (
          <Chip
            label={i18n._(msg`Add choice`)}
            onPress={() => c.patch({poll: {...c.state.poll!, choices: [...c.state.poll!.choices, '']}})}
          />
        ) : null}
        {c.state.poll.choices.length > 2 ? (
          <Chip
            label={i18n._(msg`Remove last`)}
            onPress={() => c.patch({poll: {...c.state.poll!, choices: c.state.poll!.choices.slice(0, -1)}})}
          />
        ) : null}
        <Chip
          label={i18n._(msg`Multiple choice`)}
          selected={c.state.poll.multiple}
          disabled={!c.gates.pollMultiple.enabled}
          disabledReason={c.gates.pollMultiple.enabled ? undefined : c.gates.pollMultiple.reason}
          onPress={() => c.patch({poll: {...c.state.poll!, multiple: !c.state.poll!.multiple}})}
        />
        <Chip
          label={i18n._(msg`Hide totals`)}
          selected={c.state.poll.hideTotals}
          disabled={!c.gates.pollHideTotals.enabled}
          disabledReason={c.gates.pollHideTotals.enabled ? undefined : c.gates.pollHideTotals.reason}
          onPress={() => c.patch({poll: {...c.state.poll!, hideTotals: !c.state.poll!.hideTotals}})}
          testID="composer-poll-hide-totals"
        />
      </View>
      <View style={c.styles.row}>
        {POLL_DURATIONS.map(d => (
          <Chip
            key={d.seconds}
            label={d.label}
            selected={c.state.poll!.durationSeconds === d.seconds}
            onPress={() => c.patch({poll: {...c.state.poll!, durationSeconds: d.seconds}})}
          />
        ))}
      </View>
    </View>
  )
}

export function UploadsSection({c}: {c: ComposerController}) {
  const sensitiveGate = c.gates.mediaSensitive
  return (
    <>
      {c.uploads.items.map(u => (
        <View key={u.key} style={c.styles.media} testID={`composer-upload-${u.key}`}>
          {u.previewUri ? (
            <Image source={{uri: u.previewUri}} style={c.styles.thumb} accessibilityLabel={u.alt || u.name} />
          ) : (
            <View style={c.styles.thumb} />
          )}
          <View style={{flex: 1, gap: space.xs}}>
            <Caption color="muted">
              {u.name} -{' '}
              {u.status === 'staged'
                ? i18n._(msg`ready to upload`)
                : u.status === 'uploading'
                  ? i18n._(msg`uploading...`)
                  : u.status === 'done'
                    ? i18n._(msg`uploaded`)
                    : (u.error ?? i18n._(msg`failed`))}
            </Caption>
            <TextField
              label={i18n._(msg`Description (alt text)`)}
              value={u.alt}
              onChangeText={t => c.uploads.setAlt(u.key, t)}
              placeholder={u.status === 'done' ? i18n._(msg`Locked after upload`) : i18n._(msg`Describe the media`)}
            />
            {/* Attach-time sensitivity (`drive/files/create` `isSensitive`).
                The flag rides WITH the upload, so it is fixed once the file
                is on the server; where the family only has status-level
                sensitivity the toggle is disabled with that reason. */}
            <View style={c.styles.row}>
              <Chip
                label={i18n._(msg`Sensitive`)}
                selected={u.sensitive}
                disabled={!sensitiveGate.enabled || u.status === 'done'}
                disabledReason={
                  !sensitiveGate.enabled
                    ? sensitiveGate.reason
                    : i18n._(msg`Locked after upload`)
                }
                onPress={() => c.uploads.setSensitive(u.key, !u.sensitive)}
                testID={`composer-upload-sensitive-${u.key}`}
              />
            </View>
          </View>
          <Chip label={i18n._(msg`Remove`)} onPress={() => c.uploads.remove(u.key)} />
        </View>
      ))}
      {c.uploads.items.length > 0 && !sensitiveGate.enabled ? (
        <Caption color="muted" testID="composer-media-sensitive-reason">
          {sensitiveGate.reason}
        </Caption>
      ) : null}
    </>
  )
}

export function ScheduleSection({c}: {c: ComposerController}) {
  if (!c.state.scheduledAt || !c.gates.schedule.enabled) return null
  const t = Date.parse(c.state.scheduledAt)
  const invalid = !Number.isFinite(t) || t <= Date.now()
  const atNineLocal = (d: Date) => {
    const n = new Date(d)
    n.setHours(9, 0, 0, 0)
    return n.toISOString()
  }
  const tomorrowNine = () => {
    const n = new Date()
    n.setDate(n.getDate() + 1)
    return atNineLocal(n)
  }
  const nextWeekNine = () => {
    const n = new Date()
    n.setDate(n.getDate() + 7)
    return atNineLocal(n)
  }
  return (
    <View style={{gap: space.sm}}>
      <TextField
        label={i18n._(msg`Post at (ISO time)`)}
        value={c.state.scheduledAt}
        onChangeText={scheduledAt => c.patch({scheduledAt})}
        testID="composer-schedule-at"
      />
      <View style={c.styles.row}>
        <Chip
          label={i18n._(msg`In 1 hour`)}
          onPress={() => c.patch({scheduledAt: new Date(Date.now() + 3600_000).toISOString()})}
          testID="composer-schedule-in1h"
        />
        <Chip
          label={i18n._(msg`Tomorrow 9:00`)}
          onPress={() => c.patch({scheduledAt: tomorrowNine()})}
          testID="composer-schedule-tomorrow"
        />
        <Chip
          label={i18n._(msg`Next week 9:00`)}
          onPress={() => c.patch({scheduledAt: nextWeekNine()})}
          testID="composer-schedule-nextweek"
        />
      </View>
      {invalid ? (
        <Caption testID="composer-schedule-invalid">
          {i18n._(msg`Scheduled time must be in the future.`)}
        </Caption>
      ) : null}
    </View>
  )
}

// Specified/direct recipients (C4). Rendered only when the selected
// visibility option reads as `direct` (detected via `c.options`, never by
// hardcoding family wire strings). Additions/removals round-trip through
// `c.patch({visibleUserIds})`. Validation stays in fedi's `buildPostDraft`.
function parseRecipientHandle(raw: string): {username: string; host: string | null} | null {
  let t = raw.trim()
  if (t.startsWith('@')) t = t.slice(1)
  if (!t) return null
  const parts = t.split('@')
  if (parts.length > 2 || !parts[0]) return null
  return {username: parts[0], host: parts[1] ?? null}
}

export function RecipientSection({c}: {c: ComposerController}) {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const selected = c.options.find(o => o.raw === c.state.visibilityRaw)
  if (selected?.kind !== 'direct') return null
  const backend = (c as {backend?: ComposerController['backend']}).backend
  const canResolve =
    typeof backend?.account === 'function' || typeof backend?.search?.accounts === 'function'

  const add = async () => {
    const raw = input.trim()
    if (!raw || resolving) return
    if (!canResolve) {
      // No lookup on the Backend surface: store the handle verbatim.
      if (!c.state.visibleUserIds.includes(raw)) {
        c.patch({visibleUserIds: [...c.state.visibleUserIds, raw]})
      }
      setInput('')
      setError(null)
      return
    }
    const parsed = parseRecipientHandle(raw)
    if (!parsed) {
      setError(i18n._(msg`Could not resolve "${raw}".`))
      return
    }
    setResolving(true)
    try {
      let id: string | null = null
      if (typeof backend?.account === 'function') {
        const acct = await backend.account({username: parsed.username, host: parsed.host})
        id = acct?.id ?? null
      } else if (typeof backend?.search?.accounts === 'function') {
        const page = await backend.search.accounts(raw)
        id = page?.items?.[0]?.id ?? null
      }
      if (!id) {
        setError(i18n._(msg`Could not resolve "${raw}".`))
        return
      }
      if (!c.state.visibleUserIds.includes(id)) {
        c.patch({visibleUserIds: [...c.state.visibleUserIds, id]})
      }
      setInput('')
      setError(null)
    } catch (err) {
      // Keep the raw text so the user can retry or edit it.
      setError(err instanceof Error ? err.message : i18n._(msg`Could not resolve "${raw}".`))
    } finally {
      setResolving(false)
    }
  }

  const remove = (id: string) => {
    c.patch({visibleUserIds: c.state.visibleUserIds.filter(x => x !== id)})
  }

  return (
    <View style={{gap: space.sm}} testID="composer-recipients">
      <View style={c.styles.row}>
        {c.state.visibleUserIds.map(id => (
          <Chip
            key={id}
            label={id}
            onPress={() => remove(id)}
            testID={`composer-recipient-del-${id}`}
          />
        ))}
      </View>
      <TextField
        label={i18n._(msg`Add recipient`)}
        value={input}
        onChangeText={t => {
          setInput(t)
          if (error) setError(null)
        }}
        placeholder={i18n._(msg`@user or @user@host`)}
        testID="composer-recipient-input"
      />
      <View style={c.styles.row}>
        <Chip
          label={resolving ? i18n._(msg`Adding…`) : i18n._(msg`Add`)}
          onPress={() => {
            void add()
          }}
          testID="composer-recipient-add"
        />
      </View>
      {error ? <Caption testID="composer-recipient-error">{error}</Caption> : null}
      {!canResolve ? (
        <Caption color="muted">{i18n._(msg`IDs are sent verbatim on this server.`)}</Caption>
      ) : null}
    </View>
  )
}

export function DraftsSection({c}: {c: ComposerController}) {
  if (c.drafts.length === 0) {
    return c.showDrafts ? <Caption color="muted">{i18n._(msg`No saved drafts.`)}</Caption> : null
  }
  return (
    <View style={{gap: space.sm}} testID="composer-drafts">
      {c.drafts.map(d => (
        <Chip key={d.id} label={d.text.slice(0, 40) || i18n._(msg`(poll / CW only)`)} onPress={() => c.restore(d)} />
      ))}
    </View>
  )
}

function scheduledSnippet(s: ScheduledNote): string {
  if (s.post) return s.post.content.plain.slice(0, 80) || i18n._(msg`(no text)`)
  const text = s.draft?.text
  return typeof text === 'string' && text ? text.slice(0, 80) : i18n._(msg`(no text)`)
}

// Scheduled posts list + cancel (C8b). Rendered only where the backend
// offers scheduling; the query stays disabled otherwise — never a faked
// list. Mastodon's listing cannot preview bodies (`post: null`), so the
// raw draft text is the fallback, never invented content.
export function ScheduledListSection({c}: {c: ComposerController}) {
  const list = useScheduledPosts(c.session, c.backend)
  const cancel = useCancelScheduled(c.session, c.backend)
  if (!c.gates.schedule.enabled || !c.backend.scheduled) return null
  return (
    <View style={{gap: space.sm}} testID="composer-scheduled-list">
      <Caption color="muted">{i18n._(msg`Scheduled posts`)}</Caption>
      {list.isPending ? (
        <Loader testID="composer-scheduled-loading" />
      ) : list.isError ? (
        <Caption color="faint">{i18n._(msg`Could not load scheduled posts.`)}</Caption>
      ) : list.data.length === 0 ? (
        <Caption color="muted">{i18n._(msg`No scheduled posts.`)}</Caption>
      ) : (
        list.data.map(s => (
          <View key={s.id} style={c.styles.row}>
            <Caption color="muted" testID={`composer-scheduled-${s.id}`}>
              {new Date(s.scheduledAt).toLocaleString()} — {scheduledSnippet(s)}
            </Caption>
            <Chip
              label={i18n._(msg`Cancel`)}
              disabled={cancel.isPending}
              onPress={() =>
                cancel.mutate(s.id, {
                  onError: err => c.setError(err instanceof Error ? err.message : i18n._(msg`Could not cancel.`)),
                })
              }
              testID={`composer-scheduled-cancel-${s.id}`}
            />
          </View>
        ))
      )}
    </View>
  )
}

function serverDraftSnippet(d: ServerDraft): string {
  return d.text?.slice(0, 80) || i18n._(msg`(no text)`)
}

// Server-side drafts (C9/MK5): list, restore into the composer, delete,
// and save the current composer state. Rendered only where the backend
// offers `serverDrafts` (Misskey family) — Mastodon never sees this block.
// Restoring brings text/CW/visibility/recipients/schedule/poll and
// reply/quote targets; attachments stay on the server draft and must be
// re-attached (local files cannot round-trip through a listing).
export function ServerDraftsSection({c}: {c: ComposerController}) {
  const list = useServerDrafts(c.session, c.backend)
  const save = useSaveServerDraft(c.session, c.backend)
  const del = useDeleteServerDraft(c.session, c.backend)
  const [busy, setBusy] = useState(false)
  if (!c.backend.serverDrafts) return null

  const restore = (d: ServerDraft) => {
    c.patch({
      text: d.text ?? '',
      cw: d.cw ?? '',
      cwEnabled: (d.cw ?? '') !== '',
      visibilityRaw: d.visibilityRaw ?? c.state.visibilityRaw,
      visibleUserIds: d.visibleUserIds ?? [],
      localOnly: d.localOnly ?? false,
      scheduledAt: d.scheduledAt ?? null,
      poll:
        d.poll && Array.isArray(d.poll.choices) && typeof d.poll.expiredAfter === 'number'
          ? {
              choices: d.poll.choices,
              multiple: d.poll.multiple ?? false,
              durationSeconds: Math.max(
                1,
                Math.round(
                  c.family === 'mastodon' ? d.poll.expiredAfter : d.poll.expiredAfter / 1000,
                ),
              ),
            }
          : null,
    })
    if (d.replyId || d.renoteId) void c.attachTargets(d.replyId ?? null, d.renoteId ?? null)
  }

  const saveCurrent = async () => {
    setBusy(true)
    try {
      const built = buildPostDraft(
        {...c.state, media: []},
        {family: c.family, gates: c.gates, limits: c.limits},
      )
      if (!built.ok) {
        c.setError(built.reason)
        return
      }
      await save.mutateAsync({draft: {...built.draft, scheduledAt: built.scheduledAt}})
    } catch (err) {
      c.setError(err instanceof Error ? err.message : i18n._(msg`Could not save the draft.`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{gap: space.sm}} testID="composer-server-drafts">
      <Caption color="muted">{i18n._(msg`Server drafts`)}</Caption>
      {list.isPending ? (
        <Loader testID="composer-server-drafts-loading" />
      ) : list.isError ? (
        <Caption color="faint">{i18n._(msg`Could not load server drafts.`)}</Caption>
      ) : list.data.length === 0 ? (
        <Caption color="muted">{i18n._(msg`No server drafts.`)}</Caption>
      ) : (
        list.data.map(d => (
          <View key={d.id} style={c.styles.row}>
            <Caption color="muted" testID={`composer-serverdraft-${d.id}`}>
              {serverDraftSnippet(d)}
            </Caption>
            <Chip
              label={i18n._(msg`Restore`)}
              onPress={() => restore(d)}
              testID={`composer-serverdraft-restore-${d.id}`}
            />
            <Chip
              label={i18n._(msg`Delete`)}
              disabled={del.isPending}
              onPress={() =>
                del.mutate(d.id, {
                  onError: err => c.setError(err instanceof Error ? err.message : i18n._(msg`Could not delete.`)),
                })
              }
              testID={`composer-serverdraft-del-${d.id}`}
            />
          </View>
        ))
      )}
      <View style={c.styles.row}>
        <Chip
          label={busy || save.isPending ? i18n._(msg`Saving…`) : i18n._(msg`Save current as server draft`)}
          disabled={busy || save.isPending}
          onPress={() => void saveCurrent()}
          testID="composer-serverdraft-save"
        />
      </View>
      {save.isError ? <Body testID="composer-serverdraft-error">{i18n._(msg`Could not save the draft.`)}</Body> : null}
    </View>
  )
}

export function SuggestEmojiSection({c}: {c: ComposerController}) {
  // E5: the dialog is a centered Modal — same Android keyboard-cover
  // problem as the compact popup. Dismiss on open; the search field
  // re-opens the keyboard on focus.
  useEffect(() => {
    if (c.pickingEmoji) Keyboard.dismiss()
  }, [c.pickingEmoji])
  return (
    <>
      <SuggestionList suggestions={c.suggestions} onPick={c.onPickSuggestion} />
      {c.pickingEmoji ? (
        <Dialog open onClose={() => c.setPickingEmoji(false)} title={i18n._(msg`Insert emoji`)} testID="composer-emoji-dialog">
          <EmojiPicker
            sessionId={c.session.id}
            onPick={e => {
              const at = Math.min(c.caret, c.state.text.length)
              c.patch({text: c.state.text.slice(0, at) + e.key + c.state.text.slice(at)})
              c.setCaret(at + e.key.length)
              c.setPickingEmoji(false)
            }}
          />
        </Dialog>
      ) : null}
    </>
  )
}
