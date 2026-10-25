// Error boundaries (repair X8.1: rn-ui M1, a11y 10).
//
// One class boundary, three presets chosen by `variant`:
// - `root`: wraps the whole tree in `Root.tsx`. Translated crash UI with a
//   retry (re-render) and an optional sign-out affordance (the store is
//   passed in as `onSignOut` so the fallback needs no providers at all).
// - `screen`: per navigator screen (apply at the `Stack.Screen`
//   `component` sites when that file is next touched — see the session
//   log). Translated message + retry.
// - `row`: per feed row in `renderItem` (`FeedView`, `PostFeed`). A throw
//   collapses to a "Couldn't show this post" row with a retry that
//   re-renders just that row; the list stays mounted and scrollable.
//
// Every capture goes to the logger (redacted at the sink boundary), plus
// an optional `onError` listener. Fallbacks use only theme-with-default
// primitives (`useTheme` falls back to light with no provider) and the
// `i18n` singleton, so the root fallback renders even when providers
// above it are the thing that crashed.

import {Component, Fragment, type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {msg} from '@lingui/macro';

import {atoms} from '#/alf/atoms';
import {Body, Caption} from '#/alf/typography';
import {Button} from '#/components/Button';
import {i18n} from '#/locale/i18n';
import {logger} from '#/lib/logger';

export type ErrorBoundaryVariant = 'root' | 'screen' | 'row';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** `screen` by default. `root` is Root-only; `row` is feed rows only. */
  variant?: ErrorBoundaryVariant;
  /** Short log context (post id, screen name). Never values or tokens. */
  context?: string;
  /** Root only: sign out after an unrecoverable crash. */
  onSignOut?: () => void;
  /** Extra listener (tests, host wiring). Throwing listeners are swallowed. */
  onError?: (error: unknown) => void;
  testID?: string;
}

interface ErrorBoundaryState {
  error: unknown;
  /** Bumped on retry so the children remount and render again. */
  resetKey: number;
}

const styles = StyleSheet.create({
  row: {paddingHorizontal: 16, paddingVertical: 12, gap: 8},
});

function RowErrorFallback({onRetry}: {onRetry: () => void}) {
  return (
    <View testID="post-row-error" accessibilityRole="alert" style={styles.row}>
      <Body>{i18n._(msg`Couldn't show this post`)}</Body>
      <Button
        label={i18n._(msg`Try again`)}
        variant="secondary"
        compact
        onPress={onRetry}
        testID="post-row-retry"
      />
    </View>
  );
}

function ScreenErrorFallback({onRetry, testID}: {onRetry: () => void; testID?: string}) {
  return (
    <View
      testID={testID ?? 'screen-error'}
      accessibilityRole="alert"
      style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
      <Body>{i18n._(msg`Couldn't show this screen.`)}</Body>
      <Caption color="faint">{i18n._(msg`Check your connection and try again.`)}</Caption>
      <Button
        label={i18n._(msg`Try again`)}
        variant="secondary"
        onPress={onRetry}
        testID="screen-error-retry"
      />
    </View>
  );
}

function RootErrorFallback({
  onRetry,
  onSignOut,
  testID,
}: {
  onRetry: () => void;
  onSignOut?: () => void;
  testID?: string;
}) {
  return (
    <View
      testID={testID ?? 'root-error'}
      accessibilityRole="alert"
      style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
      <Body>{i18n._(msg`Something went wrong`)}</Body>
      <Caption color="faint">
        {i18n._(msg`The app hit a problem it couldn't recover from. Try again, or sign out and back in.`)}
      </Caption>
      <Button
        label={i18n._(msg`Try again`)}
        variant="secondary"
        onPress={onRetry}
        testID="root-error-retry"
      />
      {onSignOut ? (
        <Button
          label={i18n._(msg`Sign out`)}
          variant="secondary"
          onPress={onSignOut}
          testID="root-error-signout"
        />
      ) : null}
    </View>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {error: null, resetKey: 0};

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {error};
  }

  componentDidCatch(error: Error): void {
    const {variant = 'screen', context, onError} = this.props;
    try {
      logger.error(
        `[boundary:${variant}] render failed${context ? ` (${context})` : ''}`,
        error,
      );
    } catch {
      // Logging never breaks the fallback.
    }
    try {
      onError?.(error);
    } catch {
      // Listeners never break the fallback.
    }
  }

  private reset = (): void => {
    this.setState(prev => ({error: null, resetKey: prev.resetKey + 1}));
  };

  render(): ReactNode {
    const {children, variant = 'screen', onSignOut, testID} = this.props;
    if (this.state.error == null) {
      return <Fragment key={this.state.resetKey}>{children}</Fragment>;
    }
    if (variant === 'row') return <RowErrorFallback onRetry={this.reset} />;
    if (variant === 'root')
      return <RootErrorFallback onRetry={this.reset} onSignOut={onSignOut} testID={testID} />;
    return <ScreenErrorFallback onRetry={this.reset} testID={testID} />;
  }
}
