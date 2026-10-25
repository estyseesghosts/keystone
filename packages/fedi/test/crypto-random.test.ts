// X2.1 — real randomness everywhere: fail-closed CSPRNG seam + stable
// idempotency keys.
//
// - With `globalThis.crypto` removed, every security-path entry throws a
//   typed `FediError('errors.crypto.unavailable')` (never `Math.random`).
// - With the real WebCrypto (jestSetup installs node's), outputs have the
//   documented lengths/charsets, PKCE verifiers meet RFC 7636, and the same
//   body reuses its Idempotency-Key inside the TTL (a retry dedupes).

import { FediError } from "../src/core/errors";
import { randomBytes, randomToken as coreRandomToken, randomUuid } from "../src/core/random";
import {
  STABLE_ATTEMPT_KEY_TTL_MS,
  attemptKeyFor,
  attemptKeyForBody,
  clearStableIdempotencyKeys,
  newIdempotencyKey,
  stableIdempotencyKey,
  type StatusBody,
} from "../src/mastodon/compose";
import { randomToken as oauthRandomToken, s256Challenge } from "../src/mastodon/oauth";
import { mintAppToken } from "../src/misskey/auth";
import type { WireCall } from "../src/misskey/client";
import { newExternalSessionId } from "../src/misskey/external";

const REAL_CRYPTO = globalThis.crypto;

function withoutCrypto(): void {
  Object.defineProperty(globalThis, "crypto", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

function restoreCrypto(): void {
  Object.defineProperty(globalThis, "crypto", {
    value: REAL_CRYPTO,
    configurable: true,
    writable: true,
  });
}

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const B64URL = /^[A-Za-z0-9\-_]+$/;
const HEX32 = /^[0-9a-f]{32}$/;
// RFC 7636 §4.1: 43-128 chars from the unreserved set.
const PKCE_UNRESERVED = /^[A-Za-z0-9\-._~]+$/;

const body = (status: string): StatusBody => ({ status, visibility: "public" });

describe("crypto absent fails closed (no Math.random fallback)", () => {
  beforeEach(withoutCrypto);
  afterEach(restoreCrypto);

  it("randomBytes throws the typed error", () => {
    const err = caught(() => randomBytes(16));
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.crypto.unavailable");
  });

  it("core randomToken throws the typed error", () => {
    const err = caught(() => coreRandomToken());
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.crypto.unavailable");
  });

  it("randomUuid throws the typed error", () => {
    const err = caught(() => randomUuid());
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.crypto.unavailable");
  });

  it("newIdempotencyKey throws the typed error (no random output)", () => {
    const err = caught(() => newIdempotencyKey());
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.crypto.unavailable");
  });

  it("oauth randomToken (PKCE verifier/state) throws the typed error", () => {
    const err = caught(() => oauthRandomToken());
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.crypto.unavailable");
  });

  it("newExternalSessionId throws the typed error", () => {
    const err = caught(() => newExternalSessionId());
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.crypto.unavailable");
  });

  it("mintAppToken (MiAuth newSessionId) throws before any request", async () => {
    let calls = 0;
    const call = (async () => {
      calls += 1;
      return {};
    }) as unknown as WireCall;
    const err = await mintAppToken(call, "native-i").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.crypto.unavailable");
    expect(calls).toBe(0);
  });

  it("stableIdempotencyKey throws without a CSPRNG", () => {
    clearStableIdempotencyKeys();
    const err = caught(() => stableIdempotencyKey("fp"));
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.crypto.unavailable");
  });
});

describe("webcrypto lengths and charsets", () => {
  afterEach(restoreCrypto);

  it("randomBytes has the requested length and varies", () => {
    expect(randomBytes(16)).toHaveLength(16);
    expect(randomBytes(32)).toHaveLength(32);
    expect(Array.from(randomBytes(16))).not.toEqual(Array.from(randomBytes(16)));
  });

  it("core randomToken: 43 chars of base64url, unique", () => {
    const t = coreRandomToken();
    expect(t).toHaveLength(43);
    expect(t).toMatch(B64URL);
    expect(coreRandomToken()).not.toBe(t);
  });

  it("oauth randomToken: 43 chars of base64url, unique", () => {
    const t = oauthRandomToken();
    expect(t).toHaveLength(43);
    expect(t).toMatch(B64URL);
    expect(oauthRandomToken()).not.toBe(t);
  });

  it("newIdempotencyKey: 32 lowercase hex chars, unique", () => {
    const k = newIdempotencyKey();
    expect(k).toMatch(HEX32);
    expect(newIdempotencyKey()).not.toBe(k);
  });

  it("randomUuid and newExternalSessionId are v4 UUIDs, unique", () => {
    expect(randomUuid()).toMatch(UUID_V4);
    const a = newExternalSessionId();
    expect(a).toMatch(UUID_V4);
    expect(newExternalSessionId()).not.toBe(a);
  });

  it("PKCE verifier meets RFC 7636 and its S256 challenge is 43 chars", async () => {
    const verifier = oauthRandomToken();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(PKCE_UNRESERVED);
    const challenge = await s256Challenge(verifier);
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(PKCE_UNRESERVED);
  });
});

describe("idempotency keys survive retries", () => {
  beforeEach(clearStableIdempotencyKeys);

  it("same body reuses its key inside the TTL; a changed body mints anew", () => {
    const first = attemptKeyForBody(body("hello"));
    expect(attemptKeyForBody(body("hello"))).toEqual(first);
    expect(attemptKeyForBody(body("hello!")).key).not.toBe(first.key);
  });

  it("the cached key expires after the TTL", () => {
    const t0 = 1_000;
    const k1 = stableIdempotencyKey("fp", t0);
    expect(stableIdempotencyKey("fp", t0 + 60_000)).toBe(k1);
    expect(stableIdempotencyKey("fp", t0 + STABLE_ATTEMPT_KEY_TTL_MS + 1)).not.toBe(k1);
  });

  it("attemptKeyFor keeps the previous key for an identical body", () => {
    const b = body("same");
    const first = attemptKeyFor(null, b, () => "k1");
    expect(attemptKeyFor(first, { ...b }, () => "k2")).toBe(first);
    expect(attemptKeyFor(first, body("changed"), () => "k2").key).toBe("k2");
  });

  it("a timeout followed by a retry sends the same Idempotency-Key", async () => {
    const sent: Array<{ key: string }> = [];
    const postOnce = async (b: StatusBody, failFirst: boolean): Promise<string> => {
      const { key } = attemptKeyForBody(b);
      if (failFirst) throw new FediError("timed out", "errors.network.timeoutInstance");
      sent.push({ key });
      return key;
    };
    const b = body("hello retry");
    await expect(postOnce(b, true)).rejects.toBeInstanceOf(FediError);
    const retryKey = await postOnce(b, false);
    expect(retryKey).toBe(attemptKeyForBody(b).key);
    expect(sent).toHaveLength(1);
  });
});
