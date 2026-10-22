import {useRef, useState} from 'react'
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable as RNPressable,
  StyleSheet,
  TextInput,
  View,
  type View as ViewType,
} from 'react-native'

import {msg} from '@lingui/macro'

import type {ReactionAcceptance} from '@keystone/fedi'
import {REACTION_ACCEPTANCE_LABELS} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {
  AtIcon,
  GlobeIcon,
  HomeIcon,
  LockIcon,
  MediaIcon,
  MoreIcon,
  PollIcon,
  ScheduleIcon,
  SmileIcon,
} from '#/components/icons'
import {
  AnchoredPopup,
  PopupDesc,
  PopupHead,
  PopupRadioDot,
  PopupRow,
  PopupSep,
} from '#/components/Popup'
import {Pressable} from '#/components/Pressable'

import {useComposerController, type ComposerProps} from './Composer'
import {
  CwSection,
  PollSection,
  RecipientSection,
  ScheduledListSection,
  ScheduleSection,
  ServerDraftsSection,
  UploadsSection,
} from './ComposerSections'
import {SuggestionList} from './Autocomplete'
import {EmojiPicker} from '#/components/EmojiPicker'
import {deleteDraft} from '#/storage/drafts'
import {i18n} from '#/locale/i18n'

// Compact composer (Keystone v1 inline/postbox chrome): avatar + borderless
// input, audience pill (anchored visibility popup), icon toolbar (media,
// poll, emoji, CW, more), counter + Post. Advanced options live in the More
// popup — never inline blocks. State and testIDs are shared with the full
// `Composer` through the section components.

const KIND_ICON = {public: GlobeIcon, quiet: HomeIcon, followers: LockIcon, direct: AtIcon} as const
/** Audience-kind descriptions, resolved at render time (never frozen at
 * import — the module evaluates once, the locale switches at runtime). */
function kindDesc(kind: keyof typeof KIND_ICON): string {
  switch (kind) {
    case 'public':
      return i18n._(msg`Shown everywhere`)
    case 'quiet':
      return i18n._(msg`Hidden from global timelines`)
    case 'followers':
      return i18n._(msg`Only your followers`)
    case 'direct':
      return i18n._(msg`Only people you name`)
  }
}

function ComposerAvatar({uri, name}: {uri: string | null; name: string}) {
  const theme = useTheme()
  if (uri) {
    return (
      <Image
        source={{uri}}
        style={styles.avatar}
        accessibilityRole="image"
        accessibilityLabel={name}
      />
    )
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback, {backgroundColor: theme.palette.raise}]}>
      <Body>{name.slice(0, 1).toUpperCase()}</Body>
    </View>
  )
}

function ToolButton({
  testID,
  label,
  onPress,
  disabled,
  reason,
  active,
  children,
}: {
  testID: string
  label: string
  onPress: () => void
  disabled?: boolean
  reason?: string
  active?: boolean
  children: React.ReactNode
}) {
  const theme = useTheme()
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{disabled, selected: active}}
      accessibilityLabel={disabled && reason ? `${label}. ${reason}` : label}
      hitSlop={8}
      style={[
        styles.tool,
        active && {backgroundColor: theme.palette.text},
        disabled && styles.disabled,
      ]}>
      {children}
    </Pressable>
  )
}

export function CompactComposer(props: ComposerProps) {
  const c = useComposerController(props)
  const theme = useTheme()
  const muted = theme.palette.muted
  const [audienceOpen, setAudienceOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [showDraftList, setShowDraftList] = useState(false)
  const audienceAnchor = useRef<ViewType | null>(null)
  const moreAnchor = useRef<ViewType | null>(null)
  const emojiAnchor = useRef<ViewType | null>(null)

  const current = c.options.find(o => o.raw === c.state.visibilityRaw) ?? c.options[0]
  const CurrentIcon = KIND_ICON[current.kind] ?? GlobeIcon
  const advancedActive =
    c.state.reactionAcceptance != null ||
    c.state.localOnly ||
    c.state.noQuote ||
    c.state.scheduledAt != null
  const submitLabel = c.editing
    ? i18n._(msg`Save`)
    : c.state.scheduledAt && c.gates.schedule.enabled
      ? i18n._(msg`Schedule`)
      : c.state.replyTo
        ? i18n._(msg`Reply`)
        : c.state.quote
          ? i18n._(msg`Quote`)
          : i18n._(msg`Post`)
  const remaining = c.limits.maxChars - c.count
  const avatarUri = c.session.user?.avatarUrl ?? null
  const avatarName = c.session.user?.displayName ?? c.session.accountId

  return (
    <KeyboardAvoidingView
      style={styles.root}
      testID="composer-compact"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}>
      {/* C2 close control: inline Home composer has no onClose and stays
          chrome-free (v1 postbox). The full mobile-sheet redesign rides W6 —
          this header button is only a dismiss escape hatch until then. */}
      {c.onClose ? (
        <View style={styles.closeRow}>
          <Button label={i18n._(msg`Cancel`)} variant="secondary" onPress={c.onClose} testID="composer-cancel" />
        </View>
      ) : null}
      {c.state.replyTo ? (
        <View style={styles.context} testID="composer-reply-context">
          <Caption color="muted">{i18n._(msg`Replying to @${c.state.replyTo.author.acct}`)}</Caption>
        </View>
      ) : null}
      {c.state.quote ? (
        <View style={styles.context} testID="composer-quote-context">
          <Caption color="muted">{i18n._(msg`Quoting @${c.state.quote.author.acct}`)}</Caption>
        </View>
      ) : null}
      <View style={styles.topRow}>
        <ComposerAvatar uri={avatarUri} name={avatarName} />
        <View style={styles.inputCol}>
          <TextInput
            testID="composer-text"
            multiline
            value={c.state.text}
            onChangeText={text => c.patch({text})}
            onSelectionChange={e => c.setCaret(e.nativeEvent.selection.end)}
            placeholder={c.state.replyTo ? i18n._(msg`Write your reply`) : i18n._(msg`What's happening?`)}
            placeholderTextColor={theme.palette.faint}
            accessibilityLabel={i18n._(msg`Post text`)}
            // P1: the compose box is prose — it scales with the text setting.
            style={[
              styles.input,
              {
                color: theme.palette.text,
                fontSize: 15 * theme.fontScaleMultiplier,
                lineHeight: 21 * theme.fontScaleMultiplier,
              },
            ]}
          />
          <CwSection c={c} />
        </View>
      </View>
      <PollSection c={c} />
      <UploadsSection c={c} />
      <RecipientSection c={c} />
      <SuggestionList suggestions={c.suggestions} onPick={c.onPickSuggestion} />
      <View style={styles.pillRow}>
        <RNPressable
          ref={audienceAnchor}
          testID="composer-audience"
          onPress={() => setAudienceOpen(v => !v)}
          accessibilityRole="button"
          accessibilityLabel={i18n._(msg`Who can see this post: ${current.label}. Change audience.`)}
          style={[styles.pill, {borderColor: theme.palette.edge}]}>
          <CurrentIcon size={16} color={muted} />
          <Caption color="muted">{current.label}</Caption>
        </RNPressable>
      </View>
      {audienceOpen ? (
        <AnchoredPopup
          anchor={audienceAnchor}
          onClose={() => setAudienceOpen(false)}
          testID="composer-audience-menu"
          minWidth={280}>
          <PopupHead>{i18n._(msg`Who can see this post`)}</PopupHead>
          {c.options.map(o => {
            const Icon = KIND_ICON[o.kind] ?? GlobeIcon
            const selected = c.state.visibilityRaw === o.raw
            return (
              <PopupRow
                key={o.raw}
                testID={`composer-vis-${o.raw}`}
                label={o.label}
                onPress={() => {
                  c.patch({visibilityRaw: o.raw})
                  setAudienceOpen(false)
                }}
                right={<PopupRadioDot on={selected} />}>
                <View style={styles.rowIcon}>
                  <Icon size={18} color={muted} />
                  <PopupDesc>{kindDesc(o.kind)}</PopupDesc>
                </View>
              </PopupRow>
            )
          })}
        </AnchoredPopup>
      ) : null}
      <View style={[styles.divider, {backgroundColor: theme.palette.border}]} />
      <View style={styles.toolbar}>
        <ToolButton
          testID="composer-media-add"
          label={c.uploads.items.length > 0 ? i18n._(msg`Attach media (${c.uploads.items.length} attached)`) : i18n._(msg`Attach media`)}
          disabled={c.mediaFull || c.mediaBlockedByPoll}
          reason={
            c.mediaBlockedByPoll ? i18n._(msg`A post cannot have both media and a poll.`) : i18n._(msg`Attachment limit reached.`)
          }
          onPress={() => void c.addMedia()}>
          <MediaIcon size={20} color={muted} />
        </ToolButton>
        <ToolButton
          testID="composer-poll-toggle"
          label={i18n._(msg`Add a poll`)}
          active={!!c.state.poll}
          disabled={!c.gates.poll.enabled || (!c.state.poll && c.pollBlockedByMedia)}
          reason={!c.gates.poll.enabled ? c.gates.poll.reason : i18n._(msg`A post cannot have both media and a poll.`)}
          onPress={() =>
            c.patch({
              poll: c.state.poll ? null : {choices: ['', ''], multiple: false, durationSeconds: 86400},
            })
          }>
          <PollIcon size={20} color={c.state.poll ? theme.palette.bg : muted} />
        </ToolButton>
        <RNPressable
          ref={emojiAnchor}
          testID="composer-emoji-button"
          onPress={() => {
            // E5: the popup is a separate Modal window — on Android the
            // soft keyboard covers modal content (no adjustResize there)
            // and swallows the first tap. Dismissing first anchors the
            // popup against the full window; the search field re-opens
            // the keyboard on focus when the user wants it.
            Keyboard.dismiss()
            setEmojiOpen(v => !v)
          }}
          accessibilityRole="button"
          accessibilityLabel={i18n._(msg`Insert emoji`)}
          hitSlop={8}
          style={styles.tool}>
          <SmileIcon size={20} color={muted} />
        </RNPressable>
        <ToolButton
          testID="composer-cw-toggle"
          label={i18n._(msg`Content warning`)}
          active={c.state.cwEnabled}
          onPress={() => c.patch({cwEnabled: !c.state.cwEnabled})}>
          <Body style={{color: c.state.cwEnabled ? theme.palette.bg : muted}}>CW</Body>
        </ToolButton>
        <RNPressable
          ref={moreAnchor}
          testID="composer-more"
          onPress={() => setMoreOpen(v => !v)}
          accessibilityRole="button"
          accessibilityLabel={i18n._(msg`More options`)}
          hitSlop={8}
          style={[styles.tool, advancedActive && {backgroundColor: theme.palette.text}]}>
          <MoreIcon size={20} color={advancedActive ? theme.palette.bg : muted} />
          {advancedActive ? <View style={[styles.dot, {backgroundColor: theme.palette.bg}]} /> : null}
        </RNPressable>
        <View style={styles.spacer} />
        <Caption color={c.over ? 'text' : 'muted'} testID="composer-counter">
          {remaining}
        </Caption>
        <Button
          label={c.busy ? i18n._(msg`Posting…`) : submitLabel}
          onPress={() => void c.submit()}
          disabled={c.busy || c.over}
          disabledReason={c.over ? i18n._(msg`Over the character limit.`) : c.busy ? i18n._(msg`Posting...`) : undefined}
          testID="composer-submit"
        />
      </View>
      {emojiOpen ? (
        <AnchoredPopup
          anchor={emojiAnchor}
          onClose={() => setEmojiOpen(false)}
          testID="composer-emoji-popup"
          minWidth={320}>
          <EmojiPicker
            sessionId={c.session.id}
            onPick={e => {
              const at = Math.min(c.caret, c.state.text.length)
              c.patch({text: c.state.text.slice(0, at) + e.key + c.state.text.slice(at)})
              c.setCaret(at + e.key.length)
              setEmojiOpen(false)
            }}
          />
        </AnchoredPopup>
      ) : null}
      {moreOpen ? (
        <AnchoredPopup
          anchor={moreAnchor}
          onClose={() => setMoreOpen(false)}
          testID="composer-more-menu"
          minWidth={280}>
          <PopupHead>{i18n._(msg`Who can react`)}</PopupHead>
          {([{raw: null as string | null, label: i18n._(msg`All reactions`)}].concat(
            (Object.keys(REACTION_ACCEPTANCE_LABELS) as ReactionAcceptance[]).map(k => ({
              raw: k as string | null,
              label: REACTION_ACCEPTANCE_LABELS[k],
            })),
          )).map(o => {
            const selected =
              o.raw === null ? c.state.reactionAcceptance == null : c.state.reactionAcceptance === o.raw
            return (
              <PopupRow
                key={o.label}
                testID={`composer-reaction-${o.raw ?? 'all'}`}
                label={o.label}
                disabled={!c.gates.reactionAcceptance.enabled}
                reason={c.gates.reactionAcceptance.enabled ? undefined : c.gates.reactionAcceptance.reason}
                onPress={() => {
                  c.patch({reactionAcceptance: o.raw as ReactionAcceptance | null})
                }}
                right={<PopupRadioDot on={selected} />}
              />
            )
          })}
          <PopupSep />
          <PopupRow
            testID="composer-no-quote"
            label={i18n._(msg`No quotes for this post`)}
            disabled={!c.gates.noQuote.enabled}
            reason={c.gates.noQuote.enabled ? undefined : c.gates.noQuote.reason}
            onPress={() => c.patch({noQuote: !c.state.noQuote})}
            right={<PopupRadioDot on={c.state.noQuote} />}>
            <PopupDesc>
              {c.gates.noQuote.enabled
                ? i18n._(msg`Only this post refuses quotes. The account-wide setting is in Settings → Account.`)
                : c.gates.noQuote.reason}
            </PopupDesc>
          </PopupRow>
          {c.gates.localOnly.enabled ? (
            <PopupRow
              testID="composer-local-only"
              label={i18n._(msg`Local only`)}
              onPress={() => c.patch({localOnly: !c.state.localOnly})}
              right={<PopupRadioDot on={c.state.localOnly} />}>
              <PopupDesc>{i18n._(msg`Visible only on this server`)}</PopupDesc>
            </PopupRow>
          ) : null}
          {c.gates.schedule.enabled && !c.editing ? (
            <PopupRow
              testID="composer-schedule-toggle"
              label={c.state.scheduledAt ? i18n._(msg`Post now instead`) : i18n._(msg`Schedule…`)}
              onPress={() =>
                c.patch({
                  scheduledAt: c.state.scheduledAt ? null : new Date(Date.now() + 3600_000).toISOString(),
                })
              }
              right={<ScheduleIcon size={18} color={muted} />}>
              <PopupDesc>
                {c.state.scheduledAt
                  ? i18n._(msg`Posts ${new Date(c.state.scheduledAt).toLocaleString()}`)
                  : i18n._(msg`Post at a later time`)}
              </PopupDesc>
            </PopupRow>
          ) : null}
          {c.state.scheduledAt ? (
            <View style={styles.draftList}>
              <ScheduleSection c={c} />
            </View>
          ) : null}
          <View style={styles.draftList}>
            <ScheduledListSection c={c} />
          </View>
          <View style={styles.draftList}>
            <ServerDraftsSection c={c} />
          </View>
          <PopupRow
            testID="composer-drafts-toggle"
            label={c.drafts.length > 0 ? i18n._(msg`Drafts (${c.drafts.length})`) : i18n._(msg`Drafts`)}
            onPress={() => setShowDraftList(v => !v)}>
            <PopupDesc>{i18n._(msg`Unsent posts on this device`)}</PopupDesc>
          </PopupRow>
          {showDraftList ? (
            <View style={styles.draftList}>
              {c.drafts.length === 0 ? (
                <Caption color="muted">{i18n._(msg`No drafts yet.`)}</Caption>
              ) : (
                c.drafts.map(d => (
                  <View key={d.id} style={styles.draftRow}>
                    <Pressable
                      testID={`composer-draft-${d.id}`}
                      onPress={() => {
                        c.restore(d)
                        setMoreOpen(false)
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={i18n._(msg`Restore draft: ${d.text.slice(0, 60) || '(no text)'}`)}
                      style={styles.draftText}>
                      <Body numberOfLines={2}>{d.text.slice(0, 120) || i18n._(msg`(no text)`)}</Body>
                    </Pressable>
                    <Pressable
                      testID={`composer-draft-del-${d.id}`}
                      onPress={() => deleteDraft(c.store, c.session.id, d.id)}
                      accessibilityRole="button"
                      accessibilityLabel={i18n._(msg`Delete this draft`)}
                      hitSlop={8}>
                      <Body>×</Body>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          ) : null}
        </AnchoredPopup>
      ) : null}
      {c.error ? (
        <Body testID="composer-error" accessibilityRole="alert">
          {c.error}
        </Body>
      ) : null}
      {c.notice ? <Body testID="composer-notice">{c.notice}</Body> : null}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: {paddingHorizontal: 16, paddingVertical: 12, gap: 8},
  closeRow: {flexDirection: 'row', justifyContent: 'flex-start'},
  topRow: {flexDirection: 'row', gap: 8},
  avatar: {width: 40, height: 40, borderRadius: 20},
  avatarFallback: {alignItems: 'center', justifyContent: 'center'},
  inputCol: {flex: 1, gap: 8, minWidth: 0},
  input: {minHeight: 72, fontSize: 15, lineHeight: 21, textAlignVertical: 'top'},
  context: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pillRow: {flexDirection: 'row'},
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 9999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  divider: {height: 1},
  toolbar: {flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44},
  tool: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {opacity: 0.5},
  dot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  rowIcon: {flexDirection: 'row', alignItems: 'center', gap: 8},
  spacer: {flex: 1},
  draftList: {paddingHorizontal: 10, paddingVertical: 4, gap: 4},
  draftRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  draftText: {flex: 1},
})
