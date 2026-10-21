// WS-B (F10): the header tag-block bubble — label, popup, routing.
import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'
import {TagBubble} from '#/components/Post/TagBubble'

i18n.load('en', {})
i18n.activate('en')

function renderBubble(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

describe('TagBubble (F10)', () => {
  it('renders nothing with no tags', () => {
    const {toJSON} = renderBubble(<TagBubble tags={[]} testID="tb" />)
    expect(toJSON()).toBeNull()
    expect(screen.queryByTestId('tb')).toBeNull()
  })

  it('labels a lone tag and a block', () => {
    renderBubble(<TagBubble tags={['solo']} testID="tb-solo" />)
    expect(screen.getByText('#solo')).toBeTruthy()
    renderBubble(<TagBubble tags={['a', 'b', 'c']} testID="tb" />)
    expect(screen.getByText('(#a +2)')).toBeTruthy()
  })

  it('opens a popup with one row per tag', () => {
    renderBubble(<TagBubble tags={['a', 'b']} testID="tb" />)
    expect(screen.queryByTestId('tb-pop')).toBeNull()
    fireEvent.press(screen.getByTestId('tb'))
    expect(screen.getByTestId('tb-pop')).toBeTruthy()
    expect(screen.getByTestId('tb-tag-a')).toBeTruthy()
    expect(screen.getByTestId('tb-tag-b')).toBeTruthy()
  })

  it('routes a tag press through the handler and closes', () => {
    const onHashtagPress = jest.fn()
    renderBubble(<TagBubble tags={['a', 'b']} onHashtagPress={onHashtagPress} testID="tb" />)
    fireEvent.press(screen.getByTestId('tb'))
    fireEvent.press(screen.getByTestId('tb-tag-b'))
    expect(onHashtagPress).toHaveBeenCalledWith('b')
    expect(screen.queryByTestId('tb-pop')).toBeNull()
  })

  it('tolerates a press with no handler (navigation guards the rest)', () => {
    renderBubble(<TagBubble tags={['a']} testID="tb" />)
    fireEvent.press(screen.getByTestId('tb'))
    expect(() => fireEvent.press(screen.getByTestId('tb-tag-a'))).not.toThrow()
    expect(screen.queryByTestId('tb-pop')).toBeNull()
  })
})
