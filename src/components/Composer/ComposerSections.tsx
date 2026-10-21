import {useState} from 'react'
import {Image, View} from 'react-native'

import {space} from '#/alf/tokens'
import {Caption} from '#/alf/typography'
import {TextField} from '#/components/forms/TextField'
import {Dialog} from '#/components/Dialog'
import {EmojiPicker} from '#/components/EmojiPicker'

import {Chip} from './Chip'
import type {ComposerController} from './Composer'
import {SuggestionList} from './Autocomplete'

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
      label="Content warning"
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
          label={`Choice ${i + 1}`}
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
            label="Add choice"
            onPress={() => c.patch({poll: {...c.state.poll!, choices: [...c.state.poll!.choices, '']}})}
          />
        ) : null}
        {c.state.poll.choices.length > 2 ? (
          <Chip
            label="Remove last"
            onPress={() => c.patch({poll: {...c.state.poll!, choices: c.state.poll!.choices.slice(0, -1)}})}
          />
        ) : null}
        <Chip
          label="Multiple choice"
          selected={c.state.poll.multiple}
          disabled={!c.gates.pollMultiple.enabled}
          disabledReason={c.gates.pollMultiple.enabled ? undefined : c.gates.pollMultiple.reason}
          onPress={() => c.patch({poll: {...c.state.poll!, multiple: !c.state.poll!.multiple}})}
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
                ? 'ready to upload'
                : u.status === 'uploading'
                  ? 'uploading...'
                  : u.status === 'done'
                    ? 'uploaded'
                    : (u.error ?? 'failed')}
            </Caption>
            <TextField
              label="Description (alt text)"
              value={u.alt}
              onChangeText={t => c.uploads.setAlt(u.key, t)}
              placeholder={u.status === 'done' ? 'Locked after upload' : 'Describe the media'}
            />
          </View>
          <Chip label="Remove" onPress={() => c.uploads.remove(u.key)} />
        </View>
      ))}
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
        label="Post at (ISO time)"
        value={c.state.scheduledAt}
        onChangeText={scheduledAt => c.patch({scheduledAt})}
        testID="composer-schedule-at"
      />
      <View style={c.styles.row}>
        <Chip
          label="In 1 hour"
          onPress={() => c.patch({scheduledAt: new Date(Date.now() + 3600_000).toISOString()})}
          testID="composer-schedule-in1h"
        />
        <Chip
          label="Tomorrow 9:00"
          onPress={() => c.patch({scheduledAt: tomorrowNine()})}
          testID="composer-schedule-tomorrow"
        />
        <Chip
          label="Next week 9:00"
          onPress={() => c.patch({scheduledAt: nextWeekNine()})}
          testID="composer-schedule-nextweek"
        />
      </View>
      {invalid ? (
        <Caption testID="composer-schedule-invalid">
          Scheduled time must be in the future.
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
      setError(`Could not resolve "${raw}".`)
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
        setError(`Could not resolve "${raw}".`)
        return
      }
      if (!c.state.visibleUserIds.includes(id)) {
        c.patch({visibleUserIds: [...c.state.visibleUserIds, id]})
      }
      setInput('')
      setError(null)
    } catch (err) {
      // Keep the raw text so the user can retry or edit it.
      setError(err instanceof Error ? err.message : `Could not resolve "${raw}".`)
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
        label="Add recipient"
        value={input}
        onChangeText={t => {
          setInput(t)
          if (error) setError(null)
        }}
        placeholder="@user or @user@host"
        testID="composer-recipient-input"
      />
      <View style={c.styles.row}>
        <Chip
          label={resolving ? 'Adding…' : 'Add'}
          onPress={() => {
            void add()
          }}
          testID="composer-recipient-add"
        />
      </View>
      {error ? <Caption testID="composer-recipient-error">{error}</Caption> : null}
      {!canResolve ? (
        <Caption color="muted">IDs are sent verbatim on this server.</Caption>
      ) : null}
    </View>
  )
}

export function DraftsSection({c}: {c: ComposerController}) {
  if (c.drafts.length === 0) {
    return c.showDrafts ? <Caption color="muted">No saved drafts.</Caption> : null
  }
  return (
    <View style={{gap: space.sm}} testID="composer-drafts">
      {c.drafts.map(d => (
        <Chip key={d.id} label={d.text.slice(0, 40) || '(poll / CW only)'} onPress={() => c.restore(d)} />
      ))}
    </View>
  )
}

export function SuggestEmojiSection({c}: {c: ComposerController}) {
  return (
    <>
      <SuggestionList suggestions={c.suggestions} onPick={c.onPickSuggestion} />
      {c.pickingEmoji ? (
        <Dialog open onClose={() => c.setPickingEmoji(false)} title="Insert emoji" testID="composer-emoji-dialog">
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
