import {render, screen} from '@testing-library/react-native'

import App from '#/App'

// Seed for the plan §3.3 provider-regression guard: the app boots and
// renders. Real fixture-backed render tests land with the read path.
describe('App', () => {
  it('renders the Keystone placeholder', () => {
    render(<App />)
    expect(screen.getByText('Keystone')).toBeTruthy()
  })
})
