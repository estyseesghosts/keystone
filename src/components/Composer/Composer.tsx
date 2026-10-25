import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {ScrollView, StyleSheet, TextInput, View, Platform} from 'react-native'
import {useQuery} from '@tanstack/react-query'

import {msg, plural} from '@lingui/macro'

import {
  ApiError,
  applyCompletion,
  buildPostDraft,
  composeDefaultsFor,
  composeGates,
  composePrefsOf,
  countComposeChars,
  defaultVisibilityFor,
  emptyComposeState,
  formatByteLimit,
  isUnsupportedError,
  pendingMediaUpdates,
  visibilityOptionsFor,
  REACTION_ACCEPTANCE_LABELS,
  type Backend,
  type ComposeState,
  type KeyValueStore,
  type Post,
  type ReactionAcceptance,
  type ServerDraft,
  type ServerFamily,
  type Session,
} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {radius, space, typeSize} from '#/alf/tokens'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {errorText} from '#/lib/localeErrors'
import {i18n} from '#/locale/i18n'
import {
  useComposeLimits,
  useCreatePost,
  useEditPost,
  useSaveServerDraft,
  useSessionCustomEmojis,
  useUploads,
  dismissVideoNotice as dismissVideoNoticeForSession,
  readRemindAltText,
  shouldShowVideoNotice,
  writeRemindAltText,
} from '#/state/queries/composer'
import {
  clearOpenDraftId,
  deleteDraft,
  getOpenDraftId,
  isDraftEmpty,
  listDrafts,
  loadDraft,
  newDraftId,
  saveDraft,
  saveDraftDetailed,
  setOpenDraftId,
  type LocalDraft,
} from '#/storage/drafts'
import {meQueryKey} from '#/state/queries/keys'
import {STALE} from '#/state/queries/stale'

import {useSuggestions, type Suggestion} from './Autocomplete'
import {useAutogrowInput, autogrowStyle} from './useAutogrowInput'
import {NO_OUTLINE} from './noOutline'
import {focusRingStyle} from '#/alf/focus'
import {Chip} from './Chip'
import {CloseConfirmDialog} from './CloseConfirmDialog'
import {Dialog} from '#/components/Dialog'
import {
  CwSection,
  DraftsSection,
  PollSection,
  QuotePreviewSection,
  RecipientSection,
  ReplyPreviewSection,
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

// Sheet keyboard geometry (X6.5, rn-ui L5): exactly ONE mechanism per
// platform, pure and jest-covered. iOS is owned by the sheet's
// KeyboardAvoidingView (`padding`) in Compose.tsx; Android uses the manual
// maxHeight cap below (`window - keyboard`), paired with
// `android.softwareKeyboardLayoutMode: 'pan'` in app.config.js so the
// window does not ALSO resize underneath it. The explicit bottom-padding
// path is retired (always 0): padding + cap + KAV triple-applied on
// Android and parked the input too high. Web returns 0/undefined (CSS owns
// it) and non-mobile shells keep their centered card. Device behavior is
// `not verified (device)` — see X12.1.
export function sheetKeyboardInset(platformOS: string, keyboardHeight: number): number {
  void platformOS
  void keyboardHeight
  return 0
}

export function sheetVisibleMaxHeight(
  platformOS: string,
  layout: string,
  windowHeight: number,
  keyboardHeight: number,
): number | undefined {
  if (platformOS !== 'android' || layout !== 'mobile') return undefined
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return undefined
  const kb = Number.isFinite(keyboardHeight) && keyboardHeight > 0 ? keyboardHeight : 0
  return Math.max(0, windowHeight - kb)
}

/** True when the selected visibility is a direct audience (Misskey
 * `specified`, Mastodon `direct`) — derived from the option kinds, never
 * by hardcoding wire strings. */
export function isDirectVisibility(family: ServerFamily, visibilityRaw: string): boolean {
  return visibilityOptionsFor(family).find(o => o.raw === visibilityRaw)?.kind === 'direct'
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
    sensitive: d.sensitive,
    language: d.language,
    scheduledAt: d.scheduledAt,
  }
}

// Draft snapshot (composer slice 2): the row shape autosave persists and
// Save-and-close writes — one shape, one place. `hadMedia` is presence
// only; the files/ids themselves are never stored.
function snapshotDraft(id: string, state: ComposeState, hadMedia: boolean): LocalDraft {
  return {
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
    sensitive: state.sensitive,
    language: state.language,
    scheduledAt: state.scheduledAt,
    hadMedia,
  }
}

// Close confirm for edit mode (repair X6.1 F2): no "Save draft" — an
// edit is never a draft. Discard or keep writing only. Same testIDs for
// the two remaining buttons so close-guard tests stay meaningful.
export function EditCloseDialog({onDiscard, onKeep}: {onDiscard: () => void; onKeep: () => void}) {
  return (
    <Dialog open onClose={onKeep} title={i18n._(msg`Discard changes?`)} testID="composer-close-confirm">
      <Body>{i18n._(msg`Close without saving your changes?`)}</Body>
      <Button
        label={i18n._(msg`Discard`)}
        variant="secondary"
        onPress={onDiscard}
        testID="composer-close-discard"
      />
      <Button
        label={i18n._(msg`Keep writing`)}
        variant="secondary"
        onPress={onKeep}
        testID="composer-close-keep"
      />
    </Dialog>
  )
}

/** Handle an owning sheet calls to route backdrop/back-nav exits through
 * the same dirty guard as the composer's Cancel button (slice 2). */
export interface CloseGuardHandle {
  requestClose: () => void
  isDirty: () => boolean
}

// Composer layout geometry (module scope): space/radius constants never
// change, so one stylesheet serves every keystroke. Theme colors + the
// text scale join inline in `useComposerController` below.
const composerLayout = StyleSheet.create({
  root: {padding: space.lg, gap: space.md},
  inputBase: {
    minHeight: 120,
    borderRadius: radius.md,
    padding: space.md,
    textAlignVertical: 'top',
    // Chrome-free prose while unfocused (style kill — see noOutline);
    // keyboard focus draws the shared alf ring at the input call site
    // (X10.1), so focus is never invisible.
    outlineColor: 'transparent',
    outlineWidth: 0,
  },
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center'},
  spread: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  thumbBase: {width: 56, height: 56, borderRadius: radius.sm},
  media: {flexDirection: 'row', gap: space.sm, alignItems: 'flex-start'},
  contextBase: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.sm,
  },
})

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
  // Partial limits objects (older test doubles, future new fields): fill
  // any missing key from the family defaults so new reads never see
  // undefined at runtime.
  const limits = useMemo(
    () => ({...composeDefaultsFor(family), ...limitsQuery.data}),
    [limitsQuery.data, family],
  )
  // F10: fallback limits never hard-block posting — the composer warns
  // instead of disabling. Shown once the query settled, not while pending.
  const limitsUnverified = limitsQuery.isFetched && limits.source !== 'server'
  // Per-kind upload caps for the picker and the upload guards (X6.2 step
  // 2): server values when reported, else the client heap bound.
  const caps = useMemo(
    () => ({imageBytes: limits.maxImageBytes ?? null, videoBytes: limits.maxVideoBytes ?? null}),
    [limits],
  )
  const emojis = useSessionCustomEmojis(session, backend)
  const uploads = useUploads(backend, {folderId: uploadFolderId}, caps)
  // Server-side compose defaults (privacy 4): the viewer's own account
  // carries default visibility / local-only / sensitivity / language.
  // Read through the shared `me` query key (same cache every other screen
  // uses — no new query kind), best-effort and never an error surface.
  // A plain `useQuery` (not `useMe`) so presentational trees without a
  // session provider can still mount the composer.
  const prefsQuery = useQuery({
    queryKey: meQueryKey(session.id),
    staleTime: STALE.ACCOUNT,
    // Best-effort: backends without `me` (test doubles) simply get no prefs.
    enabled: typeof backend.me === 'function',
    queryFn: ({signal}) => backend.me({signal}),
  })
  const prefs = useMemo(() => composePrefsOf(prefsQuery.data ?? null), [prefsQuery.data])
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const create = useCreatePost(session, backend)
  const edit = useEditPost(session, backend)
  // Slice 3: the shared server-draft mutation (create-or-update by id +
  // list invalidation). saveAndClose and the server-drafts section both go
  // through it — one call shape, no fork.
  const saveServer = useSaveServerDraft(session, backend)

  const [open] = useState(() => {
    // Slice 1 — durable in-progress draft. An explicit `draftId` wins;
    // targeted opens (reply/quote/edit/redraft) never follow the pointer;
    // otherwise the per-session open-draft pointer re-opens the in-progress
    // draft after a refresh/crash, adopting its row id so autosave keeps
    // updating the same row instead of forking a duplicate. A stale pointer
    // (row gone) is cleared and the composer opens fresh — the clear is
    // idempotent, so a double-invoked initializer converges on the same
    // state. Runs once per mount (the sheet keys on session + targets, so
    // this never goes stale under a live composer).
    if (draftId) return {id: draftId, viaPointer: false, hadMedia: false}
    if (replyTo != null || quote != null || editing != null || redraftSeed != null) {
      return {id: newDraftId(), viaPointer: false, hadMedia: false}
    }
    const openId = getOpenDraftId(store, session.id)
    if (openId) {
      const saved = loadDraft(store, session.id, openId)
      if (saved) return {id: openId, viaPointer: true, hadMedia: saved.hadMedia}
      clearOpenDraftId(store, session.id)
    }
    return {id: newDraftId(), viaPointer: false, hadMedia: false}
  })
  const id = open.id
  // The draft this open restores from: explicit id, else the validated
  // pointer row. Reuses the `draftId` restore path below — no fork.
  const restoreId = draftId ?? (open.viaPointer ? open.id : null)
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
    const restored = restoreId ? listDrafts(store, session.id).find(d => d.id === restoreId) : null
    return emptyComposeState({
      visibilityRaw: defaultVisibilityFor(family, replyTo, prefs.visibilityRaw ?? undefined).raw,
      // Server defaults seed create mode only (never edit mode — the post
      // is the seed there); a restored draft keeps its own values.
      localOnly: prefs.localOnly,
      sensitive: family === 'mastodon' && prefs.sensitive,
      language: family === 'mastodon' ? prefs.language : null,
      replyTo,
      quote,
      ...(restored ? stateFromDraft(restored) : {}),
    })
  })
  const [caret, setCaret] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Success notice (e.g. quote-refusal recovery posted without the quote):
  // informational, never an error — the post went through. A
  // pointer-restored draft with `hadMedia` also starts with the honest
  // attachments notice (restored rows never carry media); other restores
  // start silent.
  const [notice, setNotice] = useState<string | null>(() =>
    open.viaPointer && open.hadMedia
      ? i18n._(msg`Restored your in-progress draft. Attachments aren't kept — re-attach if needed.`)
      : null,
  )
  const [busy, setBusy] = useState(false)
  // Repair X7.4 step 7: "remind me to add alt text" pref (default off,
  // device-global key, not the versioned schema). While on, the Post
  // button shows a non-blocking note for staged images without alt text.
  const [remindAlt, setRemindAltState] = useState(() => readRemindAltText(store))
  const setRemindAlt = useCallback((v: boolean) => {
    setRemindAltState(v)
    writeRemindAltText(store, v)
  }, [store])
  // Repair X7.4 step 6: videos are never re-encoded, so their metadata
  // ships unchanged — warned once per session, dismissible.
  const [, setVideoTick] = useState(0)
  const hasVideoUpload = uploads.items.some(u =>
    (u.mimeType ?? '').toLowerCase().startsWith('video/'),
  )
  const videoNotice = shouldShowVideoNotice(session.id, hasVideoUpload)
    ? i18n._(
        msg`Videos are sent unchanged, including any location or device data they carry.`,
      )
    : null
  const dismissVideoNotice = useCallback(() => {
    dismissVideoNoticeForSession(session.id)
    setVideoTick(t => t + 1)
  }, [session.id])
  // Staged images without alt text (repair X7.4 step 7): counted for the
  // non-blocking Post-button note. Only known images count — unknown
  // types stay the server's verdict, never a nag.
  const imagesMissingAlt = uploads.items.filter(
    u => (u.mimeType ?? '').toLowerCase().startsWith('image/') && u.alt.trim() === '',
  ).length
  const showAltNote = remindAlt && imagesMissingAlt > 0
  // Latest-state refs (repair X6.1 F3): alt/description writes owed at
  // submit read the CURRENT text, not the closure from press time — a
  // description typed between press and the media-edit call still wins.
  // Shared with create mode (same submit path); harmless there.
  const stateRef = useRef(state)
  stateRef.current = state
  const uploadsItemsRef = useRef(uploads.items)
  uploadsItemsRef.current = uploads.items
  // Single-flight guard (R0.3): `busy` state commits after an async gap, so
  // a second submit dispatched in the same tick (double-tap, keyboard
  // submit, both chromes) would run validation + upload + create twice.
  // The ref flips synchronously, before any await, and clears in `finally`.
  const submitRef = useRef(false)
  const [showDrafts, setShowDrafts] = useState(false)
  // Slice 3 — the open server draft this composer edits in place. Set when
  // a server draft is restored; cleared when a local draft is restored or
  // the post goes through. The next server save UPDATES this id instead of
  // creating a duplicate. Null (fresh compose, local restore) creates.
  const [serverDraftId, setServerDraftId] = useState<string | null>(null)
  const [pickingEmoji, setPickingEmoji] = useState(false)
  const patch = useCallback((p: Partial<ComposeState>) => setState(s => ({...s, ...p})), [])

  // Autosave (debounced). Keyed by session id; cleared on post. Also
  // maintains the open-draft pointer (slice 1): a saved non-empty draft
  // is the session's in-progress draft, while an empty save deletes the
  // row — so the pointer goes with it and the next open starts fresh.
  // A failed write (repair X1.3 S12: quota, locked store) shows a
  // non-blocking notice instead of failing silently; the next successful
  // save clears it.
  // Repair X6.1 F2: never in edit mode — an edit seeds non-empty text,
  // so autosaving would write a new-post draft of the old post and set
  // the pointer; a killed edit would then prefill the next new post.
  // Repair X6.2 step 7 (privacy 7): direct/`specified` drafts never touch
  // disk on their own — only an explicit Save writes them.
  const postedRef = useRef(false)
  const autosaveFailedRef = useRef(false)
  const directNoticeRef = useRef(false)
  useEffect(() => {
    if (editing != null) return
    if (postedRef.current) return
    if (isDirectVisibility(family, state.visibilityRaw)) {
      directNoticeRef.current = true
      setNotice(i18n._(msg`Direct and specified posts aren't autosaved on this device. Use Save to keep a copy.`))
      return
    }
    const timer = setTimeout(() => {
      // A throwing store (failed reads or writes) counts as a failed
      // save — never let it escape the timer; surface the notice instead.
      // The helpers report booleans on the write half, but a hostile
      // backing can still throw on reads (`listDrafts` → `getItem`).
      let ok = false
      let evicted = false
      try {
        const draft = snapshotDraft(id, state, state.media.length > 0 || uploads.items.length > 0)
        const result = saveDraftDetailed(store, session.id, draft)
        const pointerSaved = isDraftEmpty(draft)
          ? clearOpenDraftId(store, session.id)
          : setOpenDraftId(store, session.id, id)
        ok = result.saved && pointerSaved
        evicted = result.evictedOldest
      } catch {
        ok = false
      }
      if (!ok) {
        autosaveFailedRef.current = true
        directNoticeRef.current = false
        setNotice(i18n._(msg`Could not save the draft on this device.`))
      } else if (evicted) {
        // The 26th draft pushed the oldest row out — say so instead of
        // evicting silently.
        autosaveFailedRef.current = false
        directNoticeRef.current = false
        setNotice(i18n._(msg`Your oldest draft was removed to make room for this one.`))
      } else if (autosaveFailedRef.current || directNoticeRef.current) {
        autosaveFailedRef.current = false
        directNoticeRef.current = false
        setNotice(null)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [state, store, session.id, id, uploads.items.length, editing, family])

  // rn-ui L2: flush a pending autosave on unmount (sidebar navigation,
  // account switch) instead of losing the last <400 ms of edits. Skipped
  // after posting/saving/discarding (`postedRef`), in edit mode (edits
  // never own a draft row), and for direct drafts (never written without
  // an explicit Save). Failures are silent — the component is gone.
  const editingRef = useRef(editing)
  editingRef.current = editing
  const flushAutosaveRef = useRef(() => {})
  flushAutosaveRef.current = () => {
    if (editingRef.current != null || postedRef.current) return
    const s = stateRef.current
    if (isDirectVisibility(family, s.visibilityRaw)) return
    try {
      const draft = snapshotDraft(id, s, s.media.length > 0 || uploadsItemsRef.current.length > 0)
      if (saveDraft(store, session.id, draft)) {
        if (isDraftEmpty(draft)) clearOpenDraftId(store, session.id)
        else setOpenDraftId(store, session.id, id)
      }
    } catch {
      // Unmounting: nothing to show.
    }
  }
  useEffect(() => () => flushAutosaveRef.current(), [])

  // Async-arriving server defaults (privacy 4): the `me` query usually
  // resolves after the composer mounts, so apply the prefs once — and only
  // to a pristine composer, never over user input or a restored draft.
  // No dep array: exits on the applied flag, so no exhaustive-deps warning.
  const prefsAppliedRef = useRef(false)
  useEffect(() => {
    if (editing != null || prefsAppliedRef.current) return
    const p = prefsRef.current
    const hasPrefs = p.visibilityRaw != null || p.localOnly || p.sensitive || p.language != null
    if (!hasPrefs) return
    const s = stateRef.current
    const pristineDefault = defaultVisibilityFor(family, replyTo ?? null).raw
    const pristine =
      s.text === '' &&
      s.cw === '' &&
      !s.cwEnabled &&
      s.visibilityRaw === pristineDefault &&
      !s.localOnly &&
      !s.sensitive &&
      s.language == null &&
      s.media.length === 0 &&
      s.poll == null &&
      s.reactionAcceptance == null &&
      !s.noQuote &&
      s.scheduledAt == null &&
      s.visibleUserIds.length === 0 &&
      uploadsItemsRef.current.length === 0
    prefsAppliedRef.current = true
    if (!pristine) return
    patch({
      visibilityRaw: defaultVisibilityFor(family, replyTo ?? null, p.visibilityRaw ?? undefined).raw,
      localOnly: p.localOnly,
      sensitive: family === 'mastodon' && p.sensitive,
      language: family === 'mastodon' ? p.language : null,
    })
  })

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
        setError(i18n._(msg`The original reply or quote target could not be loaded; the text was kept.`))
      }
    },
    [backend],
  )

  // Opening on a draft with targets but no live props (deep link into a
  // reply/quote draft, or a pointer restore after refresh): attach once on
  // mount.
  const attachedRef = useRef(false)
  useEffect(() => {
    if (attachedRef.current || !restoreId || replyTo || quote) return
    attachedRef.current = true
    const saved = listDrafts(store, session.id).find(d => d.id === restoreId)
    if (saved) void attachTargets(saved.replyToId, saved.quoteId)
  }, [restoreId, replyTo, quote, store, session.id, attachTargets])

  const {trigger, suggestions} = useSuggestions(state.text, caret, backend, emojis.data)
  const onPickSuggestion = (s: Suggestion) => {
    if (!trigger) return
    const next = applyCompletion(state.text, trigger, s.insert)
    patch({text: next.text})
    setCaret(next.caret)
  }

  const count = countComposeChars(family, state.text, limits.urlWeight)
  const over = count > limits.maxChars
  const options = visibilityOptionsFor(family)
  const mediaFull = uploads.items.length + state.media.length >= limits.maxMedia
  const pollBlockedByMedia = uploads.items.length > 0 || state.media.length > 0
  const mediaBlockedByPoll = !!state.poll

  /** Description edits owed to the server before the post itself is
   * written: seeded attachments whose alt changed and uploads whose text
   * changed after the file was sent (clickstone §1.7). Throws when the
   * server refuses — the caller aborts instead of posting with stale alt
   * text. Reads the live refs (repair X6.1 F3), not the press-time
   * closure, so a description typed while uploads finish still wins. */
  const applyMediaEdits = async () => {
    if (!backend.updateMedia) return
    const updates = pendingMediaUpdates(
      stateRef.current.media,
      uploadsItemsRef.current.map(u => ({
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
    // Fresh draft after a post: a later save starts a NEW server draft,
    // never overwrites the one just posted.
    setServerDraftId(null)
    const p = prefsRef.current
    setState(s =>
      emptyComposeState({
        visibilityRaw: defaultVisibilityFor(family, s.replyTo, p.visibilityRaw ?? undefined).raw,
        localOnly: p.localOnly,
        sensitive: family === 'mastodon' && p.sensitive,
        language: family === 'mastodon' ? p.language : null,
        replyTo: s.replyTo,
        quote: s.quote,
      }),
    )
    setCaret(0)
    setError(null)
    postedRef.current = false
  }, [family, uploads])

  const submit = async () => {
    // Single-flight: a submit already in flight (ref set synchronously at
    // entry, before any await) wins; the late caller is dropped, not queued.
    if (submitRef.current) return
    submitRef.current = true
    setError(null)
    setNotice(null)
    // Mastodon rejects `poll[expires_in]` below 300 s (finding 22): reject
    // here with a translated message so the user picks a valid duration.
    // The domain layer clamps as a backstop, so a short poll can never be
    // sent even if this check is bypassed.
    if (family === 'mastodon' && state.poll != null && Math.round(state.poll.durationSeconds) < 300) {
      setError(i18n._(msg`Polls must stay open at least 5 minutes on this server.`))
      submitRef.current = false
      return
    }
    // Mastodon requires scheduled posts >= 5 minutes ahead (F11): reject
    // here with a translated message so the user picks a valid time. The
    // domain layer rejects too, so a too-soon schedule can never be sent
    // even if this check is bypassed.
    if (family === 'mastodon' && state.scheduledAt != null) {
      const t = Date.parse(state.scheduledAt)
      if (Number.isFinite(t) && t - Date.now() < 5 * 60_000) {
        setError(i18n._(msg`Scheduled posts must be scheduled at least 5 minutes ahead on this server.`))
        submitRef.current = false
        return
      }
    }
    // Edit mode (C7): validate the same rules, then save through
    // `backend.editPost` (the hook patches every cached copy).
    // Repair X6.1 F1: the attachment set is ALWAYS explicit — kept
    // seeded ids plus newly uploaded ids (empty means "no media" and the
    // backend sends it explicitly per X5.4). The post's own ids are the
    // fallback only when the seed carries no `media` array at all
    // (unknown, not empty). Polls are server-kept (the edit wire
    // has no poll fields) and scheduling an edit is refused by hiding
    // the control, not by erroring here.
    if (editing) {
      const pre = buildPostDraft({...state, replyTo: null, quote: null}, {family, gates, limits})
      if (!pre.ok) {
        setError(pre.reason)
        submitRef.current = false
        return
      }
      setBusy(true)
      try {
        let uploadedIds: string[] = []
        if (uploads.items.length > 0) {
          const ids = await uploads.ensureUploaded()
          if (!ids) {
            setError(i18n._(msg`Some attachments failed to upload. Retry or remove them.`))
            return
          }
          uploadedIds = ids
        }
        // Alt text / descriptions changed on existing attachments go to the
        // media endpoint FIRST (clickstone §1.7): the edit cannot save a
        // caption the user believes they changed while the server kept the
        // old one.
        await applyMediaEdits()
        const keepMediaIds =
          editing.media != null
            ? [...state.media.map(m => m.id), ...uploadedIds]
            : [...(editing.mediaIds ?? []), ...uploadedIds]
        await edit.mutateAsync({
          id: editing.id,
          draft: {...pre.draft, mediaIds: keepMediaIds},
        })
        postedRef.current = true
        // Repair X6.1 F2: an edit never owns a draft row or the open
        // pointer — a fresh edit id was minted at open and no autosave
        // ran, so there is nothing to delete and (critically) no
        // unrelated pointer to clear. Clearing here would wipe an
        // in-progress new-post draft from another composer.
        setServerDraftId(null)
        onPosted?.('posted')
        onClose?.()
      } catch (err) {
        setError(errorText(i18n, err, i18n._(msg`Could not save the edit.`)))
      } finally {
        submitRef.current = false
        setBusy(false)
      }
      return
    }
    // Validate text rules first (media ids are filled after upload).
    // F10: unverified (fallback) limits never hard-block the char count —
    // the local check yields and the server is the verdict. Every other
    // validation still applies.
    const effectiveLimits = limitsUnverified ? {...limits, maxChars: Math.max(limits.maxChars, count)} : limits
    const pre = buildPostDraft(
      {
        ...state,
        media: [
          ...state.media,
          ...uploads.items.map(u => ({id: u.mediaId ?? u.key, alt: u.alt, sensitive: u.sensitive})),
        ],
      },
      {family, gates, limits: effectiveLimits},
    )
    if (!pre.ok) {
      setError(pre.reason)
      submitRef.current = false
      return
    }
    setBusy(true)
    try {
      let mediaIds: string[] = []
      if (uploads.items.length > 0) {
        const ids = await uploads.ensureUploaded()
        if (!ids) {
          setError(i18n._(msg`Some attachments failed to upload. Retry or remove them.`))
          return
        }
        mediaIds = ids
      }
      const finish = (result: {kind: 'posted' | 'scheduled'}) => {
        postedRef.current = true
        deleteDraft(store, session.id, id)
        // Slice 1: posted — no longer the in-progress draft, so a
        // post-submit refresh opens fresh.
        clearOpenDraftId(store, session.id)
        resetAfterPost()
        onPosted?.(result.kind)
        onClose?.()
      }
      const allMedia = () => [
        ...state.media,
        ...mediaIds.map(m => ({id: m, alt: ''})),
      ]
      const built = buildPostDraft({...state, media: allMedia()}, {family, gates, limits: effectiveLimits})
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
          setNotice(errorText(i18n, err, i18n._(msg`The quoted account does not allow quotes; posted without it.`)))
          finish(result)
        } catch (retryErr) {
          setError(errorText(i18n, retryErr, i18n._(msg`Could not post.`)))
        }
      }
    } catch (err) {
      setError(errorText(i18n, err, i18n._(msg`Could not post.`)))
    } finally {
      submitRef.current = false
      setBusy(false)
    }
  }

  const addMedia = async () => {
    try {
      const result = await pickMedia({
        limit: limits.maxMedia - uploads.items.length,
        imageBytes: caps.imageBytes,
        videoBytes: caps.videoBytes,
      })
      // Denied is shown, never a silent cancel (R2.3).
      if (result.kind === 'denied') {
        setError(
          result.canAskAgain
            ? i18n._(msg`Media library access was denied. Allow access to attach photos or videos.`)
            : i18n._(
                msg`Media library access was denied. Enable it in the system settings to attach photos or videos.`,
              ),
        )
        return
      }
      if (result.kind === 'cancelled') return
      // Over-cap files never stage: the picker pre-filters by asset size
      // and `uploads.add` re-checks by File size — report the real cap
      // that applied to each file, never a literal. Unreadable assets
      // (repair X7.4 step 3: iCloud-only and friends) report their own
      // reason and never discard the other picks.
      const refused = uploads.add(result.files)
      const rejected = [...result.rejected, ...refused]
      const overCap = rejected.filter(r => r.reason !== 'unreadable')
      const unreadable = rejected.filter(r => r.reason === 'unreadable')
      if (unreadable.length > 0 && overCap.length === 0) {
        if (unreadable.length === 1) {
          setError(
            i18n._(msg`Could not read "${unreadable[0].name}". Try again or pick another photo.`),
          )
        } else {
          setError(
            i18n._(
              plural(unreadable.length, {
                one: `# file could not be read. Try again or pick other photos.`,
                other: `# files could not be read. Try again or pick other photos.`,
              }),
            ),
          )
        }
      } else if (overCap.length === 1 && unreadable.length === 0) {
        setError(
          i18n._(msg`"${overCap[0].name}" is too large to attach (limit ${formatByteLimit(overCap[0].limit)}).`),
        )
      } else if (overCap.length > 1 && unreadable.length === 0) {
        setError(
          i18n._(
            plural(overCap.length, {
              one: `# file was too large to attach.`,
              other: `# files were too large to attach.`,
            }),
          ),
        )
      } else if (rejected.length > 0) {
        setError(i18n._(msg`Some attachments could not be added.`))
      }
    } catch (err) {
      setError(errorText(i18n, err, i18n._(msg`Could not open the media picker.`)))
    }
  }

  // Single-flight for the async save-and-close below: the dialog stays
  // mounted across the await, so a second Save press while the first is in
  // flight is dropped, not double-created. Resets in `finally` so a failed
  // save stays retryable.
  const saveCloseRef = useRef(false)

  /** Save the current composer state as a server draft (slice 3): create,
   * or UPDATE the draft this composer opened, and remember the id so the
   * next save keeps updating the same row. Attachments never round-trip
   * (local files cannot survive a listing) — text/CW/visibility/
   * recipients/schedule/poll only, through the shared mutation. Throws the
   * validation reason when the state has nothing the server can take, and
   * any wire failure to the caller. */
  const saveServerDraftNow = useCallback(async (): Promise<ServerDraft> => {
    const built = buildPostDraft({...state, media: []}, {family, gates, limits})
    if (!built.ok) throw new Error(built.reason)
    const saved = await saveServer.mutateAsync({
      id: serverDraftId ?? undefined,
      draft: {...built.draft, scheduledAt: built.scheduledAt},
    })
    setServerDraftId(saved.id)
    return saved
  }, [state, family, gates, limits, saveServer, serverDraftId])

  // Close guard (slice 2): every exit — Cancel button, sheet backdrop,
  // back navigation — routes through `requestClose`. Clean closes silently;
  // a dirty draft shows the Save / Discard / Keep-writing sheet instead.
  const [confirmingClose, setConfirmingClose] = useState(false)

  // Dirty reads LIVE state, never the last autosaved row: a user who typed
  // 3 chars 100ms ago and instantly taps out is still dirty. The field
  // check is the existing `isDraftEmpty` semantics (text/CW/poll/visible
  // recipients). Staged attachments alone also count as dirty — even
  // though `isDraftEmpty` ignores media (media ids are never stored, so
  // `saveDraft` drops text-empty rows), closing would silently lose
  // uploads-in-progress, so the guard still asks.
  // Repair X6.1 F2: in edit mode dirtiness is a diff against the seeded
  // post (text, CW + toggle, media ids, poll, visibility + localOnly).
  // A pending upload also counts. An untouched edit closes silently; a
  // killed edit wrote no draft, so the next new post opens fresh.
  const isCloseDirty = useCallback((): boolean => {
    if (editing) {
      const seedText = editing.content.mfm ?? editing.content.plain ?? ''
      if (state.text !== seedText) return true
      const seedCw = editing.cw ?? ''
      if (state.cwEnabled !== (seedCw !== '')) return true
      if ((state.cw ?? '') !== seedCw) return true
      const seedIds =
        editing.media != null ? editing.media.map(m => m.id) : [...(editing.mediaIds ?? [])]
      const curIds = state.media.map(m => m.id)
      if (curIds.length !== seedIds.length) return true
      for (let i = 0; i < curIds.length; i++) {
        if (curIds[i] !== seedIds[i]) return true
      }
      if (uploads.items.length > 0) return true
      // The composer never seeds a poll into an edit (polls are
      // server-kept): any poll state is a user change.
      if (state.poll != null) return true
      if (state.visibilityRaw !== (editing.visibility?.raw ?? state.visibilityRaw)) return true
      if ((state.localOnly ?? false) !== (editing.visibility?.localOnly ?? false)) return true
      if ((state.visibleUserIds ?? []).length > 0) return true
      return false
    }
    if (state.media.length > 0 || uploads.items.length > 0) return true
    return !isDraftEmpty({
      text: state.text,
      cw: state.cw,
      pollChoices: state.poll?.choices ?? null,
      visibleUserIds: state.visibleUserIds,
    })
  }, [state, uploads.items, editing])

  const requestClose = useCallback(() => {
    if (!onClose) return
    if (isCloseDirty()) setConfirmingClose(true)
    else onClose()
  }, [isCloseDirty, onClose])

  const saveAndClose = useCallback(async () => {
    // Repair X6.1 F2: no "Save as draft" in edit mode — the close dialog
    // hides the Save button, and this guard makes a stray call a plain
    // close with NO draft writes and NO pointer touches (never wipe an
    // unrelated in-progress new-post draft).
    if (editing != null) {
      setConfirmingClose(false)
      onClose?.()
      return
    }
    // Slice 3 — the SMART DEFAULT: a backend offering `serverDrafts` saves
    // there (create, or update the open server draft), then drops the local
    // row AND the pointer so no duplicate copy is left behind. No
    // sub-module (Mastodon) keeps the slice-2 local save below. A 404/405
    // from the wire (a server without the endpoint) probes as absent and
    // falls back to the local save silently; any other failure preserves
    // the content locally, surfaces honestly, and stays open — never closed
    // over an invisible error, never silently dropped.
    if (saveCloseRef.current) return
    saveCloseRef.current = true
    try {
      if (backend.serverDrafts) {
        let serverSaved = false
        try {
          await saveServerDraftNow()
          serverSaved = true
        } catch (err) {
          if (!isUnsupportedError(err)) {
            // Real failure (network, 500, validation): keep the content in
            // the local row and stay open with the error visible — closing
            // would lose both the message and the draft.
            saveDraft(
              store,
              session.id,
              snapshotDraft(id, state, state.media.length > 0 || uploads.items.length > 0),
            )
            setError(errorText(i18n, err, i18n._(msg`Could not save the draft.`)))
            setConfirmingClose(false)
            return
          }
          // 404/405: no drafts endpoint on this server — local fallback.
        }
        if (serverSaved) {
          // The server holds the draft now: drop the local row (no double
          // copy) and the in-progress pointer, then close.
          deleteDraft(store, session.id, id)
          clearOpenDraftId(store, session.id)
          postedRef.current = true
          setConfirmingClose(false)
          onClose?.()
          return
        }
      }
      // Local path (slice 2, unchanged): no server drafts on this backend,
      // or the server probed without the endpoint.
      saveDraft(
        store,
        session.id,
        snapshotDraft(id, state, state.media.length > 0 || uploads.items.length > 0),
      )
      clearOpenDraftId(store, session.id)
      // Suppress a pending autosave tick: it would re-save this state and
      // re-set the pointer just cleared above.
      postedRef.current = true
      setConfirmingClose(false)
      onClose?.()
    } finally {
      // A failed save stays retryable; a second press while the first is in
      // flight is dropped, not double-created (the sheet stays mounted
      // across the await, so double-tap can reach here twice).
      saveCloseRef.current = false
    }
  }, [backend, saveServerDraftNow, store, session.id, id, state, uploads.items, onClose, editing])

  const discardAndClose = useCallback(() => {
    // Repair X6.1 F2: in edit mode there is no draft row and no pointer
    // to touch — just close. Touching the pointer here would wipe an
    // unrelated in-progress new-post draft.
    if (editing != null) {
      setConfirmingClose(false)
      onClose?.()
      return
    }
    // The sheet itself is the discard confirm — no second confirm.
    deleteDraft(store, session.id, id)
    clearOpenDraftId(store, session.id)
    // Same pending-autosave suppression as `saveAndClose`: the deleted
    // row must not resurrect from a tick already queued.
    postedRef.current = true
    setConfirmingClose(false)
    onClose?.()
  }, [store, session.id, id, onClose, editing])

  const keepWriting = useCallback(() => {
    setConfirmingClose(false)
  }, [])

  // Theme-dependent values join the hoisted layout here (memoized on
  // the theme, so a keystroke never rebuilds the object identity that
  // fans out as `c.styles` to every section).
  const styles = useMemo(
    () => ({
      root: composerLayout.root,
      input: [
        composerLayout.inputBase,
        {
          color: theme.palette.text,
          backgroundColor: theme.palette.bg,
          // P1: the compose box is prose — it scales with the text setting.
          fontSize: typeSize.body * theme.fontScaleMultiplier,
        },
      ],
      row: composerLayout.row,
      spread: composerLayout.spread,
      thumb: [composerLayout.thumbBase, {backgroundColor: theme.palette.raise}],
      media: composerLayout.media,
      context: [composerLayout.contextBase, {borderColor: theme.palette.border}],
    }),
    [theme],
  )

  const restore = (d: LocalDraft) => {
    // A local restore retargets the composer at the local row: any tracked
    // server draft is no longer the edit target.
    setServerDraftId(null)
    setState(s => ({...s, ...stateFromDraft(d)}))
    setShowDrafts(false)
    // Restored reply/quote drafts keep their targets (C6): the ids resolve
    // through the owning session's backend; failures keep the text.
    void attachTargets(d.replyToId, d.quoteId)
  }

  /** Open a server draft in place (slice 3): the same patch + target
   * re-attach as the local restore above, and remember the server id so
   * the next server save UPDATES it instead of creating a duplicate. */
  const restoreServerDraft = useCallback(
    (d: ServerDraft) => {
      patch({
        text: d.text ?? '',
        cw: d.cw ?? '',
        cwEnabled: (d.cw ?? '') !== '',
        visibilityRaw: d.visibilityRaw ?? state.visibilityRaw,
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
                    family === 'mastodon' ? d.poll.expiredAfter : d.poll.expiredAfter / 1000,
                  ),
                ),
              }
            : null,
      })
      setServerDraftId(d.id)
      if (d.replyId || d.renoteId) void attachTargets(d.replyId ?? null, d.renoteId ?? null)
    },
    [attachTargets, family, patch, state.visibilityRaw],
  )
  const drafts = showDrafts ? listDrafts(store, session.id).filter(d => d.id !== id) : []

  return {
    theme, family, gates, limitsQuery, limits, limitsUnverified, emojis, uploads, create,
    id, state, caret, setCaret, error, setError, busy, showDrafts, setShowDrafts,
    notice, setNotice, attachTargets, resetAfterPost,
    remindAlt, setRemindAlt, videoNotice, dismissVideoNotice, imagesMissingAlt, showAltNote,
    pickingEmoji, setPickingEmoji, patch, trigger, suggestions, onPickSuggestion,
    count, over, options, mediaFull, pollBlockedByMedia, mediaBlockedByPoll,
    submit, addMedia, styles, restore, drafts, setSeededAlt, removeSeeded,
    serverDraftId, restoreServerDraft, saveServerDraftNow,
    confirmingClose, isCloseDirty, requestClose, saveAndClose, discardAndClose, keepWriting,
    session, backend, store, replyTo, quote, draftId, editing, redraftSeed, onClose, onPosted,
  }
}

export type ComposerController = ReturnType<typeof useComposerController>

export function Composer(props: ComposerProps) {
  const controller = useComposerController(props)
  const {theme, family, gates, limitsQuery, limits, limitsUnverified, emojis, uploads, create,
    id, state, caret, setCaret, error, busy, showDrafts, setShowDrafts,
    notice, pickingEmoji, setPickingEmoji, patch, trigger, suggestions, onPickSuggestion,
    count, over, options, mediaFull, pollBlockedByMedia, mediaBlockedByPoll,
    remindAlt, setRemindAlt, imagesMissingAlt, showAltNote,
    submit, addMedia, styles, restore, drafts,
    confirmingClose, saveAndClose, discardAndClose, keepWriting, requestClose,
    session, backend, store, draftId, editing, onClose,
  } = controller
  // Reply/quote context reads STATE, not props: restoring a draft re-attaches
  // its targets into state (C6), and state initializes from props otherwise.
  const replyTo = state.replyTo
  const quote = state.quote
  // Repair X6.1 F3: edit-mode busy gate for the render below (mirrors the
  // controller's `editBusy`; create-mode behaviour is untouched).
  const editBusy = editing != null && busy
  const busyReason = i18n._(msg`Saving…`)
  // Repair X6.2 step 5: language options the server reported (never a
  // faked list — the picker hides when unreported).
  const languageOptions = limits.supportedLanguages ?? []
  // Floating box rests at 120px and grows with the prose to 480px, then
  // scrolls internally. Same hook as the inline composer.
  const autogrow = useAutogrowInput(120, 480, state.text)
  // Visible keyboard-focus ring (repair X10.1, audit a11y 11): the input
  // is chrome-free prose (NO_OUTLINE), so focus draws the shared alf ring
  // instead of the UA default — focus-only, never while unfocused.
  const [inputFocused, setInputFocused] = useState(false)

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      <View style={styles.spread}>
        {onClose ? (
          <Button label={i18n._(msg`Cancel`)} variant="secondary" onPress={requestClose} testID="composer-cancel" />
        ) : null}
        <Button
          label={editing ? i18n._(msg`Save`) : state.scheduledAt && gates.schedule.enabled ? i18n._(msg`Schedule`) : i18n._(msg`Post`)}
          onPress={submit}
          disabled={busy || (over && !limitsUnverified)}
          disabledReason={
            over && !limitsUnverified
              ? i18n._(msg`Over the character limit.`)
              : busy
                ? i18n._(msg`Posting...`)
                : undefined
          }
          testID="composer-submit"
          compact
        />
      </View>
      {/* Repair X7.4 step 7: non-blocking alt-text note (the post stays
          submittable — this never gates). */}
      {showAltNote ? (
        <Caption color="muted" testID="composer-alt-note">
          {i18n._(
            plural(imagesMissingAlt, {
              one: `# attached image has no alt text.`,
              other: `# attached images have no alt text.`,
            }),
          )}
        </Caption>
      ) : null}

      <ReplyPreviewSection c={controller} />
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
        onChangeText={text => {
          patch({text})
          autogrow.remeasure()
        }}
        onSelectionChange={e => setCaret(e.nativeEvent.selection.end)}
        onFocus={() => setInputFocused(true)}
        onBlur={() => setInputFocused(false)}
        placeholder={
          replyTo
            ? i18n._(msg`Write your reply`)
            : quote
              ? i18n._(msg`Add a comment`)
              : i18n._(msg`What's happening?`)
        }
        placeholderTextColor={theme.palette.faint}
        accessibilityLabel={i18n._(msg`Post text`)}
        ref={autogrow.inputRef}
        style={[styles.input, autogrowStyle(autogrow.height), NO_OUTLINE, inputFocused && Platform.OS === 'web' && focusRingStyle(theme)]}
        onContentSizeChange={autogrow.onContentSizeChange}
      />
      <QuotePreviewSection c={controller} />
      <SuggestEmojiSection c={controller} />

      <View style={styles.spread}>
        <Caption color={over ? 'text' : 'muted'} testID="composer-counter">
          {count} / {limits.maxChars}
        </Caption>
        {over && !limitsUnverified ? <Caption>{i18n._(msg`Over the limit`)}</Caption> : null}
        {limitsUnverified ? (
          <Caption color="muted" testID="composer-limit-unverified">
            {i18n._(msg`Server limits couldn't be verified — posting won't be blocked.`)}
          </Caption>
        ) : null}
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
      {confirmingClose ? (
        editing ? (
          <EditCloseDialog onDiscard={discardAndClose} onKeep={keepWriting} />
        ) : (
          <CloseConfirmDialog onSave={saveAndClose} onDiscard={discardAndClose} onKeep={keepWriting} />
        )
      ) : null}

      <Caption color="muted">{i18n._(msg`Audience`)}</Caption>
      <View style={styles.row}>
        {options.map(o => (
          <Chip
            key={o.raw}
            label={o.label}
            selected={state.visibilityRaw === o.raw}
            disabled={editBusy}
            disabledReason={editBusy ? busyReason : undefined}
            onPress={() => patch({visibilityRaw: o.raw})}
            testID={`composer-vis-${o.raw}`}
          />
        ))}
        {gates.localOnly.enabled ? (
          <Chip
            label={i18n._(msg`Local only`)}
            selected={state.localOnly}
            disabled={editBusy}
            disabledReason={editBusy ? busyReason : undefined}
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

      {/* Repair X6.2 step 5: Mastodon-family status-level sensitivity and
          post language (X4.4 `PostDraft` fields). Create mode only — edit
          mode seeds neither, so showing the controls there would change
          edit behaviour (X6.1 owns it). The Misskey family has no such
          wire fields, so the section never renders there. */}
      {!editing && family === 'mastodon' ? (
        <View style={styles.row} testID="composer-sensitive-language">
          <Chip
            label={i18n._(msg`Mark media sensitive`)}
            selected={state.sensitive}
            onPress={() => patch({sensitive: !state.sensitive})}
            testID="composer-sensitive-toggle"
          />
          {languageOptions.length > 0 ? (
            <Caption color="muted">{i18n._(msg`Language`)}</Caption>
          ) : null}
          {languageOptions.map(code => (
            <Chip
              key={code}
              label={code}
              selected={state.language === code}
              onPress={() => patch({language: state.language === code ? null : code})}
              testID={`composer-language-${code}`}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.row}>
        <Chip label={i18n._(msg`Emoji`)} onPress={() => setPickingEmoji(true)} testID="composer-emoji-button" />
        <Chip
          label={i18n._(msg`CW`)}
          selected={state.cwEnabled}
          disabled={editBusy}
          disabledReason={editBusy ? busyReason : undefined}
          onPress={() => patch({cwEnabled: !state.cwEnabled})}
          testID="composer-cw-toggle"
        />
        <Chip
          label={i18n._(msg`Poll`)}
          selected={!!state.poll}
          disabled={!gates.poll.enabled || (!state.poll && pollBlockedByMedia) || editBusy}
          disabledReason={
            editBusy
              ? busyReason
              : !gates.poll.enabled
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
          disabled={mediaFull || mediaBlockedByPoll || editBusy}
          disabledReason={
            editBusy
              ? busyReason
              : mediaBlockedByPoll
                ? i18n._(msg`A post cannot have both media and a poll.`)
                : i18n._(msg`Attachment limit reached.`)
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
        {/* Repair X7.4 step 7: the alt-text reminder pref (default off). */}
        <Chip
          label={i18n._(msg`Remind me about alt text`)}
          selected={remindAlt}
          onPress={() => setRemindAlt(!remindAlt)}
          testID="composer-remind-alt"
        />
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
