// R2.3: `pickMedia` asks permission like `pickProfileImage` and returns
// a typed outcome — denied is shown, never a silent cancel — and refuses
// over-cap assets BEFORE reading them into memory. Repair X7.4 step 3:
// per-asset try/catch (one unreadable asset never discards the others),
// native `{uri, name, type}` references (no whole-file reads on native),
// GPS detection (picker EXIF on native, JPEG-head scan on web).

import {MAX_MEDIA_BYTES} from '#/state/queries/composer'

import {
  hasGpsExif,
  jpegHeadHasGps,
  pickMedia,
  scanFileHeadForGps,
  type MediaPick,
} from './pickMedia'

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}))

jest.mock('expo-file-system', () => ({
  getInfoAsync: jest.fn(),
}))

const Picker = require('expo-image-picker') as {
  requestMediaLibraryPermissionsAsync: jest.Mock
  launchImageLibraryAsync: jest.Mock
}
const FS = require('expo-file-system') as {getInfoAsync: jest.Mock}

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
  FS.getInfoAsync.mockReset()
  FS.getInfoAsync.mockResolvedValue(null)
})

afterEach(() => {
  globalThis.fetch = realFetch
})

function asset(over: Record<string, unknown> = {}) {
  return {
    uri: 'blob:https://app/photo.jpg',
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    fileSize: 100,
    ...over,
  }
}

function nativeAsset(over: Record<string, unknown> = {}) {
  return {
    uri: 'file:///tmp/photo.jpg',
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
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

  it('returns picked files for a granted web launch (blob path)', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValue({canceled: false, assets: [asset()]})
    const fetchMock = mockFetchBlob(100)
    const result = await pickMedia({limit: 4})
    expect(result.kind).toBe('picked')
    if (result.kind !== 'picked') throw new Error('unreachable')
    expect(result.files).toHaveLength(1)
    expect(result.files[0].name).toBe('photo.jpg')
    expect(result.files[0].file).toBeInstanceOf(File)
    expect(result.rejected).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns native references without reading bytes (no fetch on file://)', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [nativeAsset({fileSize: 100})],
    })
    const fetchMock = mockFetchBlob(100)
    const result = await pickMedia({limit: 4})
    expect(result.kind).toBe('picked')
    if (result.kind !== 'picked') throw new Error('unreachable')
    expect(result.files).toHaveLength(1)
    expect(result.files[0].file).toEqual({
      uri: 'file:///tmp/photo.jpg',
      name: 'photo.jpg',
      type: 'image/jpeg',
      size: 100,
    })
    expect(result.files[0].mimeType).toBe('image/jpeg')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(FS.getInfoAsync).not.toHaveBeenCalled()
  })

  it('probes native size through the file-system seam when fileSize is absent', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [nativeAsset({fileSize: undefined})],
    })
    FS.getInfoAsync.mockResolvedValue({exists: true, size: 4242})
    mockFetchBlob(100)
    const result = await pickMedia({limit: 4})
    expect(result.kind).toBe('picked')
    if (result.kind !== 'picked') throw new Error('unreachable')
    expect(FS.getInfoAsync).toHaveBeenCalledWith('file:///tmp/photo.jpg')
    expect(result.files[0].file).toMatchObject({size: 4242})
    expect(result.rejected).toEqual([])
  })

  it('treats an unmeasurable native asset as unknown size (server decides)', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [nativeAsset({fileSize: undefined})],
    })
    FS.getInfoAsync.mockRejectedValue(new Error('no module'))
    mockFetchBlob(100)
    const result = await pickMedia({limit: 4})
    expect(result.kind).toBe('picked')
    if (result.kind !== 'picked') throw new Error('unreachable')
    expect(result.files).toHaveLength(1)
    expect(result.files[0].file).not.toHaveProperty('size')
    expect(result.rejected).toEqual([])
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
      rejected: [{name: 'huge.mp4', limit: MAX_MEDIA_BYTES, reason: 'too-large'}],
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
    expect(result.rejected).toEqual([{name: 'photo.png', limit: 16 * 1024 * 1024, reason: 'too-large'}])
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

  it('reports one unreadable asset without discarding the others', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        asset({uri: 'blob:gone', fileName: 'gone.jpg'}),
        asset({uri: 'blob:ok', fileName: 'ok.jpg'}),
      ],
    })
    const fetchMock = jest.fn(async (url: string) => {
      if (url === 'blob:gone') throw new Error('iCloud only')
      return {blob: async () => new Blob([new Uint8Array(10)])}
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const result = await pickMedia({limit: 4})
    expect(result.kind).toBe('picked')
    if (result.kind !== 'picked') throw new Error('unreachable')
    expect(result.files.map(f => f.name)).toEqual(['ok.jpg'])
    expect(result.rejected).toEqual([{name: 'gone.jpg', limit: MAX_MEDIA_BYTES, reason: 'unreadable'}])
  })

  it('reads picker EXIF GPS on native assets (hadGps true/false/null)', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        nativeAsset({uri: 'file:///a.jpg', exif: {GPSLatitude: 1, GPSLongitude: 2}, fileSize: 10}),
        nativeAsset({uri: 'file:///b.jpg', exif: {FNumber: 2}, fileSize: 10}),
        nativeAsset({uri: 'file:///c.jpg', fileSize: 10}),
      ],
    })
    mockFetchBlob(10)
    const result = await pickMedia({limit: 4})
    expect(result.kind).toBe('picked')
    if (result.kind !== 'picked') throw new Error('unreachable')
    expect(result.files.map(f => f.hadGps)).toEqual([true, false, null])
  })

  it('keeps an empty pick a no-op (limit 0 never touches the picker)', async () => {
    expect(await pickMedia({limit: 0})).toEqual({kind: 'picked', files: [], rejected: []})
    expect(Picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled()
  })
})

describe('hasGpsExif', () => {
  it('detects GPS tags and ignores anything else', () => {
    expect(hasGpsExif({GPSLatitude: 1})).toBe(true)
    expect(hasGpsExif({GPSLongitude: 1})).toBe(true)
    expect(hasGpsExif({FNumber: 1.8, Make: 'x'})).toBe(false)
    expect(hasGpsExif(null)).toBe(false)
    expect(hasGpsExif(undefined)).toBe(false)
    expect(hasGpsExif('GPSLatitude')).toBe(false)
  })
})

describe('jpegHeadHasGps', () => {
  // Minimal JPEG: SOI + APP1(Exif TIFF) + EOI. The TIFF is little-endian
  // with one IFD0 entry; the tag decides the verdict.
  function jpegWithIfd(tag: number): ArrayBuffer {
    const bytes: number[] = [0xff, 0xd8]
    const tiff: number[] = [
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // II, 42, IFD0@8
      0x01, 0x00, // 1 entry
      tag & 0xff, (tag >> 8) & 0xff, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]
    const len = tiff.length + 2
    bytes.push(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...tiff, 0xff, 0xd9)
    return new Uint8Array(bytes).buffer
  }

  it('finds the GPS directory and ignores other tags', () => {
    expect(jpegHeadHasGps(jpegWithIfd(0x8825))).toBe(true)
    expect(jpegHeadHasGps(jpegWithIfd(0x010f))).toBe(false)
  })

  it('rejects non-JPEG, truncated, and garbage heads', () => {
    expect(jpegHeadHasGps(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBe(false)
    expect(jpegHeadHasGps(new Uint8Array([0xff]).buffer)).toBe(false)
    expect(jpegHeadHasGps(new Uint8Array([]).buffer)).toBe(false)
    const full = new Uint8Array(jpegWithIfd(0x8825))
    expect(jpegHeadHasGps(full.slice(0, 10).buffer)).toBe(false)
  })

  it('scanFileHeadForGps reads a File head without the whole file', async () => {
    const file = new File([jpegWithIfd(0x8825)], 'gps.jpg', {type: 'image/jpeg'})
    await expect(scanFileHeadForGps(file)).resolves.toBe(true)
    const plain = new File([jpegWithIfd(0x010f)], 'plain.jpg', {type: 'image/jpeg'})
    await expect(scanFileHeadForGps(plain)).resolves.toBe(false)
  })
})
