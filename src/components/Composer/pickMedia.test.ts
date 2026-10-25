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
    expect(result).toEqual({
      kind: 'picked',
      files: [],
      rejected: [{name: 'huge.mp4', limit: MAX_MEDIA_BYTES}],
    })
    // The refusal happens before `assetToFile` — the bytes are never read.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('applies per-kind server caps (repair X6.2 step 2)', async () => {
    const caps = {imageBytes: 16 * 1024 * 1024, videoBytes: 99 * 1024 * 1024}
    const twentyMb = 20 * 1024 * 1024
    Picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        asset({fileName: 'clip.mp4', mimeType: 'video/mp4', fileSize: twentyMb}),
        asset({fileName: 'photo.png', mimeType: 'image/png', fileSize: twentyMb}),
      ],
    })
    const fetchMock = mockFetchBlob(100)
    const result = await pickMedia({limit: 4, ...caps})
    expect(result.kind).toBe('picked')
    if (result.kind !== 'picked') throw new Error('unreachable')
    // Same 20 MB: the video fits its 99 MB server cap, the image exceeds
    // its 16 MB cap with the real number attached.
    expect(result.files.map(f => f.name)).toEqual(['clip.mp4'])
    expect(result.rejected).toEqual([{name: 'photo.png', limit: 16 * 1024 * 1024}])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('lets unknown sizes through to the upload-time guard', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [asset({fileName: 'mystery.png', fileSize: undefined})],
    })
    const fetchMock = mockFetchBlob(100)
    const result = await pickMedia({limit: 4})
    expect(result.kind).toBe('picked')
    if (result.kind !== 'picked') throw new Error('unreachable')
    expect(result.files).toHaveLength(1)
    expect(result.rejected).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps an empty pick a no-op (limit 0 never touches the picker)', async () => {
    expect(await pickMedia({limit: 0})).toEqual({kind: 'picked', files: [], rejected: []})
    expect(Picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled()
  })
})
