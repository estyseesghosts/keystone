import {StyleSheet} from 'react-native'
import {render} from '@testing-library/react-native'

import {Button} from '#/components/Button'
import {PopupRow} from '#/components/Popup'

// Touch-target floor (P10, 44dp): buttons and popup/menu rows meet the
// minimum even with short labels. Post action rows keep their compact
// visual and reach 44dp via hitSlop (asserted in-file by prop).

describe('touch targets (P10)', () => {
  it('Button base style carries a 44dp minHeight', () => {
    const screen = render(<Button label="OK" onPress={() => {}} testID="t-btn" />)
    const host = screen.getByTestId('t-btn')
    const flat = StyleSheet.flatten(host.props.style) as {minHeight?: number}
    expect(flat.minHeight).toBe(44)
  })

  it('PopupRow carries a 44dp minHeight', () => {
    const screen = render(<PopupRow label="Row" onPress={() => {}} testID="t-row" />)
    const host = screen.getByTestId('t-row')
    const flat = StyleSheet.flatten(host.props.style) as {minHeight?: number}
    expect(flat.minHeight).toBe(44)
  })
})
