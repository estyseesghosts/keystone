// Native crypto polyfill (repair X2.1).
//
// Import order (verified from `index.ts` / `index.web.ts`): both entries
// import `#/platform/polyfills` (native) or the `.web` twin FIRST — line 2
// of `index.ts`, before `App` (line 7) — so this runs before any
// `packages/fedi` import. Nothing in fedi imports `expo-crypto` directly
// (`no-ui-in-fedi`): the seam there reads `globalThis.crypto`, which is
// installed here.
//
// Install-only-when-absent: a real `getRandomValues` (browser, or a later
// runtime that provides one) is never overwritten; a present object that is
// only missing `randomUUID` gets just that field patched.

import { getRandomValues, randomUUID } from "expo-crypto";

interface CryptoShape {
  getRandomValues?: unknown;
  randomUUID?: unknown;
}

const existing = (globalThis as { crypto?: unknown }).crypto as CryptoShape | undefined;

if (!existing || typeof existing !== "object" || typeof existing.getRandomValues !== "function") {
  const preserved = existing !== null && typeof existing === "object" ? existing : {};
  Object.defineProperty(globalThis, "crypto", {
    value: {
      ...preserved,
      getRandomValues: <T extends Uint8Array>(array: T): T => getRandomValues(array),
      randomUUID: (): string => randomUUID(),
    },
    configurable: true,
    writable: true,
  });
} else if (typeof existing.randomUUID !== "function") {
  try {
    existing.randomUUID = (): string => randomUUID();
  } catch {
    // A frozen crypto object keeps its own (absent) shape; fedi's
    // `randomUuid` synthesizes v4 from `getRandomValues` in that case.
  }
}
