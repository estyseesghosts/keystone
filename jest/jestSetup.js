/* global jest */
import {webcrypto} from 'node:crypto'
import 'react-native-gesture-handler/jestSetup'

import {configure} from '@testing-library/react-native'

configure({asyncUtilTimeout: 20000})

// Real WebCrypto (Node's) so `getRandomValues`/`randomUUID` exist in tests.
// Never mock this away: security paths must run the real CSPRNG under test
// (a prior `jest.mock('crypto', () => ({}))` hid it and forced the
// `Math.random` fallbacks). No test relied on the empty mock (searched:
// no `require('crypto')`, no `crypto`/`Math.random` references in tests).
if (
  typeof globalThis.crypto === 'undefined' ||
  typeof globalThis.crypto.getRandomValues !== 'function'
) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  })
}
