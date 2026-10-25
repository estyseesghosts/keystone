/* global jest */
import {webcrypto} from 'node:crypto'
import 'react-native-gesture-handler/jestSetup'

import {configure} from '@testing-library/react-native'

configure({asyncUtilTimeout: 20000})

// The NetInfo native module does not exist under jest: the real
// library's internals crash on subscribe (`isInternetReachable` of
// undefined). Mock it globally as always-connected; suites that need
// offline behavior inject fakes through the lifecycle seams instead
// (repair X3.2), and no suite may rely on the real native module here.
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: () => () => {},
    fetch: () => Promise.resolve({isConnected: true, isInternetReachable: true}),
  },
}))

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
