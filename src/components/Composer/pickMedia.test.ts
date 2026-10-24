// R2.3: `pickMedia` asks permission like `pickProfileImage` and returns
// a typed outcome — denied is shown, never a silent cancel — and refuses
// over-cap assets BEFORE reading them into memory.

import {MAX_MEDIA_BYTES} from '#/state/queries/composer'

import {pickMedia, type MediaPick} from './pickMedia'

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}))

const Picker = require('expo-image-picker') as {
  requestMediaLibraryPermissionsAsync: jest.Mock
  launchImageLibraryAsync: jest.Mock
}

const realFetch = globalThis.fetch

function mockFetchBlob(size: number) {
  const fetchMock = jest.fn(async () => ({
    blob: async () => new Blob([new Uint8Array(size)]),
  }))
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

beforeEach(() => {
  Picker.requestMediaLibraryPermissionsAsync.mockReset()
  Picker.launchImageLibraryAsync.mockReset()
  Picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({granted: true, canAskAgain: true})
})

afterEach(() => {
  globalThis.fetch = realFetch
})

function asset(over: Record<string, unknown> = {}) {
  return {
    uri: 'file:///tmp/photo.jpg',
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    fileSize: 100,
    ...over,
  }
}

describe('pickMedia', () => {
  it('returns denied (never launching) when permission is refused', async () => {
    Picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({granted: false, canAskAgain: false})
    const result: MediaPick = await pickMedia({limit: 4})
    expect(result).toEqual({kind: 'denied', canAskAgain: false})
    expect(Picker.launchImageLibraryAsync).not.toHaveBeenCalled()
  })

  it('returns cancelled when the user dismisses the picker', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValue({canceled: true, assets: []})
    expect(await pickMedia({limit: 4})).toEqual({kind: 'cancelled'})
  })

  it('returns picked files for a granted launch', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValue({canceled: false, assets: [asset()]})
    const fetchMock = mockFetchBlob(100)
    const result = await pickMedia({limit: 4})
    expect(result.kind).toBe('picked')
    if (result.kind !== 'picked') throw new Error('unreachable')
    expect(result.files).toHaveLength(1)
    expect(result.files[0].name).toBe('photo.jpg')
    expect(result.rejected).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses over-cap assets BEFORE reading them (no fetch, no OOM)', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [asset({fileName: 'huge.mp4', fileSize: MAX_MEDIA_BYTES + 1})],
    })
    const fetchMock = mockFetchBlob(100)
    const result = await pickMedia({limit: 4})
    expect(result).toEqual({kind: 'picked', files: [], rejected: ['huge.mp4']})
    // The refusal happens before `assetToFile` — the bytes are never read.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps an empty pick a no-op (limit 0 never touches the picker)', async () => {
    expect(await pickMedia({limit: 0})).toEqual({kind: 'picked', files: [], rejected: []})
    expect(Picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled()
  })
})
