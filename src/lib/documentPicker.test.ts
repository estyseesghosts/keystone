// R2.3: the 10 MB size guard `pickTransferFile` claims runs before any
// upload, plus the pure helper the import row re-checks with.

import {MAX_TRANSFER_FILE_BYTES, pickTransferFile, transferSizeError} from './documentPicker'

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}))

const DocPicker = require('expo-document-picker') as {getDocumentAsync: jest.Mock}

const realFetch = globalThis.fetch

function mockFetchBlob(size: number) {
  const fetchMock = jest.fn(async () => ({
    blob: async () => new Blob([new Uint8Array(size)]),
  }))
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

beforeEach(() => {
  DocPicker.getDocumentAsync.mockReset()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('transferSizeError', () => {
  it('fits under the cap, refuses over it, passes unknown sizes to the server', () => {
    expect(transferSizeError('a.csv', 100)).toBeNull()
    expect(transferSizeError('a.csv', MAX_TRANSFER_FILE_BYTES)).toBeNull()
    expect(transferSizeError('big.csv', MAX_TRANSFER_FILE_BYTES + 1)).toMatch(/too large/)
    // Zero/NaN sizes cannot prove over-cap — the server stays the verdict.
    expect(transferSizeError('mystery.csv', 0)).toBeNull()
    expect(transferSizeError('mystery.csv', NaN)).toBeNull()
  })
})

describe('pickTransferFile', () => {
  it('returns null on cancel without reading anything', async () => {
    DocPicker.getDocumentAsync.mockResolvedValue({canceled: true})
    const fetchMock = mockFetchBlob(10)
    expect(await pickTransferFile()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the file when it fits', async () => {
    DocPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{uri: 'file:///tmp/a.csv', name: 'a.csv', mimeType: 'text/csv'}],
    })
    mockFetchBlob(10)
    const picked = await pickTransferFile()
    expect(picked?.name).toBe('a.csv')
    expect(picked?.file).toBeInstanceOf(File)
  })

  it('throws an honest error (never uploads) when the file is over cap', async () => {
    DocPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{uri: 'file:///tmp/big.csv', name: 'big.csv', mimeType: 'text/csv'}],
    })
    mockFetchBlob(MAX_TRANSFER_FILE_BYTES + 1)
    await expect(pickTransferFile()).rejects.toThrow(/too large/)
  })
})
