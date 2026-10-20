/* Manual mock for react-native-mmkv (native module): an in-memory store
 * with the MMKV surface `src/storage/mmkv.ts` needs. Auto-applied to every
 * suite (root `__mocks__`); per-test state would leak across files, so
 * suites that touch it clear via `new MMKV()` per test or `clearAll()`. */

class MMKV {
  constructor({id} = {}) {
    this.id = id ?? 'mock'
    this.map = new Map()
  }

  set(key, value) {
    this.map.set(key, value)
  }

  getString(key) {
    const value = this.map.get(key)
    return typeof value === 'string' ? value : undefined
  }

  getBoolean(key) {
    const value = this.map.get(key)
    return typeof value === 'boolean' ? value : undefined
  }

  getNumber(key) {
    const value = this.map.get(key)
    return typeof value === 'number' ? value : undefined
  }

  contains(key) {
    return this.map.has(key)
  }

  delete(key) {
    this.map.delete(key)
  }

  getAllKeys() {
    return [...this.map.keys()]
  }

  clearAll() {
    this.map.clear()
  }

  get size() {
    return this.map.size
  }
}

module.exports = {MMKV}
