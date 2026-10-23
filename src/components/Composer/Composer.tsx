import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {ScrollView, StyleSheet, TextInput, View} from 'react-native'

import {msg} from '@lingui/macro'

import {
  ApiError,
  applyCompletion,
  buildPostDraft,
  composeDefaultsFor,
  composeGates,
  countComposeChars,
  defaultVisibilityFor,
  emptyComposeState,
  pendingMediaUpdates,
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
import {i18n} from '#/locale/i18n'
import {
  useComposeLimits,
  useCreatePost,
  useEditPost,
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

import {useSuggestions, type Suggestion} from './Autocomplete'
import {useAutogrowInput, autogrowStyle} from './useAutogrowInput'
import {Chip} from './Chip'
import {
  CwSection,
  DraftsSection,
  PollSection,
  RecipientSection,
  ScheduledListSection,
  ScheduleSection,
  SeededMediaSection,
  ServerDraftsSection,
  SuggestEmojiSection,
  UploadsSection,
} from './ComposerSections'
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

// Sheet keyboard helpers (C2/C3): pure, jest-covered. The sheet's
// KeyboardAvoidingView already offsets on iOS; these drive the native-only
// maxHeight/padding adjustments from keyboard show/hide listeners so the
// toolbar/input stay above the keyboard. Web returns 0/undefined (CSS
// handles it there) and non-mobile shells keep their centered card.
export function sheetKeyboardInset(platformOS: string, keyboardHeight: number): number {
  if (platformOS === 'web') return 0
  if (!Number.isFinite(keyboardHeight) || keyboardHeight <= 0) return 0
  return keyboardHeight
}

export function sheetVisibleMaxHeight(
  platformOS: string,
  layout: string,
  windowHeight: number,
  keyboardHeight: number,
): number | undefined {
  if (platformOS === 'web' || layout !== 'mobile') return undefined
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return undefined
  return Math.max(0, windowHeight - sheetKeyboardInset(platformOS, keyboardHeight))
}

export interface ComposerProps {
  session: Session
  backend: Backend
  /** Draft store (MMKV in the app; memory in tests). */
  store: KeyValueStore
  replyTo?: Post | null
  quote?: Post | null
  /** Edit mode: seed text/CW/visibility from this post and save via
   * `backend.editPost` instead of creating. Reply/quote/schedule/poll
   * controls are hidden — the server keeps what the edit does not send.
   * The post's attachments seed the description editor so alt text is
   * editable after upload (clickstone §1.7). */
  editing?: Post | null
  /** Delete-and-redraft seed (clickstone §1.7): a composer seed produced by
   * `redraftSeedOf` for a post that is ALREADY deleted. Seeds create mode
   * (text/CW/visibility/localOnly/media/reply/quote), never edit mode. */
  redraftSeed?: Partial<ComposeState> | null
  /** Restore this local draft on open. */
  draftId?: string | null
  /** Drive folder for uploads made from this composer (Misskey family).
   * Omitted/`null` is the Drive root — the wire field is not sent. The
   * composer has no folder picker yet; a caller that has a target (e.g. a
   * folder-scoped screen) passes it here. */
  uploadFolderId?: string | null
  /** Dismiss the composer. Omit for the inline (home) composer, which has
   * no Cancel button — it stays mounted like the reference client. */
  onClose?: () => void
  onPosted?: (kind: 'posted' | 'scheduled') => void
}

function stateFromDraft(d: LocalDraft): Partial<ComposeState> {
  return {
    text: d.text,
    cw: d.cw,
    cwEnabled: d.cwEnabled,
    visibilityRaw: d.visibilityRaw,
    visibleUserIds: d.visibleUserIds,
    localOnly: d.localOnly,
    poll: d.pollChoices
      ? {
          choices: d.pollChoices,
          multiple: d.pollMultiple,
          durationSeconds: d.pollDurationSeconds,
          hideTotals: d.pollHideTotals,
        }
      : null,
    reactionAcceptance: d.reactionAcceptance,
    noQuote: d.noQuote,
    scheduledAt: d.scheduledAt,
  }
}

export function useComposerController({
  session,
  backend,
  store,
  replyTo = null,
  quote = null,
  editing = null,
  redraftSeed = null,
  draftId = null,
  uploadFolderId = null,
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
  const uploads = useUploads(backend, {folderId: uploadFolderId})
  const create = useCreatePost(session, backend)
  const edit = useEditPost(session, backend)

  const [id] = useState(() => draftId ?? newDraftId())
  const [state, setState] = useState<ComposeState>(() => {
    if (redraftSeed) {
      // Redraft (clickstone §1.7): the post is gone; the seed is the
      // composer's only source. Media rows keep their server ids AND their
      // current alt text, so the description editor starts from the truth.
      return emptyComposeState(redraftSeed)
    }
    if (editing) {
      // Edit mode seeds from the post, never from a draft: the text is the
      // source MFM where the server packed it (plain otherwise), the CW
      // re-arms when present, and the visibility round-trips verbatim.
      // Attachments seed the description editor with their CURRENT alt text
      // (the old `alt: ''` passthrough silently dropped captions on save).
      const cw = editing.cw ?? ''
      return emptyComposeState({
        visibilityRaw: editing.visibility.raw,
        localOnly: editing.visibility.localOnly,
        replyTo: null,
        quote: null,
        text: editing.content.mfm ?? editing.content.plain,
        cw,
        cwEnabled: cw !== '',
        media: (editing.media ?? []).map(m => ({
          id: m.id,
          alt: m.description ?? '',
          originalAlt: m.description ?? '',
          previewUrl: m.previewUrl ?? m.url ?? null,
          sensitive: m.isSensitive,
        })),
      })
    }
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
  // Success notice (e.g. quote-refusal recovery posted without the quote):
  // informational, never an error — the post went through.
  const [notice, setNotice] = useState<string | null>(null)
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
        visibleUserIds: state.visibleUserIds,
        localOnly: state.localOnly,
        replyToId: state.replyTo?.id ?? null,
        quoteId: state.quote?.id ?? null,
        pollChoices: state.poll?.choices ?? null,
        pollMultiple: state.poll?.multiple ?? false,
        pollHideTotals: state.poll?.hideTotals ?? false,
        pollDurationSeconds: state.poll?.durationSeconds ?? 86400,
        reactionAcceptance: state.reactionAcceptance,
        noQuote: state.noQuote,
        scheduledAt: state.scheduledAt,
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [state, store, session.id, id])

  // Draft target restore (C6): the stored draft keeps reply/quote ids only,
  // so re-attach the posts through the owning session's backend. Runs for
  // the `draftId` restore above and for restores from the drafts list.
  // Targets that no longer resolve keep the text and report honestly.
  const attachTargets = useCallback(
    async (replyToId: string | null, quoteId: string | null) => {
      if (!replyToId && !quoteId) return
      const [replyTo, quote] = await Promise.all([
        replyToId ? backend.post(replyToId).catch(() => null) : Promise.resolve(null),
        quoteId ? backend.post(quoteId).catch(() => null) : Promise.resolve(null),
      ])
      if (replyTo || quote) {
        setState(s => ({...s, ...(replyTo ? {replyTo} : {}), ...(quote ? {quote} : {})}))
      } else {
        setError('The original reply or quote target could not be loaded; the text was kept.')
      }
    },
    [backend],
  )

  // Opening on a `draftId` with targets but no live props (deep link into
  // a reply/quote draft): attach once on mount.
  const attachedRef = useRef(false)
  useEffect(() => {
    if (attachedRef.current || !draftId || replyTo || quote) return
    attachedRef.current = true
    const saved = listDrafts(store, session.id).find(d => d.id === draftId)
    if (saved) void attachTargets(saved.replyToId, saved.quoteId)
  }, [draftId, replyTo, quote, store, session.id, attachTargets])

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
  const mediaFull = uploads.items.length + state.media.length >= limits.maxMedia
  const pollBlockedByMedia = uploads.items.length > 0 || state.media.length > 0
  const mediaBlockedByPoll = !!state.poll

  /** Description edits owed to the server before the post itself is
   * written: seeded attachments whose alt changed and uploads whose text
   * changed after the file was sent (clickstone §1.7). Throws when the
   * server refuses — the caller aborts instead of posting with stale alt
   * text. */
  const applyMediaEdits = async () => {
    if (!backend.updateMedia) return
    const updates = pendingMediaUpdates(
      state.media,
      uploads.items.map(u => ({
        mediaId: u.mediaId,
        alt: u.alt,
        originalAlt: u.altAtUpload,
        status: u.status,
      })),
    )
    for (const update of updates) {
      await backend.updateMedia(update.id, {description: update.description})
    }
  }

  /** Set one seeded attachment's description (edited locally, saved on
   * submit through `updateMedia`). */
  const setSeededAlt = useCallback((id: string, alt: string) => {
    setState(s => ({
      ...s,
      media: s.media.map(m => (m.id === id ? {...m, alt} : m)),
    }))
  }, [])

  /** Drop one seeded attachment from the post (the server file stays). */
  const removeSeeded = useCallback((id: string) => {
    setState(s => ({...s, media: s.media.filter(m => m.id !== id)}))
  }, [])

  // Clear-after-post (C1): the inline composer stays mounted, so success
  // resets it to a fresh empty draft (text, CW, poll, uploads, schedule).
  // Reply/quote context is the caller's (props) and stays.
  const resetAfterPost = useCallback(() => {
    uploads.clear()
    setState(s =>
      emptyComposeState({
        visibilityRaw: defaultVisibilityFor(family, s.replyTo).raw,
        replyTo: s.replyTo,
        quote: s.quote,
      }),
    )
    setCaret(0)
    setError(null)
    postedRef.current = false
  }, [family, uploads])

  const submit = async () => {
    setError(null)
    setNotice(null)
    // Edit mode (C7): validate the same rules, then save through
    // `backend.editPost` (the hook patches every cached copy). Uploads
    // replace the attachment set only when the user added new ones —
    // otherwise the post's own media ids ride along so the edit cannot
    // silently strip attachments. Polls are server-kept (the edit wire
    // has no poll fields) and scheduling an edit is refused by hiding
    // the control, not by erroring here.
    if (editing) {
      const pre = buildPostDraft({...state, replyTo: null, quote: null}, {family, gates, limits})
      if (!pre.ok) {
        setError(pre.reason)
        return
      }
      setBusy(true)
      try {
        let mediaIds: string[] | undefined
        if (uploads.items.length > 0) {
          const ids = await uploads.ensureUploaded()
          if (!ids) {
            setError('Some attachments failed to upload. Retry or remove them.')
            return
          }
          mediaIds = ids
        }
        // Alt text / descriptions changed on existing attachments go to the
        // media endpoint FIRST (clickstone §1.7): the edit cannot save a
        // caption the user believes they changed while the server kept the
        // old one.
        await applyMediaEdits()
        const keepMediaIds = mediaIds ?? (state.media.length > 0 ? state.media.map(m => m.id) : editing.mediaIds) ?? []
        await edit.mutateAsync({
          id: editing.id,
          draft: {...pre.draft, ...(keepMediaIds.length > 0 ? {mediaIds: keepMediaIds} : {})},
        })
        postedRef.current = true
        deleteDraft(store, session.id, id)
        onPosted?.('posted')
        onClose?.()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save the edit.')
      } finally {
        setBusy(false)
      }
      return
    }
    // Validate text rules first (media ids are filled after upload).
    const pre = buildPostDraft(
      {
        ...state,
        media: [
          ...state.media,
          ...uploads.items.map(u => ({id: u.mediaId ?? u.key, alt: u.alt, sensitive: u.sensitive})),
        ],
      },
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
      const finish = (result: {kind: 'posted' | 'scheduled'}) => {
        postedRef.current = true
        deleteDraft(store, session.id, id)
        resetAfterPost()
        onPosted?.(result.kind)
        onClose?.()
      }
      const allMedia = () => [
        ...state.media,
        ...mediaIds.map(m => ({id: m, alt: ''})),
      ]
      const built = buildPostDraft({...state, media: allMedia()}, {family, gates, limits})
      if (!built.ok) {
        setError(built.reason)
        return
      }
      try {
        // Descriptions on reattached files (a redraft keeps its attachments
        // server-side) are saved before the post so the new post carries the
        // alt text the user last typed (clickstone §1.7).
        await applyMediaEdits()
        const result = await create.mutateAsync({draft: built.draft, scheduledAt: built.scheduledAt})
        finish(result)
      } catch (err) {
        // Quote-refusal recovery (C5, v1 §4 parity): keep the text, drop
        // the quote, post once more, and show the server reason as a
        // notice — the post went through, just unquoted.
        const refused =
          state.quote != null &&
          err instanceof ApiError &&
          (err.code === 'QUOTE_DISABLED_FOR_USER' || err.message.includes('QUOTE_DISABLED'))
        if (!refused) throw err
        const unquoted = buildPostDraft(
          {...state, quote: null, media: allMedia()},
          {family, gates, limits},
        )
        if (!unquoted.ok) {
          setError(unquoted.reason)
          return
        }
        try {
          const result = await create.mutateAsync({
            draft: unquoted.draft,
            scheduledAt: unquoted.scheduledAt,
          })
          setNotice(err instanceof Error ? err.message : 'The quoted account does not allow quotes; posted without it.')
          finish(result)
        } catch (retryErr) {
          setError(retryErr instanceof Error ? retryErr.message : 'Could not post.')
        }
      }
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
      // P1: the compose box is prose — it scales with the text setting.
      fontSize: typeSize.body * theme.fontScaleMultiplier,
      textAlignVertical: 'top',
      // No OS/browser focus ring on the bordered box either.
      outlineWidth: 0,
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
    // Restored reply/quote drafts keep their targets (C6): the ids resolve
    // through the owning session's backend; failures keep the text.
    void attachTargets(d.replyToId, d.quoteId)
  }
  const drafts = showDrafts ? listDrafts(store, session.id).filter(d => d.id !== id) : []

  return {
    theme, family, gates, limitsQuery, limits, emojis, uploads, create,
    id, state, caret, setCaret, error, setError, busy, showDrafts, setShowDrafts,
    notice, setNotice, attachTargets, resetAfterPost,
    pickingEmoji, setPickingEmoji, patch, trigger, suggestions, onPickSuggestion,
    count, over, options, mediaFull, pollBlockedByMedia, mediaBlockedByPoll,
    submit, addMedia, styles, restore, drafts, setSeededAlt, removeSeeded,
    session, backend, store, replyTo, quote, draftId, editing, redraftSeed, onClose, onPosted,
  }
}

export type ComposerController = ReturnType<typeof useComposerController>

export function Composer(props: ComposerProps) {
  const controller = useComposerController(props)
  const {theme, family, gates, limitsQuery, limits, emojis, uploads, create,
    id, state, caret, setCaret, error, busy, showDrafts, setShowDrafts,
    notice, pickingEmoji, setPickingEmoji, patch, trigger, suggestions, onPickSuggestion,
    count, over, options, mediaFull, pollBlockedByMedia, mediaBlockedByPoll,
    submit, addMedia, styles, restore, drafts,
    session, backend, store, draftId, editing, onClose,
  } = controller
  // Reply/quote context reads STATE, not props: restoring a draft re-attaches
  // its targets into state (C6), and state initializes from props otherwise.
  const replyTo = state.replyTo
  const quote = state.quote
  // Floating box rests at 120px and grows with the prose to 480px, then
  // scrolls internally. Same hook as the inline composer.
  const autogrow = useAutogrowInput(120, 480)

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      <View style={styles.spread}>
        {onClose ? (
          <Button label={i18n._(msg`Cancel`)} variant="secondary" onPress={onClose} testID="composer-cancel" />
        ) : null}
        <Button
          label={editing ? i18n._(msg`Save`) : state.scheduledAt && gates.schedule.enabled ? i18n._(msg`Schedule`) : i18n._(msg`Post`)}
          onPress={submit}
          disabled={busy || over}
          disabledReason={over ? i18n._(msg`Over the character limit.`) : busy ? i18n._(msg`Posting...`) : undefined}
          testID="composer-submit"
          compact
        />
      </View>

      {replyTo ? (
        <View style={styles.context} testID="composer-reply-context">
          <Caption color="muted">{i18n._(msg`Replying to @${replyTo.author.acct}`)}</Caption>
        </View>
      ) : null}
      {quote ? (
        <View style={styles.context} testID="composer-quote-context">
          <Caption color="muted">{i18n._(msg`Quoting @${quote.author.acct}`)}</Caption>
        </View>
      ) : null}
      {editing ? (
        <View style={styles.context} testID="composer-edit-context">
          <Caption color="muted">{i18n._(msg`Editing your post`)}</Caption>
        </View>
      ) : null}

      <CwSection c={controller} />

      <TextInput
        testID="composer-text"
        multiline
        value={state.text}
        onChangeText={text => patch({text})}
        onSelectionChange={e => setCaret(e.nativeEvent.selection.end)}
        placeholder={replyTo ? i18n._(msg`Write your reply`) : i18n._(msg`What's happening?`)}
        placeholderTextColor={theme.palette.faint}
        accessibilityLabel={i18n._(msg`Post text`)}
        style={[styles.input, autogrowStyle(autogrow.height)]}
        onContentSizeChange={autogrow.onContentSizeChange}
      />
      <SuggestEmojiSection c={controller} />

      <View style={styles.spread}>
        <Caption color={over ? 'text' : 'muted'} testID="composer-counter">
          {count} / {limits.maxChars}
        </Caption>
        {over ? <Caption>{i18n._(msg`Over the limit`)}</Caption> : null}
      </View>

      {error ? (
        <Body testID="composer-error" accessibilityRole="alert">
          {error}
        </Body>
      ) : null}
      {notice ? (
        <Body testID="composer-notice">
          {notice}
        </Body>
      ) : null}

      <Caption color="muted">{i18n._(msg`Audience`)}</Caption>
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
            label={i18n._(msg`Local only`)}
            selected={state.localOnly}
            onPress={() => patch({localOnly: !state.localOnly})}
            testID="composer-local-only"
          />
        ) : null}
      </View>

      {/* Per-note quote refusal (clickstone §1.2). Distinct from the
          account-wide `rejectQuotes` switch in Settings → Account: this
          only refuses quotes OF THIS POST. Where the server has no
          per-note field the control stays visible and disabled with the
          gate's reason — never inert. */}
      <View style={styles.row}>
        <Chip
          label={i18n._(msg`No quotes for this post`)}
          selected={state.noQuote}
          disabled={!gates.noQuote.enabled}
          disabledReason={gates.noQuote.enabled ? undefined : gates.noQuote.reason}
          onPress={() => patch({noQuote: !state.noQuote})}
          testID="composer-no-quote"
        />
        {gates.noQuote.enabled ? (
          <Caption color="muted" testID="composer-no-quote-help">
            {i18n._(msg`Only this post refuses quotes. The account-wide setting is in Settings → Account.`)}
          </Caption>
        ) : (
          <Caption color="muted" testID="composer-no-quote-reason">
            {gates.noQuote.reason}
          </Caption>
        )}
      </View>

      <View style={styles.row}>
        <Chip label={i18n._(msg`Emoji`)} onPress={() => setPickingEmoji(true)} testID="composer-emoji-button" />
        <Chip
          label={i18n._(msg`CW`)}
          selected={state.cwEnabled}
          onPress={() => patch({cwEnabled: !state.cwEnabled})}
          testID="composer-cw-toggle"
        />
        <Chip
          label={i18n._(msg`Poll`)}
          selected={!!state.poll}
          disabled={!gates.poll.enabled || (!state.poll && pollBlockedByMedia)}
          disabledReason={
            !gates.poll.enabled
              ? gates.poll.reason
              : i18n._(msg`A post cannot have both media and a poll.`)
          }
          onPress={() =>
            patch({
              poll: state.poll ? null : {choices: ['', ''], multiple: false, durationSeconds: 86400},
            })
          }
          testID="composer-poll-toggle"
        />
        <Chip
          label={i18n._(msg`Media`)}
          disabled={mediaFull || mediaBlockedByPoll}
          disabledReason={
            mediaBlockedByPoll ? i18n._(msg`A post cannot have both media and a poll.`) : i18n._(msg`Attachment limit reached.`)
          }
          onPress={addMedia}
          testID="composer-media-add"
        />
        {gates.schedule.enabled && !editing ? (
          <Chip
            label={i18n._(msg`Schedule`)}
            selected={state.scheduledAt != null}
            onPress={() =>
              patch({
                scheduledAt: state.scheduledAt ? null : new Date(Date.now() + 3600_000).toISOString(),
              })
            }
            testID="composer-schedule-toggle"
          />
        ) : null}
        <Chip label={i18n._(msg`Drafts`)} onPress={() => setShowDrafts(v => !v)} testID="composer-drafts-toggle" />
      </View>

      <ScheduleSection c={controller} />

      <RecipientSection c={controller} />

      {gates.reactionAcceptance.enabled ? (
        <View style={styles.row}>
          <Caption color="muted">{i18n._(msg`Reactions`)}</Caption>
          <Chip
            label={i18n._(msg`All`)}
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

      <PollSection c={controller} />

      <SeededMediaSection c={controller} />

      <UploadsSection c={controller} />

      <DraftsSection c={controller} />

      <ScheduledListSection c={controller} />

      <ServerDraftsSection c={controller} />
    </ScrollView>
  )
}
