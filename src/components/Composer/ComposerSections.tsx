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
  return (
    <TextField
      label="Post at (ISO time)"
      value={c.state.scheduledAt}
      onChangeText={scheduledAt => c.patch({scheduledAt})}
      testID="composer-schedule-at"
    />
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
