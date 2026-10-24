// profileDetailLayout truth table (plan: profile page layout).
import {profileDetailLayout} from '#/components/Profile/profileDetailLayout'

describe('profileDetailLayout', () => {
  it.each([
    // desktop, hasBio, hasFields, expected
    [false, false, false, 'none'],
    [true, false, false, 'none'],
    [false, true, false, 'stack'],
    [false, false, true, 'stack'],
    [false, true, true, 'stack'],
    [true, true, true, 'split'],
    [true, true, false, 'center-bio'],
    [true, false, true, 'center-fields'],
  ])(
    'desktop=%s hasBio=%s hasFields=%s → %s',
    (desktop, hasBio, hasFields, expected) => {
      expect(profileDetailLayout({desktop, hasBio, hasFields})).toBe(expected)
    },
  )
})
