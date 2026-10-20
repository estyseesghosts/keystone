import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Image, ScrollView, StyleSheet, TextInput, View} from 'react-native'

import {
  applyCompletion,
  buildPostDraft,
  composeDefaultsFor,
  composeGates,
  countComposeChars,
  defaultVisibilityFor,
  emptyComposeState,
  visibilityOptionsFor,
  REACTION_ACCEPTANCE_LABELS,
  type Backend,
  type ComposeState,
  type KeyValueStore,
  type Post,
  type ReactionAcceptance,
  type Session,
} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {radius, space, typeSize} from '#/alf/tokens'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import {
  useComposeLimits,
  useCreatePost,
  useSessionCustomEmojis,
  useUploads,
} from '#/state/queries/composer'
import {
  deleteDraft,
  listDrafts,
  newDraftId,
  saveDraft,
  type LocalDraft,
} from '#/storage/drafts'

import {SuggestionList, useSuggestions, type Suggestion} from './Autocomplete'
import {Dialog} from '#/components/Dialog'
import {EmojiPicker} from '#/components/EmojiPicker'
import {Chip} from './Chip'
import {pickMedia} from './pickMedia'

// Composer (slice 4.3). Posts only through the owning session's backend.
// Every optional control is gated by `composeGates` (capabilities + backend
// sub-modules): unsupported controls are hidden or disabled WITH a reason.

const POLL_DURATIONS: Array<{label: string; seconds: number}> = [
  {label: '5 min', seconds: 300},
  {label: '1 hour', seconds: 3600},
  {label: '1 day', seconds: 86400},
  {label: '7 days', seconds: 604800},
]

export interface ComposerProps {
  session: Session
  backend: Backend
  /** Draft store (MMKV in the app; memory in tests). */
  store: KeyValueStore
  replyTo?: Post | null
  quote?: Post | null
  /** Restore this local draft on open. */
  draftId?: string | null
  onClose: () => void
  onPosted?: (kind: 'posted' | 'scheduled') => void
}

function stateFromDraft(d: LocalDraft): Partial<ComposeState> {
  return {
    text: d.text,
    cw: d.cw,
    cwEnabled: d.cwEnabled,
    visibilityRaw: d.visibilityRaw,
    localOnly: d.localOnly,
    poll: d.pollChoices
      ? {choices: d.pollChoices, multiple: d.pollMultiple, durationSeconds: d.pollDurationSeconds}
      : null,
    reactionAcceptance: d.reactionAcceptance,
    scheduledAt: d.scheduledAt,
  }
}

export function Composer({
  session,
  backend,
  store,
  replyTo = null,
  quote = null,
  draftId = null,
  onClose,
  onPosted,
}: ComposerProps) {
  const theme = useTheme()
  const family = session.family
  const gates = useMemo(
    () => composeGates(family, backend.capabilities, backend),
    [family, backend],
  )
  const limitsQuery = useComposeLimits(session)
  const limits = limitsQuery.data ?? composeDefaultsFor(family)
  const emojis = useSessionCustomEmojis(session, backend)
  const uploads = useUploads(backend)
  const create = useCreatePost(session, backend)

  const [id] = useState(() => draftId ?? newDraftId())
  const [state, setState] = useState<ComposeState>(() => {
    const restored = draftId ? listDrafts(store, session.id).find(d => d.id === draftId) : null
    return emptyComposeState({
      visibilityRaw: defaultVisibilityFor(family, replyTo).raw,
      replyTo,
      quote,
      ...(restored ? stateFromDraft(restored) : {}),
    })
  })
  const [caret, setCaret] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showDrafts, setShowDrafts] = useState(false)
  const [pickingEmoji, setPickingEmoji] = useState(false)
  const patch = useCallback((p: Partial<ComposeState>) => setState(s => ({...s, ...p})), [])

  // Autosave (debounced). Keyed by session id; cleared on post.
  const postedRef = useRef(false)
  useEffect(() => {
    if (postedRef.current) return
    const timer = setTimeout(() => {
      saveDraft(store, session.id, {
        id,
        updatedAt: Date.now(),
        text: state.text,
        cw: state.cw,
        cwEnabled: state.cwEnabled,
        visibilityRaw: state.visibilityRaw,
        localOnly: state.localOnly,
        replyToId: state.replyTo?.id ?? null,
        quoteId: state.quote?.id ?? null,
        pollChoices: state.poll?.choices ?? null,
        pollMultiple: state.poll?.multiple ?? false,
        pollDurationSeconds: state.poll?.durationSeconds ?? 86400,
        reactionAcceptance: state.reactionAcceptance,
        scheduledAt: state.scheduledAt,
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [state, store, session.id, id])

  const {trigger, suggestions} = useSuggestions(state.text, caret, backend, emojis.data)
  const onPickSuggestion = (s: Suggestion) => {
    if (!trigger) return
    const next = applyCompletion(state.text, trigger, s.insert)
    patch({text: next.text})
    setCaret(next.caret)
  }

  const count = countComposeChars(family, state.text)
  const over = count > limits.maxChars
  const options = visibilityOptionsFor(family)
  const mediaFull = uploads.items.length >= limits.maxMedia
  const pollBlockedByMedia = uploads.items.length > 0
  const mediaBlockedByPoll = !!state.poll

  const submit = async () => {
    setError(null)
    // Validate text rules first (media ids are filled after upload).
    const pre = buildPostDraft(
      {...state, media: uploads.items.map(u => ({id: u.mediaId ?? u.key, alt: u.alt}))},
      {family, gates, limits},
    )
    if (!pre.ok) {
      setError(pre.reason)
      return
    }
    setBusy(true)
    try {
      let mediaIds: string[] = []
      if (uploads.items.length > 0) {
        const ids = await uploads.ensureUploaded()
        if (!ids) {
          setError('Some attachments failed to upload. Retry or remove them.')
          return
        }
        mediaIds = ids
      }
      const built = buildPostDraft(
        {...state, media: mediaIds.map(m => ({id: m, alt: ''}))},
        {family, gates, limits},
      )
      if (!built.ok) {
        setError(built.reason)
        return
      }
      const result = await create.mutateAsync({draft: built.draft, scheduledAt: built.scheduledAt})
      postedRef.current = true
      deleteDraft(store, session.id, id)
      onPosted?.(result.kind)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post.')
    } finally {
      setBusy(false)
    }
  }

  const addMedia = async () => {
    try {
      const picked = await pickMedia({limit: limits.maxMedia - uploads.items.length})
      if (picked.length > 0) uploads.add(picked)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the media picker.')
    }
  }

  const styles = StyleSheet.create({
    root: {padding: space.lg, gap: space.md},
    input: {
      minHeight: 120,
      borderWidth: 1,
      borderColor: theme.palette.edge,
      borderRadius: radius.md,
      padding: space.md,
      color: theme.palette.text,
      backgroundColor: theme.palette.bg,
      fontSize: typeSize.body,
      textAlignVertical: 'top',
    },
    row: {flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center'},
    spread: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
    thumb: {width: 56, height: 56, borderRadius: radius.sm, backgroundColor: theme.palette.raise},
    media: {flexDirection: 'row', gap: space.sm, alignItems: 'flex-start'},
    context: {
      borderWidth: 1,
      borderColor: theme.palette.border,
      borderRadius: radius.md,
      padding: space.sm,
    },
  })

  const restore = (d: LocalDraft) => {
    setState(s => ({...s, ...stateFromDraft(d)}))
    setShowDrafts(false)
  }
  const drafts = showDrafts ? listDrafts(store, session.id).filter(d => d.id !== id) : []

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      <View style={styles.spread}>
        <Button label="Cancel" variant="secondary" onPress={onClose} testID="composer-cancel" />
        <Button
          label={state.scheduledAt && gates.schedule.enabled ? 'Schedule' : 'Post'}
          onPress={submit}
          disabled={busy || over}
          disabledReason={over ? 'Over the character limit.' : busy ? 'Posting...' : undefined}
          testID="composer-submit"
        />
      </View>

      {replyTo ? (
        <View style={styles.context} testID="composer-reply-context">
          <Caption color="muted">Replying to @{replyTo.author.acct}</Caption>
        </View>
      ) : null}
      {quote ? (
        <View style={styles.context} testID="composer-quote-context">
          <Caption color="muted">Quoting @{quote.author.acct}</Caption>
        </View>
      ) : null}

      {state.cwEnabled ? (
        <TextField
          label="Content warning"
          value={state.cw}
          onChangeText={cw => patch({cw})}
          testID="composer-cw"
        />
      ) : null}

      <TextInput
        testID="composer-text"
        multiline
        value={state.text}
        onChangeText={text => patch({text})}
        onSelectionChange={e => setCaret(e.nativeEvent.selection.end)}
        placeholder={replyTo ? 'Write your reply' : "What's happening?"}
        placeholderTextColor={theme.palette.faint}
        accessibilityLabel="Post text"
        style={styles.input}
      />
      <SuggestionList suggestions={suggestions} onPick={onPickSuggestion} />
      {pickingEmoji ? (
        <Dialog open onClose={() => setPickingEmoji(false)} title="Insert emoji" testID="composer-emoji-dialog">
          <EmojiPicker
            sessionId={session.id}
            onPick={e => {
              const at = Math.min(caret, state.text.length)
              patch({text: state.text.slice(0, at) + e.key + state.text.slice(at)})
              setCaret(at + e.key.length)
              setPickingEmoji(false)
            }}
          />
        </Dialog>
      ) : null}

      <View style={styles.spread}>
        <Caption color={over ? 'text' : 'muted'} testID="composer-counter">
          {count} / {limits.maxChars}
        </Caption>
        {over ? <Caption>Over the limit</Caption> : null}
      </View>

      {error ? (
        <Body testID="composer-error" accessibilityRole="alert">
          {error}
        </Body>
      ) : null}

      <Caption color="muted">Audience</Caption>
      <View style={styles.row}>
        {options.map(o => (
          <Chip
            key={o.raw}
            label={o.label}
            selected={state.visibilityRaw === o.raw}
            onPress={() => patch({visibilityRaw: o.raw})}
            testID={`composer-vis-${o.raw}`}
          />
        ))}
        {gates.localOnly.enabled ? (
          <Chip
            label="Local only"
            selected={state.localOnly}
            onPress={() => patch({localOnly: !state.localOnly})}
            testID="composer-local-only"
          />
        ) : null}
      </View>

      <View style={styles.row}>
        <Chip label="Emoji" onPress={() => setPickingEmoji(true)} testID="composer-emoji-button" />
        <Chip
          label="CW"
          selected={state.cwEnabled}
          onPress={() => patch({cwEnabled: !state.cwEnabled})}
          testID="composer-cw-toggle"
        />
        <Chip
          label="Poll"
          selected={!!state.poll}
          disabled={!gates.poll.enabled || (!state.poll && pollBlockedByMedia)}
          disabledReason={
            !gates.poll.enabled
              ? gates.poll.reason
              : 'A post cannot have both media and a poll.'
          }
          onPress={() =>
            patch({
              poll: state.poll ? null : {choices: ['', ''], multiple: false, durationSeconds: 86400},
            })
          }
          testID="composer-poll-toggle"
        />
        <Chip
          label="Media"
          disabled={mediaFull || mediaBlockedByPoll}
          disabledReason={
            mediaBlockedByPoll ? 'A post cannot have both media and a poll.' : 'Attachment limit reached.'
          }
          onPress={addMedia}
          testID="composer-media-add"
        />
        {gates.schedule.enabled ? (
          <Chip
            label="Schedule"
            selected={state.scheduledAt != null}
            onPress={() =>
              patch({
                scheduledAt: state.scheduledAt ? null : new Date(Date.now() + 3600_000).toISOString(),
              })
            }
            testID="composer-schedule-toggle"
          />
        ) : null}
        <Chip label="Drafts" onPress={() => setShowDrafts(v => !v)} testID="composer-drafts-toggle" />
      </View>

      {state.scheduledAt && gates.schedule.enabled ? (
        <TextField
          label="Post at (ISO time)"
          value={state.scheduledAt}
          onChangeText={scheduledAt => patch({scheduledAt})}
          testID="composer-schedule-at"
        />
      ) : null}

      {gates.reactionAcceptance.enabled ? (
        <View style={styles.row}>
          <Caption color="muted">Reactions</Caption>
          <Chip
            label="All"
            selected={state.reactionAcceptance == null}
            onPress={() => patch({reactionAcceptance: null})}
          />
          {(Object.keys(REACTION_ACCEPTANCE_LABELS) as ReactionAcceptance[]).map(k => (
            <Chip
              key={k}
              label={REACTION_ACCEPTANCE_LABELS[k]}
              selected={state.reactionAcceptance === k}
              onPress={() => patch({reactionAcceptance: k})}
            />
          ))}
        </View>
      ) : null}

      {state.poll ? (
        <View style={{gap: space.sm}} testID="composer-poll">
          {state.poll.choices.map((c, i) => (
            <TextField
              key={i}
              label={`Choice ${i + 1}`}
              value={c}
              onChangeText={t =>
                patch({
                  poll: {...state.poll!, choices: state.poll!.choices.map((x, j) => (j === i ? t : x))},
                })
              }
            />
          ))}
          <View style={styles.row}>
            {state.poll.choices.length < limits.maxPollOptions ? (
              <Chip
                label="Add choice"
                onPress={() => patch({poll: {...state.poll!, choices: [...state.poll!.choices, '']}})}
              />
            ) : null}
            {state.poll.choices.length > 2 ? (
              <Chip
                label="Remove last"
                onPress={() => patch({poll: {...state.poll!, choices: state.poll!.choices.slice(0, -1)}})}
              />
            ) : null}
            <Chip
              label="Multiple choice"
              selected={state.poll.multiple}
              disabled={!gates.pollMultiple.enabled}
              disabledReason={gates.pollMultiple.enabled ? undefined : gates.pollMultiple.reason}
              onPress={() => patch({poll: {...state.poll!, multiple: !state.poll!.multiple}})}
            />
          </View>
          <View style={styles.row}>
            {POLL_DURATIONS.map(d => (
              <Chip
                key={d.seconds}
                label={d.label}
                selected={state.poll!.durationSeconds === d.seconds}
                onPress={() => patch({poll: {...state.poll!, durationSeconds: d.seconds}})}
              />
            ))}
          </View>
        </View>
      ) : null}

      {uploads.items.map(u => (
        <View key={u.key} style={styles.media} testID={`composer-upload-${u.key}`}>
          {u.previewUri ? (
            <Image source={{uri: u.previewUri}} style={styles.thumb} accessibilityLabel={u.alt || u.name} />
          ) : (
            <View style={styles.thumb} />
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
              onChangeText={t => uploads.setAlt(u.key, t)}
              placeholder={u.status === 'done' ? 'Locked after upload' : 'Describe the media'}
            />
          </View>
          <Chip label="Remove" onPress={() => uploads.remove(u.key)} />
        </View>
      ))}

      {drafts.length > 0 ? (
        <View style={{gap: space.sm}} testID="composer-drafts">
          {drafts.map(d => (
            <Chip key={d.id} label={d.text.slice(0, 40) || '(poll / CW only)'} onPress={() => restore(d)} />
          ))}
        </View>
      ) : showDrafts ? (
        <Caption color="muted">No saved drafts.</Caption>
      ) : null}
    </ScrollView>
  )
}
