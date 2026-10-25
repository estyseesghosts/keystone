import {ScrollView, StyleSheet, View} from 'react-native'
import {msg} from '@lingui/macro'
import {useI18n} from '#/locale/i18n'
import type {I18n} from '@lingui/core'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Dialog} from '#/components/Dialog'
import type {RecommendationBreakdown} from '@keystone/fedi'

// Why-recommended dialog: the per-note ranking breakdown shipped transiently
// on the note (`Post.ext.recommendation`). No API call on open — all data
// is already on the note. Own layout, same contracts as Sharkey's
// `MkRecommendationReason` (summary, additive table, recency multiplier,
// learned ranker when a model drove the ranking).

// Ranking-factor labels, resolved at render time (a module constant would
// freeze the boot locale — the locale switches at runtime). Unknown keys
// render raw: they are server-supplied data, never translated.
function engagementLabel(i18n: I18n, key: string): string {
  switch (key) {
    case 'reaction':
      return i18n._(msg({message: 'Reaction', context: 'recommendation factor', comment: 'Label for the reaction ranking factor'}))
    case 'favorite':
      return i18n._(msg({message: 'Favorite', context: 'recommendation factor', comment: 'Label for the favorite ranking factor'}))
    case 'renote':
      return i18n._(msg({message: 'Renote', context: 'recommendation factor', comment: 'Label for the repost ranking factor'}))
    case 'reply':
      return i18n._(msg({message: 'Reply', context: 'recommendation factor', comment: 'Label for the reply ranking factor'}))
    case 'dwell':
      return i18n._(msg`Good click`)
    case 'replyEngagedByAuthor':
      return i18n._(msg`Reply engaged by author`)
    case 'dislike':
      return i18n._(msg`Not interested`)
    default:
      return key
  }
}

export function RecommendationReasonDialog({
  breakdown,
  open,
  onClose,
}: {
  breakdown: RecommendationBreakdown | null
  open: boolean
  onClose: () => void
}) {
  const theme = useTheme()
  const i18n = useI18n()
  const additive = (breakdown?.rows ?? []).filter(r => r.kind === 'add')
  const mult = (breakdown?.rows ?? []).filter(r => r.kind === 'mult')
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={i18n._(msg`Why is this post recommended?`)}
      testID="rec-reason-dialog">
      {breakdown ? (
        <ScrollView testID="rec-reason-body" style={{maxHeight: 480}}>
          <View style={styles.block}>
            <Body>{i18n._(msg`Final score: ${breakdown.score.toFixed(3)}`)}</Body>
            {breakdown.topic ? (
              <Caption color="muted">{i18n._(msg`Inferred topic: ${breakdown.topic}`)}</Caption>
            ) : null}
            <Caption color="muted">
              {breakdown.type === 'following' ? i18n._(msg`Type: Following`) : i18n._(msg`Type: Score`)}
            </Caption>
            {breakdown.type === 'following' ? (
              <Caption color="muted" testID="rec-reason-following-note">
                {i18n._(msg`This post is from an account you follow. It's still scored and ranked like discovery posts.`)}
              </Caption>
            ) : null}
          </View>
          <View style={[styles.table, {borderColor: theme.palette.border}]}>
            {additive.map(row => (
              <View
                key={row.key}
                style={[styles.row, {borderBottomColor: theme.palette.border}]}
                testID={`rec-reason-row-${row.key}`}>
                <Body style={styles.cellName}>{row.key}</Body>
                <Body style={styles.cellNum}>{row.raw.toFixed(2)}</Body>
                <Body style={styles.cellNum}>×{row.weight.toFixed(2)}</Body>
                <Body style={styles.cellNum}>×{row.coeff.toFixed(1)}</Body>
                <Body style={[styles.cellNum, row.coeff === 0 && styles.muted]}>
                  {(row.effect >= 0 ? '+' : '') + row.effect.toFixed(3)}
                </Body>
              </View>
            ))}
            <View style={[styles.row, {borderBottomColor: theme.palette.border}]}>
              <Body style={styles.cellName}>{i18n._(msg`Subtotal`)}</Body>
              <Body style={styles.cellNum}>{breakdown.subtotal.toFixed(3)}</Body>
            </View>
            {mult.map(row => (
              <View
                key={row.key}
                style={[styles.row, {borderBottomColor: theme.palette.border}]}
                testID={`rec-reason-row-${row.key}`}>
                <Body style={styles.cellName}>{row.key}</Body>
                <Body style={styles.cellNum}>×{row.effect.toFixed(2)}</Body>
              </View>
            ))}
            <View style={[styles.row, {borderBottomColor: theme.palette.border}]}>
              <Body style={styles.cellName}>{i18n._(msg`Final score`)}</Body>
              <Body style={styles.cellNum}>{breakdown.score.toFixed(3)}</Body>
            </View>
          </View>
          {breakdown.engagements && breakdown.engagements.length > 0 ? (
            <View style={styles.block} testID="rec-reason-learned">
              <Body>
                {i18n._(
                  msg`Learned ranker · ${Math.round((breakdown.rankerWeight ?? 0) * 100)}% blend · score ${(breakdown.learnedScore ?? 0).toFixed(2)}`,
                )}
              </Body>
              {breakdown.engagements.map(row => (
                <View key={row.key} style={[styles.row, {borderBottomColor: theme.palette.border}]}>
                  <Body style={styles.cellName}>{engagementLabel(i18n, row.key)}</Body>
                  <Body style={styles.cellNum}>{(row.prob * 100).toFixed(1)}%</Body>
                  <Body style={styles.cellNum}>{row.value.toFixed(1)}</Body>
                  <Body style={styles.cellNum}>
                    {(row.effect >= 0 ? '+' : '') + row.effect.toFixed(2)}
                  </Body>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </Dialog>
  )
}

const styles = StyleSheet.create({
  block: {gap: 4, marginBottom: 12},
  table: {borderTopWidth: 1, marginBottom: 12},
  row: {flexDirection: 'row', gap: 8, paddingVertical: 6, borderBottomWidth: 1},
  cellName: {flex: 2},
  cellNum: {flex: 1, textAlign: 'right'},
  muted: {opacity: 0.45},
})
