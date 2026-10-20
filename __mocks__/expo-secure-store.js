/* Manual mock for expo-secure-store (native module): an in-memory
 * async vault. Auto-applied to every suite (root `__mocks__`). */

const store = new Map()

async function getItemAsync(key) {
  return store.has(key) ? store.get(key) : null
}

async function setItemAsync(key, value) {
  store.set(key, value)
}

async function deleteItemAsync(key) {
  store.delete(key)
}

function __clear() {
  store.clear()
}

function __entries() {
  return [...store.entries()]
}

module.exports = {getItemAsync, setItemAsync, deleteItemAsync, __clear, __entries}
