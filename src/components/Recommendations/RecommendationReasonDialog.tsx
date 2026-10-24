import {ScrollView, StyleSheet, View} from 'react-native'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Dialog} from '#/components/Dialog'
import type {RecommendationBreakdown} from '@keystone/fedi'

// Why-recommended dialog: the per-note ranking breakdown shipped transiently
// on the note (`Post.ext.recommendation`). No API call on open — all data
// is already on the note. Own layout, same contracts as Sharkey's
// `MkRecommendationReason` (summary, additive table, recency multiplier,
// learned ranker when a model drove the ranking).

const ENGAGEMENT_LABELS: Record<string, string> = {
  reaction: 'Reaction',
  favorite: 'Favorite',
  renote: 'Renote',
  reply: 'Reply',
  dwell: 'Good click',
  replyEngagedByAuthor: 'Reply engaged by author',
  dislike: 'Not interested',
}

function engagementLabel(key: string): string {
  return ENGAGEMENT_LABELS[key] ?? key
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
  const additive = (breakdown?.rows ?? []).filter(r => r.kind === 'add')
  const mult = (breakdown?.rows ?? []).filter(r => r.kind === 'mult')
  return (
    <Dialog open={open} onClose={onClose} title="Why is this post recommended?" testID="rec-reason-dialog">
      {breakdown ? (
        <ScrollView testID="rec-reason-body" style={{maxHeight: 480}}>
          <View style={styles.block}>
            <Body>Final score: {breakdown.score.toFixed(3)}</Body>            {breakdown.topic ? <Caption color="muted">Inferred topic: {breakdown.topic}</Caption> : null}
            <Caption color="muted">
              Type: {breakdown.type === 'following' ? 'Following' : 'Score'}
            </Caption>
            {breakdown.type === 'following' ? (
              <Caption color="muted" testID="rec-reason-following-note">
                This post is from an account you follow. It&apos;s still scored and ranked like discovery posts.
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
              <Body style={styles.cellName}>Subtotal</Body>
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
              <Body style={styles.cellName}>Final score</Body>
              <Body style={styles.cellNum}>{breakdown.score.toFixed(3)}</Body>
            </View>
          </View>
          {breakdown.engagements && breakdown.engagements.length > 0 ? (
            <View style={styles.block} testID="rec-reason-learned">
              <Body>
                Learned ranker · {Math.round((breakdown.rankerWeight ?? 0) * 100)}% blend · score{' '}
                {(breakdown.learnedScore ?? 0).toFixed(2)}
              </Body>
              {breakdown.engagements.map(row => (
                <View key={row.key} style={[styles.row, {borderBottomColor: theme.palette.border}]}>
                  <Body style={styles.cellName}>{engagementLabel(row.key)}</Body>
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
