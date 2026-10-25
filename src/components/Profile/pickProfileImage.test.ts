// Repair X7.4 step 8 (M16): `pickProfileImage` crops to the target aspect
// and resizes (avatar 400 px, banner 1500 px wide, never upscaled) before
// upload, falling back to the original bytes when the manipulator is
// unavailable.

import {
  centerCropForAspect,
  pickProfileImage,
  profileImageTarget,
} from './pickProfileImage'

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}))

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: {JPEG: 'jpeg', PNG: 'png', WEBP: 'webp'},
}))

const Picker = require('expo-image-picker') as {
  requestMediaLibraryPermissionsAsync: jest.Mock
  launchImageLibraryAsync: jest.Mock
}
const Manip = require('expo-image-manipulator') as {manipulateAsync: jest.Mock}

const realFetch = globalThis.fetch

beforeEach(() => {
  Picker.requestMediaLibraryPermissionsAsync.mockReset()
  Picker.launchImageLibraryAsync.mockReset()
  Picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({granted: true, canAskAgain: true})
  Manip.manipulateAsync.mockReset()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

function asset(over: Record<string, unknown> = {}) {
  return {
    uri: 'file:///tmp/face.jpg',
    fileName: 'face.jpg',
    mimeType: 'image/jpeg',
    width: 1200,
    height: 800,
    ...over,
  }
}

describe('profileImageTarget', () => {
  it('targets square 400 px avatars and 3:1 1500 px banners', () => {
    expect(profileImageTarget('avatar')).toEqual({aspect: 1, width: 400})
    expect(profileImageTarget('banner')).toEqual({aspect: 3, width: 1500})
  })
})

describe('centerCropForAspect', () => {
  it('trims wide sources to a centered square', () => {
    expect(centerCropForAspect(1200, 800, 1)).toEqual({originX: 200, originY: 0, width: 800, height: 800})
  })

  it('trims tall sources to a centered 3:1 banner', () => {
    expect(centerCropForAspect(1000, 1000, 3)).toEqual({originX: 0, originY: 333, width: 1000, height: 333})
  })

  it('returns null when the source already matches or is unknown', () => {
    expect(centerCropForAspect(400, 400, 1)).toBeNull()
    expect(centerCropForAspect(0, 100, 1)).toBeNull()
    expect(centerCropForAspect(100, 100, 0)).toBeNull()
  })
})

describe('pickProfileImage', () => {
  it('returns denied/cancelled without touching the manipulator', async () => {
    Picker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({granted: false, canAskAgain: true})
    expect(await pickProfileImage('avatar')).toEqual({kind: 'denied', canAskAgain: true})
    Picker.launchImageLibraryAsync.mockResolvedValueOnce({canceled: true, assets: []})
    expect(await pickProfileImage('avatar')).toEqual({kind: 'cancelled'})
    expect(Manip.manipulateAsync).not.toHaveBeenCalled()
  })

  it('crops + resizes a wide avatar to 400 px JPEG (native reference)', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValueOnce({canceled: false, assets: [asset()]})
    Manip.manipulateAsync.mockResolvedValueOnce({uri: 'file:///cache/avatar.jpg'})
    const picked = await pickProfileImage('avatar')
    expect(picked.kind).toBe('picked')
    if (picked.kind !== 'picked') throw new Error('unreachable')
    // 1200×800 → centered 800×800 crop → 400 px resize, JPEG strip.
    expect(Manip.manipulateAsync).toHaveBeenCalledWith(
      'file:///tmp/face.jpg',
      [{crop: {originX: 200, originY: 0, width: 800, height: 800}}, {resize: {width: 400}}],
      {compress: 0.92, format: 'jpeg'},
    )
    expect(picked.file).toEqual({
      file: {uri: 'file:///cache/avatar.jpg', name: 'face.jpg', type: 'image/jpeg'},
      name: 'face.jpg',
      previewUri: 'file:///cache/avatar.jpg',
      mimeType: 'image/jpeg',
      hadGps: false,
    })
  })

  it('never upscales a small banner (crop only)', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [asset({width: 600, height: 200})],
    })
    Manip.manipulateAsync.mockResolvedValueOnce({uri: 'file:///cache/banner.jpg'})
    const picked = await pickProfileImage('banner')
    expect(picked.kind).toBe('picked')
    if (picked.kind !== 'picked') throw new Error('unreachable')
    // 600×200 is already 3:1 and under 1500 px: re-encode only.
    expect(Manip.manipulateAsync).toHaveBeenCalledWith('file:///tmp/face.jpg', [], {
      compress: 0.92,
      format: 'jpeg',
    })
  })

  it('falls back to the original bytes when the manipulator fails', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValueOnce({canceled: false, assets: [asset()]})
    Manip.manipulateAsync.mockRejectedValueOnce(new Error('no native module'))
    const picked = await pickProfileImage('avatar')
    expect(picked.kind).toBe('picked')
    if (picked.kind !== 'picked') throw new Error('unreachable')
    expect(picked.file.file).toEqual({
      uri: 'file:///tmp/face.jpg',
      name: 'face.jpg',
      type: 'image/jpeg',
    })
  })

  it('reads web outputs back into a File (blob path)', async () => {
    Picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [asset({uri: 'blob:web-pick', width: 400, height: 400})],
    })
    Manip.manipulateAsync.mockResolvedValueOnce({uri: 'blob:stripped'})
    globalThis.fetch = jest.fn(async () => ({
      blob: async () => new Blob(['z'], {type: 'image/jpeg'}),
    })) as unknown as typeof fetch
    const picked = await pickProfileImage('avatar')
    expect(picked.kind).toBe('picked')
    if (picked.kind !== 'picked') throw new Error('unreachable')
    expect(picked.file.file).toBeInstanceOf(File)
    expect((picked.file.file as File).type).toBe('image/jpeg')
  })
})
