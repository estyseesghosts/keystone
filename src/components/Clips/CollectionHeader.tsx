// Shared collection header (P6.6 slice 4): title, description,
// badges, count line, action slot. Used by the Clip screen and the
// Favourites screen (same header layout, different data).

import type {ReactNode} from 'react';
import {View} from 'react-native';

import {atoms} from '#/alf/atoms';
import {Body, Caption} from '#/alf/typography';
import {Pagehead} from '#/components/Pagehead';

export function CollectionHeader({
  title,
  description,
  badges,
  countLine,
  actions,
  testID,
}: {
  title: string;
  description?: string | null;
  badges?: ReactNode;
  countLine?: string | null;
  actions?: ReactNode;
  testID?: string;
}) {
  return (
    <View style={[atoms.gap_sm]} testID={testID}>
      <Pagehead title={title} />
      <View style={[atoms.px_md, atoms.gap_sm]}>
        {badges}
        {description ? <Body testID={testID ? `${testID}-description` : undefined}>{description}</Body> : null}
        {countLine ? (
          <Caption color="faint" testID={testID ? `${testID}-count` : undefined}>
            {countLine}
          </Caption>
        ) : null}
        {actions}
      </View>
    </View>
  );
}
