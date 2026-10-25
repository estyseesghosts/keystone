// Post poll display + voting (v1 `NoteBody` PollBlock parity).
//
// Totals, voted check, expiry/multiple labels, and one-shot voting.
// Voting runs through the screen-supplied `onVote` (the live card binds
// it to `backend.votePoll`); without it the poll renders read-only.
// Failures render an honest inline error with a retry — never a toast
// and a stuck spinner.
import {Fragment, useEffect, useMemo, useRef, useState} from 'react'
import {StyleSheet, View} from 'react-native'

import {msg, plural} from '@lingui/macro'

import {splitNameEmojis, type Poll} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {CustomEmojiGlyph} from '#/components/EmojiImage'
import {Pressable} from '#/components/Pressable'
import {logger} from '#/lib/logger'
import {formatDate, formatNumber, resolveAppLocale} from '#/locale/format'
import {useI18n} from '#/locale/i18n'
import {useNow} from '#/locale/ticker'

const styles = StyleSheet.create({
  box: {borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 8, gap: 8},
  option: {borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 2},
  bar: {height: 4, borderRadius: 2, overflow: 'hidden'},
  fill: {height: '100%'},
  foot: {flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap'},
})

/** Closed at render time, not at adapt time (misskey M16): the server's
 * `expired` flag wins when set, otherwise the deadline in `expiresAt` is
 * read against the clock on every render — a cached row crosses to closed
 * without a refetch. `now` is injectable for tests. Pure. */
export function isPollClosed(poll: Pick<Poll, 'expired' | 'expiresAt'>, now = Date.now()): boolean {
  if (poll.expired) return true
  if (poll.expiresAt == null) return false
  const then = Date.parse(poll.expiresAt)
  return !Number.isNaN(then) && then <= now
}

/** Future-facing expiry label. `formatRelativeTime` is past-only
 * (post ages clamp futures to "now") — a poll closing tomorrow must
 * never read "closes now". The relative parts use
 * `Intl.RelativeTimeFormat` (no literals); distant deadlines use the
 * app-locale date. `locale`/`nowMs` are injectable for tests. Pure. */
export function formatPollExpiry(
  expiresAt: string | null,
  opts?: {locale?: string | null; nowMs?: number},
): string | null {
  if (!expiresAt) return null
  const then = Date.parse(expiresAt)
  if (Number.isNaN(then)) return null
  const nowMs = opts?.nowMs ?? Date.now()
  const tag = resolveAppLocale(opts?.locale)
  const diffSec = (then - nowMs) / 1000
  if (diffSec <= 0) return 'closing soon'
  const min = Math.floor(diffSec / 60)
  if (min < 1) return 'in under a minute'
  if (min < 60) {
    try {
      return new Intl.RelativeTimeFormat(tag, {style: 'narrow'}).format(min, 'minute')
    } catch {
      return `in ${min}m`
    }
  }
  const hours = Math.floor(min / 60)
  if (hours < 48) {
    try {
      return new Intl.RelativeTimeFormat(tag, {style: 'narrow'}).format(hours, 'hour')
    } catch {
      return `in ${hours}h`
    }
  }
  return `on ${formatDate(then, tag)}`
}

function PollBar({ratio}: {ratio: number}) {
  const theme = useTheme()
  return (
    <View style={[styles.bar, {backgroundColor: theme.palette.bgSoft}]}>
      <View style={[styles.fill, {width: `${Math.round(ratio * 100)}%`, backgroundColor: theme.palette.text}]} />
    </View>
  )
}

/** Choices a failed multi-choice vote already recorded: the Misskey
 * backend throws `errors.poll.partialVote` with `{recorded, total}`, so a
 * retry can send only the rest instead of blindly resending recorded
 * votes. Unknown errors record nothing — retry resends all (correct for
 * atomic endpoints like Mastodon's single-POST vote). Pure. */
function partialRecordedOf(err: unknown): number[] {
  if (typeof err === 'object' && err !== null) {
    const coded = err as {code?: unknown; params?: unknown}
    if (coded.code !== 'errors.poll.partialVote') return []
    const recorded = (coded.params as {recorded?: unknown} | undefined)?.recorded
    if (Array.isArray(recorded)) return recorded.filter((c): c is number => typeof c === 'number')
  }
  return []
}

function splitOptionCode(code: string): {name: string; host: string | null} {
  const inner = code.replace(/^:|:$/g, '')
  const at = inner.indexOf('@')
  if (at < 0) return {name: inner, host: null}
  return {name: inner.slice(0, at), host: inner.slice(at + 1) || null}
}

function OptionTitle({
  text,
  emojis,
  sessionId,
  authorHost,
  size,
}: {
  text: string
  emojis: Record<string, string>
  sessionId: string | null
  authorHost: string | null
  size: number
}) {
  const parts = useMemo(() => splitNameEmojis(text), [text])
  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === 'text') return <Fragment key={i}>{part.text}</Fragment>
        const {name, host} = splitOptionCode(part.code)
        return (
          <CustomEmojiGlyph
            key={i}
            name={name}
            host={host}
            src={null}
            packed={emojis}
            sessionId={sessionId}
            authorHost={authorHost}
            size={size}
          />
        )
      })}
    </>
  )
}

export function PostPoll({
  poll,
  onVote,
  emojis,
  sessionId,
  authorHost,
  testID,
}: {
  poll: Poll
  /** Submit the chosen option indexes. Omit = read-only display. */
  onVote?: (choices: number[]) => Promise<void>
  /** Packed custom-emoji map for option titles (`:code:` renders as a
   * glyph through the shared pipeline; unknown codes stay literal). */
  emojis?: Record<string, string> | null
  /** Owning session for remote-emoji fallback (packed-only when null). */
  sessionId?: string | null
  /** Origin host hint for host-less codes in remote-authored polls. */
  authorHost?: string | null
  testID?: string
}) {
  const theme = useTheme()
  const i18n = useI18n()
  const nowMs = useNow()
  const alreadyVoted = poll.options.some(o => o.voted)
  const [selected, setSelected] = useState<number[]>(() =>
    poll.options.flatMap((o, i) => (o.voted ? [i] : [])),
  )
  const [voted, setVoted] = useState(alreadyVoted)
  // Choices the server confirmed before a partial failure. A retry sends
  // only `selected` minus these — never a blind resend of recorded votes.
  const [recorded, setRecorded] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const closed = isPollClosed(poll)
  const locked = voted || closed || !onVote

  // Resync when the server's voted flags change (vote recorded elsewhere,
  // refetch after voting, poll closed remotely). The signature guard keeps
  // local unsubmitted picks across pure count updates — only a flags
  // change resets the selection. The `useState` initializers above are the
  // first render only; this effect is the resync source.
  const votedSigRef = useRef<string | null>(null)
  useEffect(() => {
    const sig = poll.options.map(o => (o.voted ? '1' : '0')).join(',')
    if (votedSigRef.current === sig) return
    votedSigRef.current = sig
    setSelected(poll.options.flatMap((o, i) => (o.voted ? [i] : [])))
    setVoted(poll.options.some(o => o.voted))
  }, [poll.options])

  const pending = selected.filter(c => !recorded.includes(c))

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
    if (!onVote || voted || closed || busy || pending.length === 0) return
    setBusy(true)
    setFailed(false)
    try {
      await onVote([...pending].sort((a, b) => a - b))
      setVoted(true)
      setRecorded([])
    } catch (e) {
      // Friendly line in the UI; the redacted reason goes to the logger
      // for diagnosis (never a stuck spinner, never a raw dump).
      logger.warn('[PostPoll] vote failed', e)
      setFailed(true)
      const round = partialRecordedOf(e)
      if (round.length > 0) setRecorded(prev => [...prev, ...round.filter(c => !prev.includes(c))])
    } finally {
      setBusy(false)
    }
  }

  const foot: string[] = []
  const hiddenLabel = i18n._(msg`Hidden until closed`)
  if (total !== null) foot.push(i18n._(plural(total, {one: '# vote', other: '# votes'})))
  else foot.push(hiddenLabel)
  if (poll.votersCount !== null && poll.votersCount !== total)
    foot.push(i18n._(plural(poll.votersCount, {one: '# voter', other: '# voters'})))
  if (poll.multiple) foot.push('multiple choice')
  if (closed) foot.push('closed')
  else if (poll.expiresAt) {
    const label = formatPollExpiry(poll.expiresAt, {locale: i18n.locale, nowMs})
    if (label) foot.push(`closes ${label}`)
  }

  const packed = emojis ?? {}
  const emojiSize = 15 * theme.fontScaleMultiplier + 2

  return (
    <View style={[styles.box, {borderColor: theme.palette.edge, backgroundColor: theme.palette.bg}]} testID={testID}>
      {poll.options.map((opt, i) => {
        const mine = voted ? selected.includes(i) || opt.voted : selected.includes(i)
        // A null count is hidden, not zero (ADR 0013): no bar, no fake
        // number, and an honest accessibility label.
        const showBar = opt.votesCount !== null && total !== null && total > 0
        const ratio =
          opt.votesCount !== null && total !== null && total > 0 ? opt.votesCount / total : 0
        const countLabel =
          opt.votesCount !== null
            ? i18n._(plural(opt.votesCount, {one: '# vote', other: '# votes'}))
            : hiddenLabel
        return (
          <Pressable
            key={i}
            testID={`poll-option-${i}`}
            onPress={() => toggle(i)}
            disabled={locked || busy}
            accessibilityRole={poll.multiple ? 'checkbox' : 'radio'}
            accessibilityState={{disabled: locked || busy, selected: mine}}
            accessibilityLabel={`${opt.text}, ${countLabel}${opt.voted || (voted && selected.includes(i)) ? ', your vote' : ''}`}>
            <View style={[styles.option, {borderColor: mine ? theme.palette.text : theme.palette.edge}]}>
              <Body numberOfLines={2}>
                {(opt.voted || (voted && selected.includes(i))) && '✓ '}
                <OptionTitle
                  text={opt.text}
                  emojis={packed}
                  sessionId={sessionId ?? null}
                  authorHost={authorHost ?? null}
                  size={emojiSize}
                />
              </Body>
              <Caption color="muted">
                {opt.votesCount !== null ? formatNumber(i18n.locale, opt.votesCount) : hiddenLabel}
              </Caption>
              {showBar ? <PollBar ratio={ratio} /> : null}
            </View>
          </Pressable>
        )
      })}
      {foot.length > 0 && (
        <Caption color="muted" testID="poll-meta">
          {foot.join(' · ')}
        </Caption>
      )}
      {failed && recorded.length === 0 && (
        <Body testID="poll-error">{i18n._(msg`Couldn't submit your vote. Try again.`)}</Body>
      )}
      {failed && recorded.length > 0 && (
        <Body testID="poll-error">
          {i18n._(
            msg`Recorded ${recorded.length} of ${selected.length} choices. Retry sends only the rest.`,
          )}
        </Body>
      )}
      {!locked && (
        <Pressable
          testID="poll-vote"
          onPress={() => void submit()}
          disabled={busy || pending.length === 0}
          accessibilityRole="button"
          accessibilityLabel={busy ? i18n._(msg`Submitting vote…`) : i18n._(msg`Vote`)}
          accessibilityState={{disabled: busy || pending.length === 0}}>
          <Body>{busy ? i18n._(msg`Submitting…`) : i18n._(msg`Vote`)}</Body>
        </Pressable>
      )}
    </View>
  )
}
