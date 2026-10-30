// Thumb (P6.6 slice 2, DC-12): image | mosaic | kind icon. Sensitive
// images render their blurhash (blurred) with a "Sensitive" badge until
// tapped; `dataSaver` shows the kind icon until tapped (tap loads).
// Pure except the reveal/load taps (local state).

import {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {msg} from '@lingui/macro';

import {AppImage} from '#/components/Image';
import {Caption} from '#/alf/typography';
import {Pressable} from '#/components/Pressable';
import {ClipIcon, DriveIcon, MediaIcon, MoreIcon, StarIcon} from '#/components/icons';
import {i18n} from '#/locale/i18n';

import {Mosaic} from './Mosaic';
import type {CollectionIconKind, CollectionThumb} from './types';

const styles = StyleSheet.create({
  box: {width: '100%', aspectRatio: 1, overflow: 'hidden', borderRadius: 8},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  badge: {position: 'absolute', top: 4, left: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4},
});

export function ThumbIcon({icon, size = 24}: {icon: CollectionIconKind; size?: number}) {
  switch (icon) {
    case 'folder':
      return <DriveIcon size={size} />;
    case 'image':
    case 'video':
      return <MediaIcon size={size} />;
    case 'audio':
    case 'file':
      return <MoreIcon size={size} />;
    case 'clip':
      return <ClipIcon size={size} />;
    case 'star':
      return <StarIcon size={size} />;
  }
}

export function Thumb({
  thumb,
  blurhash,
  dataSaver,
  testID,
}: {
  thumb: CollectionThumb;
  /** Blurhash for image thumbs (blurred while gated). */
  blurhash?: string | null;
  /** When true, images stay unloaded (icon) until tapped. */
  dataSaver?: boolean;
  testID?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (thumb.kind === 'icon') {
    return (
      <View style={styles.box} testID={testID}>
        <View style={styles.center}>
          <ThumbIcon icon={thumb.icon} />
        </View>
      </View>
    );
  }
  if (thumb.kind === 'mosaic') {
    const sensitive = thumb.images.some(i => i.sensitive);
    if (sensitive && !revealed) {
      return (
        <Pressable
          onPress={() => setRevealed(true)}
          accessibilityRole="button"
          accessibilityLabel={i18n._(msg`Show sensitive images`)}
          testID={testID}>
          <View style={styles.box}>
            <Mosaic images={[]} />
            <View style={styles.badge} testID={testID ? `${testID}-sensitive` : undefined}>
              <Caption>{i18n._(msg`Sensitive`)}</Caption>
            </View>
          </View>
        </Pressable>
      );
    }
    return (
      <View style={styles.box} testID={testID}>
        <Mosaic images={thumb.images} />
      </View>
    );
  }
  const gated = (thumb.sensitive && !revealed) || (dataSaver && !loaded);
  if (gated) {
    return (
      <Pressable
        onPress={() => {
          setRevealed(true);
          setLoaded(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={thumb.sensitive ? i18n._(msg`Show sensitive image`) : i18n._(msg`Load image`)}
        testID={testID}>
        <View style={styles.box}>
          <View style={styles.center}>
            <AppImage
              uri={null}
              blurhash={blurhash}
              contentFit="cover"
              style={{width: '100%', height: '100%'}}
            />
          </View>
          {thumb.sensitive && !revealed ? (
            <View style={styles.badge} testID={testID ? `${testID}-sensitive` : undefined}>
              <Caption>{i18n._(msg`Sensitive`)}</Caption>
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  }
  return (
    <View style={styles.box} testID={testID}>
      <AppImage uri={thumb.url} blurhash={blurhash} contentFit="cover" style={{width: '100%', height: '100%'}} />
    </View>
  );
}
