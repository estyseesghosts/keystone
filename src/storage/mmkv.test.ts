import {createMmkvStore, type MmkvLike} from './mmkv'
import {onStorageWriteFailed, type StorageWriteFailure} from './storageEvents'

function fakeMmkv(impl: Partial<MmkvLike> = {}): MmkvLike {
  const map = new Map<string, string>()
  return {
    getString: key => map.get(key),
    set: (key, value) => {
      map.set(key, value)
    },
    delete: key => {
      map.delete(key)
    },
    ...impl,
  }
}

describe('createMmkvStore', () => {
  it('round-trips set/get/remove', () => {
    const store = createMmkvStore(fakeMmkv())
    expect(store.getItem('k')).toBeNull()
    store.setItem('k', 'v')
    expect(store.getItem('k')).toBe('v')
    store.removeItem('k')
    expect(store.getItem('k')).toBeNull()
  })

  it('maps a missing key to null (MMKV undefined)', () => {
    const store = createMmkvStore(fakeMmkv())
    expect(store.getItem('missing')).toBeNull()
  })

  it('never throws when the backend is unavailable', () => {
    const broken: MmkvLike = {
      getString: () => {
        throw new Error('nope')
      },
      set: () => {
        throw new Error('nope')
      },
      delete: () => {
        throw new Error('nope')
      },
    }
    const store = createMmkvStore(broken)
    expect(store.getItem('k')).toBeNull()
    expect(() => store.setItem('k', 'v')).not.toThrow()
    expect(() => store.removeItem('k')).not.toThrow()
  })

  it('setItem reports success as a boolean (repair X1.3 S12)', () => {
    const store = createMmkvStore(fakeMmkv())
    expect(store.setItem('k', 'v')).toBe(true)
    expect(store.getItem('k')).toBe('v')
  })

  it('a throwing backend reports false and emits storageWriteFailed', () => {
    const seen: StorageWriteFailure[] = []
    const off = onStorageWriteFailed(f => seen.push(f))
    try {
      const broken: MmkvLike = {
        getString: () => undefined,
        set: () => {
          throw new Error('quota')
        },
        delete: () => {},
      }
      const store = createMmkvStore(broken)
      expect(store.setItem('keystone.drafts.sid', 'v')).toBe(false)
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({key: 'keystone.drafts.sid', scope: 'drafts'})
      expect(typeof seen[0].at).toBe('number')
    } finally {
      off()
    }
  })

  it('keys() mirrors getAllKeys when the backing enumerates, else []', () => {
    expect(createMmkvStore(fakeMmkv()).keys?.()).toEqual([])
    const backing = fakeMmkv({getAllKeys: () => ['a', 'b']})
    expect(createMmkvStore(backing).keys?.()).toEqual(['a', 'b'])
    const broken: MmkvLike = {
      getString: () => undefined,
      set: () => {},
      delete: () => {},
      getAllKeys: () => {
        throw new Error('nope')
      },
    }
    expect(createMmkvStore(broken).keys?.()).toEqual([])
  })
})
