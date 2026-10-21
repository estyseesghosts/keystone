// Post poll display + voting (v1 `NoteBody` PollBlock parity).
//
// Totals, voted check, expiry/multiple labels, and one-shot voting.
// Voting runs through the screen-supplied `onVote` (the live card binds
// it to `backend.votePoll`); without it the poll renders read-only.
// Failures render an honest inline error with a retry — never a toast
// and a stuck spinner.
import {useState} from 'react'
import {StyleSheet, View} from 'react-native'

import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'

import type {Poll} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'

const styles = StyleSheet.create({
  box: {borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 8, gap: 8},
  option: {borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 2},
  bar: {height: 4, borderRadius: 2, overflow: 'hidden'},
  fill: {height: '100%'},
  foot: {flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap'},
})

/** Future-facing expiry label. `formatRelativeTime` is past-only
 * (post ages clamp futures to "now") — a poll closing tomorrow must
 * never read "closes now". Pure. */
export function formatPollExpiry(expiresAt: string | null): string | null {
  if (!expiresAt) return null
  const then = Date.parse(expiresAt)
  if (Number.isNaN(then)) return null
  const diffSec = (then - Date.now()) / 1000
  if (diffSec <= 0) return 'closing soon'
  const min = Math.floor(diffSec / 60)
  if (min < 1) return 'in under a minute'
  if (min < 60) return `in ${min}m`
  const hours = Math.floor(min / 60)
  if (hours < 48) return `in ${hours}h`
  return `on ${new Date(then).toLocaleDateString()}`
}

function PollBar({ratio}: {ratio: number}) {
  const theme = useTheme()
  return (
    <View style={[styles.bar, {backgroundColor: theme.palette.bgSoft}]}>
      <View style={[styles.fill, {width: `${Math.round(ratio * 100)}%`, backgroundColor: theme.palette.text}]} />
    </View>
  )
}

export function PostPoll({
  poll,
  onVote,
  testID,
}: {
  poll: Poll
  /** Submit the chosen option indexes. Omit = read-only display. */
  onVote?: (choices: number[]) => Promise<void>
  testID?: string
}) {
  const theme = useTheme()
  const {i18n} = useLingui()
  const alreadyVoted = poll.options.some(o => o.voted)
  const [selected, setSelected] = useState<number[]>(() =>
    poll.options.flatMap((o, i) => (o.voted ? [i] : [])),
  )
  const [voted, setVoted] = useState(alreadyVoted)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const closed = poll.expired
  const locked = voted || closed || !onVote

  const total = poll.votesCount
  const toggle = (i: number) => {
    if (locked || busy) return
    setFailed(false)
    setSelected(prev =>
      poll.multiple
        ? prev.includes(i)
          ? prev.filter(x => x !== i)
          : [...prev, i]
        : [i],
    )
  }

  const submit = async () => {
    if (!onVote || voted || closed || busy || selected.length === 0) return
    setBusy(true)
    setFailed(false)
    try {
      await onVote([...selected].sort((a, b) => a - b))
      setVoted(true)
    } catch (e) {
      // Friendly line in the UI; the raw reason goes to the console
      // for diagnosis (never a stuck spinner, never a raw dump).
      console.error('[PostPoll] vote failed', e)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const foot: string[] = []
  if (total !== null) foot.push(`${total} vote${total === 1 ? '' : 's'}`)
  if (poll.votersCount !== null && poll.votersCount !== total)
    foot.push(`${poll.votersCount} voter${poll.votersCount === 1 ? '' : 's'}`)
  if (poll.multiple) foot.push('multiple choice')
  if (closed) foot.push('closed')
  else if (poll.expiresAt) {
    const label = formatPollExpiry(poll.expiresAt)
    if (label) foot.push(`closes ${label}`)
  }

  return (
    <View style={[styles.box, {borderColor: theme.palette.edge}]} testID={testID}>
      {poll.options.map((opt, i) => {
        const mine = voted ? selected.includes(i) || opt.voted : selected.includes(i)
        const ratio = total !== null && total > 0 ? opt.votesCount / total : 0
        return (
          <Pressable
            key={i}
            testID={`poll-option-${i}`}
            onPress={() => toggle(i)}
            disabled={locked || busy}
            accessibilityRole={poll.multiple ? 'checkbox' : 'radio'}
            accessibilityState={{disabled: locked || busy, selected: mine}}
            accessibilityLabel={`${opt.text}, ${opt.votesCount} votes${opt.voted || (voted && selected.includes(i)) ? ', your vote' : ''}`}>
            <View style={[styles.option, {borderColor: mine ? theme.palette.text : theme.palette.edge}]}>
              <Body numberOfLines={2}>
                {(opt.voted || (voted && selected.includes(i))) && '✓ '}
                {opt.text}
              </Body>
              <Caption color="muted">{opt.votesCount}</Caption>
              <PollBar ratio={ratio} />
            </View>
          </Pressable>
        )
      })}
      {foot.length > 0 && (
        <Caption color="muted" testID="poll-meta">
          {foot.join(' · ')}
        </Caption>
      )}
      {failed && <Body testID="poll-error">{i18n._(msg`Couldn't submit your vote. Try again.`)}</Body>}
      {!locked && (
        <Pressable
          testID="poll-vote"
          onPress={() => void submit()}
          disabled={busy || selected.length === 0}
          accessibilityRole="button"
          accessibilityLabel={busy ? i18n._(msg`Submitting vote…`) : i18n._(msg`Vote`)}
          accessibilityState={{disabled: busy || selected.length === 0}}>
          <Body>{busy ? i18n._(msg`Submitting…`) : i18n._(msg`Vote`)}</Body>
        </Pressable>
      )}
    </View>
  )
}
