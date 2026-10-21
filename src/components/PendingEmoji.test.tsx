// Contrast sweep (stream A): the pending-emoji placeholder must resolve
// to the palette in BOTH themes — never a hardcoded grey.
import {render, screen} from '@testing-library/react-native'
import {StyleSheet} from 'react-native'

import {ThemeProvider} from '#/alf/index'
import {themes} from '#/alf/themes'
import {PendingEmoji} from '#/components/PendingEmoji'

describe.each(['light', 'dark'] as const)('PendingEmoji (%s theme)', theme => {
  it('paints the placeholder from the palette', () => {
    render(
      <ThemeProvider theme={theme}>
        <PendingEmoji testID="pending" />
      </ThemeProvider>,
    )
    const style = StyleSheet.flatten(
      screen.getByTestId('pending', {includeHiddenElements: true}).props.style,
    ) as {backgroundColor?: string} | undefined
    expect(style?.backgroundColor).toBe(themes[theme].palette.muted)
  })
})
