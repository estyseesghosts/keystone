import {useEffect, useState} from 'react'
import {Image, Keyboard, StyleSheet, View} from 'react-native'

import {msg} from '@lingui/macro'

import {
  structuredUrisOf,
  type Post,
  type ScheduledNote,
  type ServerDraft,
} from '@keystone/fedi'

import {space} from '#/alf/tokens'
import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {DisplayName} from '#/components/DisplayName'
import {RichText} from '#/components/RichText'
import {PostQuote} from '#/components/Post/PostQuote'
import {postBodyNodes, postEmojis} from '#/components/Post/body'
import {formatRelativeTime} from '#/components/Post/time'
import {errorText} from '#/lib/localeErrors'
import {useLocale} from '#/locale/i18n'
import {formatDateTime, formatDuration} from '#/locale/format'
import {useNow} from '#/locale/ticker'
import {TextField} from '#/components/forms/TextField'
import {Dialog} from '#/components/Dialog'
import {EmojiPicker} from '#/components/EmojiPicker'
import {Loader} from '#/components/Loader'
import {
  useCancelScheduled,
  useDeleteServerDraft,
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

const POLL_DURATIONS = [300, 3600, 86400, 604800]

export function CwSection({c}: {c: ComposerController}) {
  if (!c.state.cwEnabled) return null
  // Repair X6.1 F3: CW text is frozen while an edit save is in flight.
  // Create-mode behaviour (X6.2) is untouched — the gate is edit-only.
  const locked = c.editing != null && c.busy
  return (
    <>
      <TextField
        label={i18n._(msg`Content warning`)}
        value={c.state.cw}
        onChangeText={cw => {
          if (locked) return
          c.patch({cw})
        }}
        editable={!locked}
        testID="composer-cw"
      />
      {locked ? (
        <Caption color="muted" testID="composer-cw-busy-reason">
          {i18n._(msg`Saving…`)}
        </Caption>
      ) : null}
    </>
  )
}

// Reply + quote previews (docs/quotes): the composer shows the real
// referenced post, not a one-line caption — the full original above the
// reply box (with its own nested quote card when it quotes), and the
// full quoted card below the comment box.

function PreviewAvatar({uri, name, size}: {uri: string | null; name: string; size: number}) {
  const theme = useTheme()
  if (uri) {
    return (
      <Image
        source={{uri}}
        style={{width: size, height: size, borderRadius: size / 2}}
        accessibilityRole="image"
        accessibilityLabel={name}
      />
    )
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.palette.raise,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Body>{name.slice(0, 1).toUpperCase()}</Body>
    </View>
  )
}

const previewStyles = StyleSheet.create({
  block: {gap: 8},
  opRow: {flexDirection: 'row', gap: 8},
  rail: {width: 40, alignItems: 'center'},
  thread: {flex: 1, width: 2, marginTop: 4},
  opBody: {flex: 1, minWidth: 0, gap: 4},
  opHead: {flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap'},
})

export function ReplyPreviewSection({c}: {c: ComposerController}) {
  const theme = useTheme()
  const locale = useLocale()
  const nowMs = useNow()
  const replyTo = c.state.replyTo
  if (!replyTo) return null
  return (
    <View testID="composer-reply-preview" style={previewStyles.block}>
      <View style={previewStyles.opRow}>
        <View style={previewStyles.rail}>
          <PreviewAvatar uri={replyTo.author.avatarUrl} name={replyTo.author.displayName} size={40} />
          <View style={[previewStyles.thread, {backgroundColor: theme.palette.border}]} />
        </View>
        <View style={previewStyles.opBody}>
          <View style={previewStyles.opHead}>
            <DisplayName account={replyTo.author} sessionId={c.session.id} />
            <Caption color="muted" numberOfLines={1}>
              @{replyTo.author.acct} · {formatRelativeTime(replyTo.createdAt, nowMs, locale)}
            </Caption>
          </View>
          <RichText
            nodes={postBodyNodes(replyTo, {coveredQuoteUris: structuredUrisOf(replyTo)})}
            emojis={postEmojis(replyTo)}
            sessionId={c.session.id}
            authorHost={replyTo.author.host ?? null}
          />
          {replyTo.quote ? (
            <PostQuote
              quote={replyTo.quote}
              unavailable={false}
              sessionId={c.session.id}
              testID="composer-reply-quote"
            />
          ) : null}
        </View>
      </View>
      <Caption testID="composer-replying-to">
        {i18n._(msg`Replying to @${replyTo.author.acct}`)}
      </Caption>
    </View>
  )
}

export function QuotePreviewSection({c}: {c: ComposerController}) {
  const quote = c.state.quote
  if (!quote) return null
  return (
    <PostQuote
      quote={quote}
      unavailable={false}
      sessionId={c.session.id}
      testID="composer-quote-preview"
    />
  )
}

export function PollSection({c}: {c: ComposerController}) {
  const locale = useLocale()
  if (!c.state.poll) return null
  // Repair X6.1 F3: poll controls are frozen while an edit save is in
  // flight. Edit-only gate so create-mode behaviour (X6.2) is untouched.
  const locked = c.editing != null && c.busy
  const lockedReason = i18n._(msg`Saving…`)
  return (
    <View style={{gap: space.sm}} testID="composer-poll">
      {locked ? (
        <Caption color="muted" testID="composer-poll-busy-reason">
          {lockedReason}
        </Caption>
      ) : null}
      {c.state.poll.choices.map((choice, i) => (
        <TextField
          key={i}
          label={i18n._(msg`Choice ${i + 1}`)}
          value={choice}
          editable={!locked}
          onChangeText={t => {
            if (locked) return
            c.patch({
              poll: {...c.state.poll!, choices: c.state.poll!.choices.map((x, j) => (j === i ? t : x))},
            })
          }}
        />
      ))}
      <View style={c.styles.row}>
        {c.state.poll.choices.length < c.limits.maxPollOptions ? (
          <Chip
            label={i18n._(msg`Add choice`)}
            disabled={locked}
            disabledReason={locked ? lockedReason : undefined}
            onPress={() => c.patch({poll: {...c.state.poll!, choices: [...c.state.poll!.choices, '']}})}
          />
        ) : null}
        {c.state.poll.choices.length > 2 ? (
          <Chip
            label={i18n._(msg`Remove last`)}
            disabled={locked}
            disabledReason={locked ? lockedReason : undefined}
            onPress={() => c.patch({poll: {...c.state.poll!, choices: c.state.poll!.choices.slice(0, -1)}})}
          />
        ) : null}
        <Chip
          label={i18n._(msg`Multiple choice`)}
          selected={c.state.poll.multiple}
          disabled={!c.gates.pollMultiple.enabled || locked}
          disabledReason={locked ? lockedReason : c.gates.pollMultiple.enabled ? undefined : c.gates.pollMultiple.reason}
          onPress={() => c.patch({poll: {...c.state.poll!, multiple: !c.state.poll!.multiple}})}
        />
        <Chip
          label={i18n._(msg`Hide totals`)}
          selected={c.state.poll.hideTotals}
          disabled={!c.gates.pollHideTotals.enabled || locked}
          disabledReason={locked ? lockedReason : c.gates.pollHideTotals.enabled ? undefined : c.gates.pollHideTotals.reason}
          onPress={() => c.patch({poll: {...c.state.poll!, hideTotals: !c.state.poll!.hideTotals}})}
          testID="composer-poll-hide-totals"
        />
      </View>
      <View style={c.styles.row}>
        {POLL_DURATIONS.map(seconds => (
          <Chip
            key={seconds}
            label={formatDuration(seconds, locale)}
            selected={c.state.poll!.durationSeconds === seconds}
            disabled={locked}
            disabledReason={locked ? lockedReason : undefined}
            onPress={() => c.patch({poll: {...c.state.poll!, durationSeconds: seconds}})}
          />
        ))}
      </View>
    </View>
  )
}

export function UploadsSection({c}: {c: ComposerController}) {
  const sensitiveGate = c.gates.mediaSensitive
  // Repair X6.1 F3: in edit mode, alt text and Remove freeze while the
  // save is in flight. Edit-only gate so create-mode (X6.2) is untouched.
  const locked = c.editing != null && c.busy
  const lockedReason = i18n._(msg`Saving…`)
  return (
    <>
      {c.videoNotice ?? null ? (
        <View style={c.styles.row} testID="composer-video-notice">
          <Caption color="muted">{c.videoNotice}</Caption>
          <Chip
            label={i18n._(msg`Got it`)}
            onPress={() => c.dismissVideoNotice()}
            testID="composer-video-notice-dismiss"
          />
        </View>
      ) : null}
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
                  ? u.progress && u.progress.total
                    ? i18n._(msg`Uploading ${Math.round((u.progress.loaded / u.progress.total) * 100)}%`)
                    : i18n._(msg`Uploading…`)
                  : u.status === 'processing'
                    ? i18n._(msg`Still processing…`)
                    : u.status === 'done'
                      ? i18n._(msg`uploaded`)
                      : (u.error ?? i18n._(msg`failed`))}
            </Caption>
            <TextField
              label={i18n._(msg`Description (alt text)`)}
              value={u.alt}
              onChangeText={t => {
                if (locked) return
                c.uploads.setAlt(u.key, t)
              }}
              editable={(c.gates.mediaDescription.enabled || u.status !== 'done') && !locked}
              placeholder={
                locked
                  ? lockedReason
                  : u.status === 'done' && !c.gates.mediaDescription.enabled
                    ? c.gates.mediaDescription.reason
                    : i18n._(msg`Describe the media`)
              }
              testID={`composer-upload-alt-${u.key}`}
            />
            {locked ? (
              <Caption color="muted" testID={`composer-upload-busy-reason-${u.key}`}>
                {lockedReason}
              </Caption>
            ) : null}
            {u.status === 'done' && !c.gates.mediaDescription.enabled ? (
              <Caption color="muted" testID={`composer-upload-alt-reason-${u.key}`}>
                {c.gates.mediaDescription.reason}
              </Caption>
            ) : null}
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
              {/* D9 opt-out (repair X7.4 step 6): send this upload's
                  original bytes unchanged. Fixed once the file is on the
                  server (like sensitivity); frozen while an edit saves. */}
              <Chip
                label={i18n._(msg`Keep original`)}
                selected={u.keepOriginal ?? false}
                disabled={locked || u.status === 'done' || u.status === 'uploading'}
                disabledReason={
                  locked
                    ? lockedReason
                    : u.status === 'uploading'
                      ? i18n._(msg`Locked while uploading`)
                      : u.status === 'done'
                        ? i18n._(msg`Locked after upload`)
                        : undefined
                }
                onPress={() => c.uploads.setKeepOriginal(u.key, !(u.keepOriginal ?? false))}
                testID={`composer-upload-keep-${u.key}`}
              />
            </View>
            {u.keepOriginal ?? false ? (
              <Caption color="muted" testID={`composer-upload-gps-${u.key}`}>
                {u.hadGps === true
                  ? i18n._(
                      msg`This photo contains location data, which will be sent unchanged.`,
                    )
                  : i18n._(msg`Originals may include location and device data.`)}
              </Caption>
            ) : null}
          </View>
          {u.status === 'uploading' ? (
            <Chip
              label={i18n._(msg`Cancel upload`)}
              disabled={locked}
              disabledReason={locked ? lockedReason : undefined}
              onPress={() => c.uploads.cancel(u.key)}
              testID={`composer-upload-cancel-${u.key}`}
            />
          ) : null}
          <Chip
            label={i18n._(msg`Remove`)}
            disabled={locked}
            disabledReason={locked ? lockedReason : undefined}
            onPress={() => c.uploads.remove(u.key)}
            testID={`composer-upload-remove-${u.key}`}
          />
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

/**
 * Descriptions of attachments the post ALREADY carries (edit mode and
 * delete-and-redraft; clickstone §1.7). The file is on the server, so the
 * text is saved through `Backend.updateMedia` on submit — never re-uploaded.
 * Where the backend has no such endpoint the field is disabled WITH the
 * gate's reason (never "locked after upload" with no explanation).
 */
export function SeededMediaSection({c}: {c: ComposerController}) {
  const gate = c.gates.mediaDescription
  if (c.state.media.length === 0) return null
  // Repair X6.1 F3: seeded Remove and alt text freeze while the edit save
  // is in flight (redraft create-mode is untouched — the gate is
  // edit-only).
  const locked = c.editing != null && c.busy
  const lockedReason = i18n._(msg`Saving…`)
  return (
    <>
      {c.state.media.map(m => (
        <View key={m.id} style={c.styles.media} testID={`composer-seeded-${m.id}`}>
          {m.previewUrl ? (
            <Image source={{uri: m.previewUrl}} style={c.styles.thumb} accessibilityLabel={m.alt} />
          ) : (
            <View style={c.styles.thumb} />
          )}
          <View style={{flex: 1, gap: space.xs}}>
            <Caption color="muted">{i18n._(msg`Attached to this post`)}</Caption>
            <TextField
              label={i18n._(msg`Description (alt text)`)}
              value={m.alt}
              onChangeText={t => (gate.enabled && !locked ? c.setSeededAlt(m.id, t) : undefined)}
              editable={gate.enabled && !locked}
              placeholder={locked ? lockedReason : gate.enabled ? i18n._(msg`Describe the media`) : gate.reason}
              testID={`composer-seeded-alt-${m.id}`}
            />
            {locked ? (
              <Caption color="muted" testID={`composer-seeded-busy-reason-${m.id}`}>
                {lockedReason}
              </Caption>
            ) : null}
            {!gate.enabled ? (
              <Caption color="muted" testID={`composer-seeded-alt-reason-${m.id}`}>
                {gate.reason}
              </Caption>
            ) : null}
          </View>
          <Chip
            label={i18n._(msg`Remove`)}
            disabled={locked}
            disabledReason={locked ? lockedReason : undefined}
            onPress={() => c.removeSeeded(m.id)}
            testID={`composer-seeded-remove-${m.id}`}
          />
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
      setError(errorText(i18n, err, i18n._(msg`Could not resolve "${raw}".`)))
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
  // Location label (slice 3): where the backend also offers server drafts
  // the local rows are headed "On this device" so the two sources are never
  // confused. Backends without server drafts (Mastodon) render exactly the
  // pre-slice list — no label, no fake server section.
  const hasServer = !!c.backend.serverDrafts
  if (c.drafts.length === 0) {
    if (!c.showDrafts) return null
    if (!hasServer) return <Caption color="muted">{i18n._(msg`No saved drafts.`)}</Caption>
    return (
      <View style={{gap: space.sm}} testID="composer-drafts">
        <Caption color="muted">{i18n._(msg`On this device`)}</Caption>
        <Caption color="muted">{i18n._(msg`No drafts on this device.`)}</Caption>
      </View>
    )
  }
  return (
    <View style={{gap: space.sm}} testID="composer-drafts">
      {hasServer ? <Caption color="muted">{i18n._(msg`On this device`)}</Caption> : null}
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
              {formatDateTime(s.scheduledAt, i18n.locale)} — {scheduledSnippet(s)}
            </Caption>
            <Chip
              label={i18n._(msg`Cancel`)}
              disabled={cancel.isPending}
              onPress={() =>
                cancel.mutate(s.id, {
                  onError: err => c.setError(errorText(i18n, err, i18n._(msg`Could not cancel.`)),)
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
// Restoring opens the draft IN PLACE: the controller remembers the server
// id, so the next save (the explicit button below or the close-guard Save)
// UPDATES it instead of creating a duplicate. Restoring brings text/CW/
// visibility/recipients/schedule/poll and reply/quote targets; attachments
// stay on the server draft and must be re-attached (local files cannot
// round-trip through a listing).
export function ServerDraftsSection({c}: {c: ComposerController}) {
  const list = useServerDrafts(c.session, c.backend)
  const del = useDeleteServerDraft(c.session, c.backend)
  const [busy, setBusy] = useState(false)
  if (!c.backend.serverDrafts) return null

  const saveCurrent = async () => {
    setBusy(true)
    try {
      // Update-in-place when this composer opened a server draft, create
      // otherwise; the controller remembers a fresh id too, so a second
      // save keeps updating the same row. Validation and wire failures
      // surface through the composer's error line, like every submit.
      await c.saveServerDraftNow()
    } catch (err) {
      c.setError(errorText(i18n, err, i18n._(msg`Could not save the draft.`)))
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
              onPress={() => c.restoreServerDraft(d)}
              testID={`composer-serverdraft-restore-${d.id}`}
            />
            <Chip
              label={i18n._(msg`Delete`)}
              disabled={del.isPending}
              onPress={() =>
                del.mutate(d.id, {
                  onError: err => c.setError(errorText(i18n, err, i18n._(msg`Could not delete.`)),)
                })
              }
              testID={`composer-serverdraft-del-${d.id}`}
            />
          </View>
        ))
      )}
      <View style={c.styles.row}>
        {/* Repair X6.1 F2: no "Save as draft" in edit mode — the button
            is hidden (the close dialog hides Save too). The list stays so
            an edit can still restore a server draft as its base. */}
        {c.editing ? null : (
          <Chip
            label={busy ? i18n._(msg`Saving…`) : i18n._(msg`Save current as server draft`)}
            disabled={busy}
            onPress={() => void saveCurrent()}
            testID="composer-serverdraft-save"
          />
        )}
      </View>
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
