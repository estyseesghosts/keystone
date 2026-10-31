// Mosaic (P6.6 slice 2, DC-4): 1 / 2 / 3 / 4 image layouts. Square
// tile, 1px transparent gaps (the surface behind shows through).
// Empty = the caller's icon fallback. Sensitivity blurs in `Thumb`.

import {StyleSheet, View} from 'react-native';

import {AppImage} from '#/components/Image';

const GAP = 1;

const styles = StyleSheet.create({
  tile: {width: '100%', aspectRatio: 1, overflow: 'hidden', borderRadius: 8},
  row: {flex: 1, flexDirection: 'row', gap: GAP},
  col: {flex: 1, gap: GAP},
  cell: {flex: 1, overflow: 'hidden'},
});

function Cell({url}: {url: string}) {
  return (
    <View style={styles.cell}>
      <AppImage uri={url} contentFit="cover" style={{width: '100%', height: '100%'}} />
    </View>
  );
}

export function Mosaic({
  images,
  testID,
}: {
  images: Array<{url: string}>;
  testID?: string;
}) {
  const shown = images.slice(0, 4);
  return (
    <View style={styles.tile} testID={testID}>
      {shown.length <= 1 ? (
        <View style={styles.cell}>
          {shown[0] ? (
            <AppImage uri={shown[0].url} contentFit="cover" style={{width: '100%', height: '100%'}} />
          ) : null}
        </View>
      ) : shown.length === 2 ? (
        <View style={styles.row}>
          <Cell url={shown[0]!.url} />
          <Cell url={shown[1]!.url} />
        </View>
      ) : shown.length === 3 ? (
        <View style={styles.row}>
          <Cell url={shown[0]!.url} />
          <View style={styles.col}>
            <Cell url={shown[1]!.url} />
            <Cell url={shown[2]!.url} />
          </View>
        </View>
      ) : (
        <View style={styles.col}>
          <View style={styles.row}>
            <Cell url={shown[0]!.url} />
            <Cell url={shown[1]!.url} />
          </View>
          <View style={styles.row}>
            <Cell url={shown[2]!.url} />
            <Cell url={shown[3]!.url} />
          </View>
        </View>
      )}
    </View>
  );
}
