import {createMmkvStore, type MmkvLike} from './mmkv'

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
})
