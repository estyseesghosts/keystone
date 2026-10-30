// CollectionScreen (P6.6 slice 2): shared screen shell — header
// (title or breadcrumbs slot), toolbar, body (grid or list chosen by
// the persisted view), empty/error/loading states.

import type {ReactNode} from 'react';
import {View} from 'react-native';

import {atoms} from '#/alf/atoms';
import {Body, Caption} from '#/alf/typography';
import {Button} from '#/components/Button';
import {Pagehead} from '#/components/Pagehead';
import {SkeletonList} from '#/components/Skeleton';
import {SignInButton} from '#/components/SignInButton';

import {useCollectionView, type CollectionScreenId} from '#/state/collectionPrefs';
import {i18n} from '#/locale/i18n';
import {msg} from '@lingui/macro';
import {CollectionGrid, CollectionList, type CollectionBodyProps} from './Grid';
import type {CollectionItem} from './types';

export function CollectionScreen({
  screen,
  title,
  header,
  toolbar,
  selectionBar,
  items,
  render,
  loading,
  error,
  errorMessage,
  errorHint,
  onRetry,
  emptyMessage,
  onEndReached,
  refreshing,
  onRefresh,
  footer,
  unsupportedMessage,
  unsupportedHint,
  signedOutMessage,
  signedOut,
  session,
  testID,
}: {
  screen: CollectionScreenId;
  title: string;
  /** Replaces the title row (breadcrumbs). */
  header?: ReactNode;
  toolbar?: ReactNode;
  selectionBar?: ReactNode;
  items: CollectionItem[];
  render: Omit<CollectionBodyProps, 'items' | 'onEndReached' | 'refreshing' | 'onRefresh' | 'ListEmptyComponent' | 'ListFooterComponent'>;
  loading?: boolean;
  error?: unknown;
  errorMessage?: string;
  errorHint?: string;
  onRetry?: () => void;
  emptyMessage?: string;
  onEndReached?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: React.ReactElement | null;
  unsupportedMessage?: string;
  unsupportedHint?: string;
  signedOutMessage?: string;
  signedOut?: boolean;
  session?: unknown;
  testID?: string;
}) {
  const view = useCollectionView(screen);
  if (signedOut || !session) {
    return (
      <View testID={testID} style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Pagehead title={title} />
        <Body>{signedOutMessage ?? ''}</Body>
        <SignInButton />
      </View>
    );
  }
  if (unsupportedMessage) {
    return (
      <View testID={testID} style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Pagehead title={title} />
        <Body>{unsupportedMessage}</Body>
        {unsupportedHint ? <Caption color="faint">{unsupportedHint}</Caption> : null}
      </View>
    );
  }
  return (
    <View testID={testID} style={atoms.flex1}>
      {header ?? <Pagehead title={title} />}
      {toolbar}
      {selectionBar}
      {loading ? (
        <SkeletonList variant="row" testID={testID ? `${testID}-loading` : undefined} />
      ) : error ? (
        <View style={[atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>{errorMessage ?? ''}</Body>
          {errorHint ? <Caption color="faint">{errorHint}</Caption> : null}
          {onRetry ? (
            <Button
              label={i18n._(msg`Retry`)}
              variant="secondary"
              onPress={onRetry}
              testID={testID ? `${testID}-retry` : undefined}
            />
          ) : null}
        </View>
      ) : view === 'grid' ? (
        <CollectionGrid
          {...render}
          items={items}
          testID={testID ? `${testID}-grid` : undefined}
          onEndReached={onEndReached}
          refreshing={refreshing}
          onRefresh={onRefresh}
          ListEmptyComponent={
            emptyMessage ? (
              <View style={[atoms.centered, atoms.p_md]}>
                <Body>{emptyMessage}</Body>
              </View>
            ) : null
          }
          ListFooterComponent={footer}
        />
      ) : (
        <CollectionList
          {...render}
          items={items}
          testID={testID ? `${testID}-list` : undefined}
          onEndReached={onEndReached}
          refreshing={refreshing}
          onRefresh={onRefresh}
          ListEmptyComponent={
            emptyMessage ? (
              <View style={[atoms.centered, atoms.p_md]}>
                <Body>{emptyMessage}</Body>
              </View>
            ) : null
          }
          ListFooterComponent={footer}
        />
      )}
    </View>
  );
}
