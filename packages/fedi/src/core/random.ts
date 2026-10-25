// CSPRNG seam for `packages/fedi` (repair X2.1).
//
// Every security path (PKCE verifier/state, MiAuth session ids, the
// Mastodon Idempotency-Key) reads randomness through here. The seam reads
// `globalThis.crypto` at call time — never cached, so tests can stub it —
// and throws a typed `FediError('errors.crypto.unavailable')` when no
// CSPRNG exists. There is deliberately NO `Math.random` fallback:
// predictable "random" values in a security path are worse than a loud
// failure.
//
// Pure TS: no `react`, `react-native`, `expo*`, `#/` imports, no
// `window`/`document`. `globalThis.crypto` is a language global, not a UI
// global. On native the global is installed at boot by
// `src/platform/polyfills.ts` (expo-crypto); on web it is the browser's.

import { FediError } from "./errors";

const UNAVAILABLE_MESSAGE = "Secure random values are unavailable on this device.";

export const CRYPTO_UNAVAILABLE_CODE = "errors.crypto.unavailable";

interface CryptoLike {
  getRandomValues: (array: Uint8Array) => unknown;
  randomUUID?: () => string;
}

function cryptoOrThrow(): CryptoLike {
  const c = (globalThis as { crypto?: unknown }).crypto;
  if (c === null || typeof c !== "object") {
    throw new FediError(UNAVAILABLE_MESSAGE, CRYPTO_UNAVAILABLE_CODE);
  }
  const maybe = c as { getRandomValues?: unknown; randomUUID?: unknown };
  if (typeof maybe.getRandomValues !== "function") {
    throw new FediError(UNAVAILABLE_MESSAGE, CRYPTO_UNAVAILABLE_CODE);
  }
  return maybe as unknown as CryptoLike;
}

/** `n` cryptographically random bytes. Throws when no CSPRNG exists. */
export function randomBytes(n: number): Uint8Array {
  if (!Number.isInteger(n) || n <= 0 || n > 65536) {
    throw new RangeError(`randomBytes needs a byte count of 1-65536, got ${String(n)}.`);
  }
  const out = new Uint8Array(n);
  cryptoOrThrow().getRandomValues(out);
  return out;
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Base64url (no padding) of `bytes`. Manual alphabet: no `btoa` dependency. */
function base64UrlOf(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64URL[(n >>> 18) & 63];
    out += B64URL[(n >>> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL[(n >>> 6) & 63];
    if (i + 2 < bytes.length) out += B64URL[n & 63];
  }
  return out;
}

/** URL-safe token of `bytes` random bytes (default 32 -> 43 chars: the PKCE
 * verifier/state shape, RFC 7636 unreserved set). Throws without a CSPRNG. */
export function randomToken(bytes = 32): string {
  return base64UrlOf(randomBytes(bytes));
}

const HEX = "0123456789abcdef";

/** RFC 4122 v4 UUID: the native `randomUUID` when present, otherwise the
 * same bits synthesized from `getRandomValues`. Throws without a CSPRNG. */
export function randomUuid(): string {
  const c = cryptoOrThrow();
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = (i: number): string => HEX[(b[i] >>> 4) & 15] + HEX[b[i] & 15];
  return (
    h(0) + h(1) + h(2) + h(3) + "-" + h(4) + h(5) + "-" + h(6) + h(7) + "-" +
    h(8) + h(9) + "-" + h(10) + h(11) + h(12) + h(13) + h(14) + h(15)
  );
}
