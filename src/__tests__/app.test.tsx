import {render, screen} from '@testing-library/react-native'

import {Root} from '#/Root'

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `keystone://${path}`,
}))

// Seed for the plan §3.3 provider-regression guard: the app boots and
// renders. Slice 3.4 replaced the Home placeholder with the real Home
// screen, so the seed asserts the signed-out Home (no fake data) instead.
describe('App', () => {
  it('boots into the Home screen', async () => {
    render(<Root />)
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
    expect(await screen.findByText('Sign in to see this feed.')).toBeTruthy()
  })
})
