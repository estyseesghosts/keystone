// Shared loading skeletons (P6.4): one consistent placeholder language for
// every initial load, matched to the content shape it stands in for.
//
// Variants mirror real row geometry (post = feed rows, account = profile
// rows, row = plain collection rows, card = news rows with a thumb), with
// hairline separators between rows like the loaded lists. Static Views
// only — no animation dependency, reduced-motion safe by default. Skeletons
// replace the old centered spinner for *initial* loads; inline spinners
// stay where they belong (load-more footers, refresh, busy buttons).

import {StyleSheet, View, type DimensionValue} from 'react-native'

import {useTheme} from '#/alf/index'

export type SkeletonVariant = 'post' | 'account' | 'row' | 'card'

function Block({width, height, radius = 6}: {width?: DimensionValue; height: number; radius?: number}) {
  const theme = useTheme()
  return (
    <View
      style={{width, height, borderRadius: radius, backgroundColor: theme.palette.raise}}
    />
  )
}

function Separator() {
  const theme = useTheme()
  return <View style={{height: 1, backgroundColor: theme.palette.border}} />
}

function PostSkeletonRow() {
  return (
    <View style={styles.postRow}>
      <Block width={40} height={40} radius={20} />
      <View style={styles.postCol}>
        <Block width="40%" height={12} />
        <Block width="100%" height={12} />
        <Block width="70%" height={12} />
        <View style={styles.postActions}>
          {[0, 1, 2, 3].map(i => (
            <Block key={i} width={14} height={14} radius={7} />
          ))}
        </View>
      </View>
    </View>
  )
}

function AccountSkeletonRow() {
  return (
    <View style={styles.accountRow}>
      <Block width={44} height={44} radius={22} />
      <View style={styles.accountCol}>
        <Block width="45%" height={14} />
        <Block width="65%" height={12} />
      </View>
    </View>
  )
}

function CollectionRowSkeleton() {
  return (
    <View style={styles.collectionRow}>
      <Block width="45%" height={14} />
      <Block width="85%" height={12} />
      <Block width="60%" height={12} />
    </View>
  )
}

function CardSkeletonRow() {
  return (
    <View style={styles.cardRow}>
      <Block width={112} height={84} radius={8} />
      <View style={styles.cardCol}>
        <Block width="100%" height={13} />
        <Block width="70%" height={12} />
        <Block width="50%" height={12} />
      </View>
    </View>
  )
}

const ROWS: Record<SkeletonVariant, () => React.JSX.Element> = {
  post: PostSkeletonRow,
  account: AccountSkeletonRow,
  row: CollectionRowSkeleton,
  card: CardSkeletonRow,
}

export function SkeletonList({
  variant,
  count = 5,
  testID,
}: {
  variant: SkeletonVariant
  count?: number
  testID?: string
}) {
  const Row = ROWS[variant]
  return (
    <View testID={testID} style={styles.list} accessibilityLabel="Loading">
      {Array.from({length: count}, (_, i) => (
        <View key={i}>
          {i > 0 ? <Separator /> : null}
          <Row />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  list: {flex: 1},
  postRow: {flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12},
  postCol: {flex: 1, gap: 8},
  postActions: {flexDirection: 'row', gap: 28, marginTop: 4},
  accountRow: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8},
  accountCol: {flex: 1, gap: 6, minWidth: 0},
  collectionRow: {gap: 6, paddingHorizontal: 16, paddingVertical: 12},
  cardRow: {flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 8},
  cardCol: {flex: 1, gap: 6, minWidth: 0, justifyContent: 'center'},
})
