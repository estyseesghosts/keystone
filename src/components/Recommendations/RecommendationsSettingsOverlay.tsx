import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Modal, Platform, ScrollView, StyleSheet, Switch, View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {overlayChrome} from '#/alf/themes'
import {Body, Caption, Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Pressable} from '#/components/Pressable'
import {showToast} from '#/lib/toast'
import {useLocale} from '#/locale/i18n'
import {useBackendForSessionId} from '#/screens/HomeFeed'
import {
  saveRecommendationSettings,
  useInvalidateRecommendations,
  useRecommendationInterests,
  useRecommendationSettings,
} from '#/state/queries/recommendations'
import {
  REC_ENGAGEMENT_KEYS,
  REC_FACTOR_KEYS,
  REC_LANGUAGES,
  REC_TOPIC_SLUGS,
  defaultRecLanguage,
  type RecEngagementKey,
  type RecFactorKey,
} from '@keystone/fedi'

// Recommendations settings overlay (fork settings page as a popup, not a
// route). Loads from `me.recommendationSettings`, saves via `i/update`,
// then refreshes `me`. Backdrop/X/Escape with unsaved edits asks
// save-or-discard first — never a silent loss.

const FACTOR_CAPTIONS: Record<RecFactorKey, string> = {
  relevancy: 'How closely a post matches your interests.',
  authorAffinity: 'Authors whose style matches your taste.',
  quality: 'Well-written, substantive posts.',
  popularity: 'Posts with many reactions, replies and boosts.',
  recency: 'Prefer newer posts.',
  shortPostPenalty: 'Demote very short text.',
  overTagPenalty: 'Demote hashtag-stuffed posts.',
  replyPenalty: 'Demote standalone replies lacking context.',
  topicPreference: 'Your liked / disliked topics weight.',
  followed: 'Boost for followed authors.',
  similarUsers: 'Boost for posts liked by similar-taste users.',
}

const ENGAGEMENT_CAPTIONS: Record<RecEngagementKey, string> = {
  reaction: 'Reacting to a post.',
  reply: 'Replying to a post.',
  boost: 'Boosting (renoting) a post.',
  favorite: 'Adding a post to favorites.',
  post: 'What you post yourself.',
}

const LANG_NAMES: Record<string, string> = {en: 'English', ja: '日本語', zh: '中文'}

type Draft = {
  enabled: boolean
  recommendNsfw: boolean
  factors: Record<RecFactorKey, number>
  engagement: Record<RecEngagementKey, number>
  interestTopics: string[]
  disinterestTopics: string[]
  languages: string[]
  followedRatio: number
}

function Stepper({
  value,
  min,
  max,
  step,
  onChange,
  testID,
  format,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (next: number) => void
  testID: string
  format: (v: number) => string
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / step) * step))
  const theme = useTheme()
  return (
    <View style={[atoms.row, atoms.itemsCenter, {gap: 12}]}>
      <Pressable
        testID={`${testID}-minus`}
        accessibilityRole="button"
        accessibilityLabel="Decrease"
        onPress={() => onChange(clamp(value - step))}
        style={[styles.stepBtn, {borderColor: theme.palette.edge}]}>
        <Body>−</Body>
      </Pressable>
      <Body testID={`${testID}-value`}>{format(value)}</Body>
      <Pressable
        testID={`${testID}-plus`}
        accessibilityRole="button"
        accessibilityLabel="Increase"
        onPress={() => onChange(clamp(value + step))}
        style={[styles.stepBtn, {borderColor: theme.palette.edge}]}>
        <Body>+</Body>
      </Pressable>
    </View>
  )
}

export function RecommendationsSettingsOverlay({
  open,
  onClose,
  sessionId,
}: {
  open: boolean
  onClose: () => void
  sessionId: string | null
}) {
  const theme = useTheme()
  const locale = useLocale()
  const backend = useBackendForSessionId(sessionId)
  const {settings, isPending} = useRecommendationSettings(sessionId)
  const interests = useRecommendationInterests(sessionId)
  const invalidate = useInvalidateRecommendations(sessionId)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [baseline, setBaseline] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // The interests overlay applies at most once per open (a ref, not state:
  // re-applying the same values would re-render forever).
  const interestsApplied = useRef(false)

  // Seed the form once `me` loads.
  useEffect(() => {
    if (!open || !settings || draft) return
    const seed: Draft = {
      enabled: settings.enabled,
      recommendNsfw: settings.recommendNsfw,
      factors: {...settings.factors},
      engagement: {...settings.engagement},
      interestTopics: [...settings.interestTopics],
      disinterestTopics: [...settings.disinterestTopics],
      languages:
        settings.languages.length > 0 ? [...settings.languages] : [defaultRecLanguage(locale)],
      followedRatio: settings.followedRatio,
    }
    setDraft(seed)
    setBaseline(seed)
  }, [open, settings, draft, locale])

  // Overlay the recommender's live interest read (activity-derived + saved
  // picks) until the user touches the topic lists — same as Sharkey.
  // At most once per open: re-applying equal values would re-render forever.
  useEffect(() => {
    if (!open || interestsApplied.current || interests.isPending || !draft || !baseline) return
    const pristine =
      JSON.stringify(draft.interestTopics) === JSON.stringify(baseline.interestTopics) &&
      JSON.stringify(draft.disinterestTopics) === JSON.stringify(baseline.disinterestTopics)
    interestsApplied.current = true
    if (!pristine) return
    if (interests.interested.length === 0 && interests.disinterested.length === 0) return
    if (
      JSON.stringify(draft.interestTopics) === JSON.stringify(interests.interested) &&
      JSON.stringify(draft.disinterestTopics) === JSON.stringify(interests.disinterested)
    ) {
      return
    }
    const next: Draft = {...draft, interestTopics: [...interests.interested], disinterestTopics: [...interests.disinterested]}
    setDraft(next)
    setBaseline(next)
  }, [open, interests.isPending, interests.interested, interests.disinterested, draft, baseline])

  // Fresh open resets the form.
  useEffect(() => {
    if (!open) {
      setDraft(null)
      setBaseline(null)
      setSaving(false)
      setConfirming(false)
      interestsApplied.current = false
    }
  }, [open])

  const dirty = useMemo(
    () => (draft && baseline ? JSON.stringify(draft) !== JSON.stringify(baseline) : false),
    [draft, baseline],
  )

  // Stable close (dirty/confirming-gated): the keydown effect below and the
  // chrome buttons share one identity, so Escape always reaches the current
  // gate state instead of a stale closure (X8.4).
  const requestClose = useCallback(() => {
    if (dirty && !confirming) {
      setConfirming(true)
      return
    }
    onClose()
  }, [dirty, confirming, onClose])

  useEffect(() => {
    if (!open || Platform.OS !== 'web' || typeof document === 'undefined') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, requestClose])

  if (!open) return null

  async function save() {
    if (!draft || !sessionId) return
    if (draft.languages.length === 0) {
      showToast('Pick at least one language.')
      return
    }
    setSaving(true)
    try {
      await saveRecommendationSettings(sessionId, {
        enabled: draft.enabled,
        recommendNsfw: draft.recommendNsfw,
        factors: {...draft.factors},
        engagement: {...draft.engagement},
        interestTopics: [...draft.interestTopics],
        disinterestTopics: [...draft.disinterestTopics],
        languages: [...draft.languages],
        followedRatio: draft.followedRatio,
      })
      invalidate()
      setBaseline(draft)
      setConfirming(false)
      onClose()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save recommendations settings.')
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setConfirming(false)
    onClose()
  }

  const patch = (p: Partial<Draft>) => {
    if (draft) setDraft({...draft, ...p})
  }
  const toggleLanguage = (l: string) => {
    if (!draft) return
    if (draft.languages.includes(l)) {
      if (draft.languages.length <= 1) return
      patch({languages: draft.languages.filter(x => x !== l)})
    } else {
      patch({languages: [...draft.languages, l]})
    }
  }
  const availableTopics = REC_TOPIC_SLUGS.filter(
    t => !(draft?.interestTopics.includes(t) ?? false) && !(draft?.disinterestTopics.includes(t) ?? false),
  )

  return (
    <Modal visible transparent animationType="none" onRequestClose={requestClose} testID="rec-settings-overlay">
      <View style={[atoms.flex1, atoms.centered]}>
        <Pressable
          testID="rec-settings-overlay-backdrop"
          onPress={requestClose}
          accessibilityRole="button"
          accessibilityLabel="Close recommendations settings"
          style={styles.backdrop}
        />
        <View
          testID="rec-settings-overlay-card"
          style={[styles.card, {backgroundColor: theme.palette.bg, borderColor: theme.palette.border}]}>
          <View style={[atoms.row, atoms.itemsCenter, {gap: 12}]}>
            <View style={atoms.flex1}>
              <Heading>Recommendations</Heading>
            </View>
            <Pressable
              testID="rec-settings-overlay-close"
              onPress={requestClose}
              accessibilityRole="button"
              accessibilityLabel="Close recommendations settings">
              <Heading>✕</Heading>
            </Pressable>
          </View>
          {confirming ? (
            <View style={[atoms.gap_md]} testID="rec-settings-dirty-confirm">
              <Body>You have unsaved changes. Save them or discard?</Body>
              <Button label={saving ? 'Saving…' : 'Save changes'} onPress={save} disabled={saving} testID="rec-settings-confirm-save" />
              <Button label="Discard changes" variant="secondary" onPress={discard} disabled={saving} testID="rec-settings-confirm-discard" />
              <Button label="Keep editing" variant="secondary" onPress={() => setConfirming(false)} disabled={saving} testID="rec-settings-confirm-cancel" />
            </View>
          ) : !draft ? (
            <View style={[atoms.centered, atoms.p_md]} testID="rec-settings-loading">
              <Body>{isPending ? 'Loading…' : backend?.recommendations ? 'Loading…' : 'This server has no recommendations.'}</Body>
            </View>
          ) : (
            <ScrollView testID="rec-settings-form" style={{maxHeight: 520}}>
              <View style={[atoms.gap_md]}>
                <Caption color="faint">
                  Tune how the recommendations feed (the ✨ tab) picks posts for you.
                </Caption>
                <View style={[atoms.row, atoms.itemsCenter, {gap: 12}]}>
                  <View style={atoms.flex1}>
                    <Body>Enable recommendations</Body>
                    <Caption color="faint">When off, the feed is removed and settings below are disabled.</Caption>
                  </View>
                  <Switch
                    testID="rec-settings-enabled"
                    value={draft.enabled}
                    onValueChange={v => patch({enabled: v})}
                    disabled={saving}
                  />
                </View>
                <Button
                  label={saving ? 'Saving…' : 'Save'}
                  onPress={save}
                  disabled={saving || draft.languages.length === 0}
                  testID="rec-settings-save-top"
                />
                <View style={draft.enabled ? undefined : styles.disabled} testID="rec-settings-fields">
                  <Body>Languages</Body>
                  <Caption color="faint">Posts from all selected languages are pooled and ranked together.</Caption>
                  <View style={[atoms.row, {gap: 8, flexWrap: 'wrap'}]}>
                    {REC_LANGUAGES.map(l => {
                      const on = draft.languages.includes(l)
                      return (
                        <Pressable
                          key={l}
                          testID={`rec-settings-lang-${l}`}
                          accessibilityRole="button"
                          onPress={() => toggleLanguage(l)}
                          disabled={saving || !draft.enabled}
                          style={[
                            styles.chip,
                            {borderColor: theme.palette.edge},
                            on && {
                              borderColor: theme.palette.borderStrong,
                              backgroundColor: theme.palette.raise,
                            },
                          ]}>
                          <Body>{LANG_NAMES[l] ?? l}</Body>
                        </Pressable>
                      )
                    })}
                  </View>
                  <Body>Followed-post share: {Math.round(draft.followedRatio * 100)}%</Body>
                  <Caption color="faint">Share of the feed from follows (max 7 days old, unseen). 0% = off.</Caption>
                  <Stepper
                    value={draft.followedRatio}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={v => patch({followedRatio: v})}
                    testID="rec-settings-followed-ratio"
                    format={v => `${Math.round(v * 100)}%`}
                  />
                  <Body>Ranking factors</Body>
                  <Caption color="faint">Each slider multiplies how much a factor counts: 0 ignores it, 1 keeps the default, 2 doubles it.</Caption>
                  {REC_FACTOR_KEYS.map(k => (
                    <View key={k} style={[atoms.gap_sm]}>
                      <Body>{k}</Body>
                      <Caption color="faint">{FACTOR_CAPTIONS[k]}</Caption>
                      <Stepper
                        value={draft.factors[k]}
                        min={0}
                        max={2}
                        step={0.1}
                        onChange={v => patch({factors: {...draft.factors, [k]: v}})}
                        testID={`rec-settings-factor-${k}`}
                        format={v => `×${v.toFixed(1)}`}
                      />
                    </View>
                  ))}
                  <Body>Interaction weights</Body>
                  <Caption color="faint">How strongly each interaction nudges your interests toward similar posts.</Caption>
                  {REC_ENGAGEMENT_KEYS.map(k => (
                    <View key={k} style={[atoms.gap_sm]}>
                      <Body>{k}</Body>
                      <Caption color="faint">{ENGAGEMENT_CAPTIONS[k]}</Caption>
                      <Stepper
                        value={draft.engagement[k]}
                        min={0}
                        max={2}
                        step={0.1}
                        onChange={v => patch({engagement: {...draft.engagement, [k]: v}})}
                        testID={`rec-settings-engagement-${k}`}
                        format={v => `×${v.toFixed(1)}`}
                      />
                    </View>
                  ))}
                  <View style={[atoms.row, atoms.itemsCenter, {gap: 12}]}>
                    <View style={atoms.flex1}>
                      <Body>Recommend NSFW posts</Body>
                      <Caption color="faint">When off, posts with sensitive media are never recommended.</Caption>
                    </View>
                    <Switch
                      testID="rec-settings-nsfw"
                      value={draft.recommendNsfw}
                      onValueChange={v => patch({recommendNsfw: v})}
                      disabled={saving}
                    />
                  </View>
                  <Body>Interested in</Body>
                  <View style={[atoms.row, {gap: 8, flexWrap: 'wrap'}]}>
                    {draft.interestTopics.map(t => (
                      <Pressable
                        key={t}
                        testID={`rec-settings-interested-${t}`}
                        onPress={() => patch({interestTopics: draft.interestTopics.filter(x => x !== t)})}
                        style={[
                          styles.chip,
                          {
                            borderColor: theme.palette.borderStrong,
                            backgroundColor: theme.palette.raise,
                          },
                        ]}>
                        <Body>{t} ✕</Body>
                      </Pressable>
                    ))}
                    {availableTopics.map(t => (
                      <Pressable
                        key={t}
                        testID={`rec-settings-add-interest-${t}`}
                        onPress={() => patch({interestTopics: [...draft.interestTopics, t]})}
                        style={[styles.chip, {borderColor: theme.palette.edge}]}>
                        <Body>+ {t}</Body>
                      </Pressable>
                    ))}
                  </View>
                  <Body>Not interested in</Body>
                  <View style={[atoms.row, {gap: 8, flexWrap: 'wrap'}]}>
                    {draft.disinterestTopics.map(t => (
                      <Pressable
                        key={t}
                        testID={`rec-settings-disinterested-${t}`}
                        onPress={() => patch({disinterestTopics: draft.disinterestTopics.filter(x => x !== t)})}
                        style={[styles.chip, {borderColor: theme.palette.borderStrong}]}>
                        <Body>{t} ✕</Body>
                      </Pressable>
                    ))}
                    {availableTopics.map(t => (
                      <Pressable
                        key={t}
                        testID={`rec-settings-add-disinterest-${t}`}
                        onPress={() => patch({disinterestTopics: [...draft.disinterestTopics, t]})}
                        style={[styles.chip, {borderColor: theme.palette.edge}]}>
                        <Body>+ {t}</Body>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <Button
                  label={saving ? 'Saving…' : 'Save'}
                  onPress={save}
                  disabled={saving || draft.languages.length === 0}
                  testID="rec-settings-save-bottom"
                />
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {...StyleSheet.absoluteFill, backgroundColor: overlayChrome.backdrop, opacity: 0.4},
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    margin: 16,
    gap: 12,
    maxWidth: 560,
    width: '92%',
  },
  disabled: {opacity: 0.5},
  chip: {paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1},
  stepBtn: {paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderRadius: 8},
})
