import {render, screen} from '@testing-library/react-native'

import {Root} from '#/Root'

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `keystone://${path}`,
}))

// Seed for the plan §3.3 provider-regression guard: the app boots and
// renders. Real fixture-backed render tests land with the read path.
describe('App', () => {
  it('boots into the Home placeholder', async () => {
    render(<Root />)
    expect(await screen.findByText('Home — not built')).toBeTruthy()
  })
})
