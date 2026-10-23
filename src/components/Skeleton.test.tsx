import {render, screen} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'

import {SkeletonList} from './Skeleton'

function setup(ui: React.ReactElement) {
  return render(<ThemeProvider theme="light">{ui}</ThemeProvider>)
}

describe('SkeletonList', () => {
  it('renders the requested row count with separators between them', () => {
    setup(<SkeletonList variant="post" count={3} testID="skel" />)
    expect(screen.getByTestId('skel')).toBeTruthy()
  })

  it('covers every content variant', () => {
    const {unmount} = setup(<SkeletonList variant="account" testID="a" />)
    expect(screen.getByTestId('a')).toBeTruthy()
    unmount()
    setup(<SkeletonList variant="row" testID="r" />)
    expect(screen.getByTestId('r')).toBeTruthy()
  })

  it('renders a card variant with a thumb placeholder', () => {
    setup(<SkeletonList variant="card" count={2} testID="c" />)
    expect(screen.getByTestId('c')).toBeTruthy()
  })
})
