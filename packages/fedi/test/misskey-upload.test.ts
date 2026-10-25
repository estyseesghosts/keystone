// Repair X7.4 steps 1-3: the Misskey multipart upload — size-scaled
// deadline + 60 s stall detection (both `errors.network.timeoutUpload`,
// "the file may already be stored"), caller abort, native `{uri, name,
// type}` references (never read into JS), byte progress via the injected
// sender, and the cross-origin refusal for auto-followed redirects.
//
// Every request runs against a stubbed seam — no network.

import { createMisskeyClient } from "../src/misskey/client";
import type { FetchImpl } from "../src/core/http";
import type { UploadRequestImpl } from "../src/core/backend";
import { isUploadFileRef } from "../src/core/backend";
import type { Session } from "../src/core/sessions";

const ORIGIN = "https://server.example";

const session = (over: Partial<Session> = {}): Session => ({
  id: `${ORIGIN} u1`,
  origin: ORIGIN,
  family: "misskey",
  flavor: "misskey",
  accountId: "u1",
  token: "sess-token",
  grant: "password",
  hosting: "first-party",
  ...over,
});

function abortError(): Error {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

/** A fetch seam that hangs until its signal aborts (a stalled server). */
function hangingFetch(): jest.Mock {
  return jest.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(abortError()), {once: true});
      }),
  );
}

const DRIVE_FILE = {
  id: "f1",
  createdAt: "2026-10-25T00:00:00.000Z",
  name: "a.png",
  type: "image/png",
  md5: "x",
  size: 5,
  isSensitive: false,
  blurhash: null,
  properties: {},
  url: "https://server.example/files/a.png",
  thumbnailUrl: null,
  comment: null,
  folderId: null,
  userId: "u1",
};

afterEach(() => {
  jest.useRealTimers();
});

describe("deadline + stall (X7.4 step 2)", () => {
  it("scales the deadline with size and reports timeoutUpload (may be stored)", async () => {
    jest.useFakeTimers();
    const client = createMisskeyClient(session(), {
      fetchImpl: hangingFetch() as unknown as FetchImpl,
    });
    // 1 byte → 90 s scaled deadline (min 60 s + one 10 MB step).
    const promise = client.upload(new File(["x"], "a.png"));
    const assertion = expect(promise).rejects.toMatchObject({
      code: "errors.network.timeoutUpload",
      params: expect.objectContaining({target: "drive/files/create", n: 90}),
    });
    await jest.advanceTimersByTimeAsync(91_000);
    await assertion;
    await expect(promise).rejects.toThrow(/may already be on the server/);
  });

  it("aborts distinctly after 60 s without progress bytes (stall)", async () => {
    jest.useFakeTimers();
    const uploadImpl: UploadRequestImpl = jest.fn(async req => {
      req.onProgress?.(100, 1000);
      await new Promise((_resolve, reject) => {
        req.signal?.addEventListener("abort", () => reject(abortError()), {once: true});
      });
      throw new Error("unreachable");
    });
    const client = createMisskeyClient(session(), {
      fetchImpl: hangingFetch() as unknown as FetchImpl,
    });
    const promise = client.upload(new File(["x"], "a.png"), {
      uploadImpl,
      onProgress: () => {},
    });
    const assertion = expect(promise).rejects.toMatchObject({
      code: "errors.network.timeoutUpload",
      params: expect.objectContaining({n: 60}),
    });
    await jest.advanceTimersByTimeAsync(66_000);
    await assertion;
    await expect(promise).rejects.toThrow(/stalled/);
  });

  it("never stall-trips a healthy-but-slow fetch (no progress events, deadline only)", async () => {
    jest.useFakeTimers();
    const client = createMisskeyClient(session(), {
      fetchImpl: hangingFetch() as unknown as FetchImpl,
    });
    const promise = client.upload(new File(["x"], "a.png"));
    const assertion = expect(promise).rejects.toMatchObject({
      code: "errors.network.timeoutUpload",
      params: expect.objectContaining({n: 90}),
    });
    // 61 s of silence on the fetch path: no stall (it never armed), no
    // failure yet — the 90 s deadline still owns the call.
    await jest.advanceTimersByTimeAsync(61_000);
    await jest.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});

describe("abort + progress + references (X7.4 steps 1, 3)", () => {
  it("maps a caller abort to errors.network.aborted (never a timeout)", async () => {
    const client = createMisskeyClient(session(), {
      fetchImpl: hangingFetch() as unknown as FetchImpl,
    });
    const ctrl = new AbortController();
    const promise = client.upload(new File(["x"], "a.png"), {signal: ctrl.signal});
    const assertion = expect(promise).rejects.toMatchObject({
      code: "errors.network.aborted",
    });
    ctrl.abort();
    await assertion;
  });

  it("forwards byte progress from the injected sender", async () => {
    const seen: Array<[number, number | null]> = [];
    const uploadImpl: UploadRequestImpl = jest.fn(async req => {
      req.onProgress?.(10, 100);
      req.onProgress?.(100, 100);
      return {status: 200, bodyText: JSON.stringify(DRIVE_FILE)};
    });
    const client = createMisskeyClient(session(), {
      fetchImpl: hangingFetch() as unknown as FetchImpl,
    });
    const out = await client.upload<typeof DRIVE_FILE>(new File(["x"], "a.png"), {
      uploadImpl,
      onProgress: (loaded, total) => seen.push([loaded, total]),
    });
    expect(out.id).toBe("f1");
    expect(seen).toEqual([
      [10, 100],
      [100, 100],
    ]);
    expect(uploadImpl).toHaveBeenCalledWith(
      expect.objectContaining({method: "POST", timeoutMs: 90_000}),
    );
  });

  it("appends a native reference as {uri, name, type} (bytes never read)", async () => {
    let captured: FormData | null = null;
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      captured = init?.body as FormData;
      return new Response(JSON.stringify(DRIVE_FILE), {status: 200});
    });
    const client = createMisskeyClient(session(), {
      fetchImpl: fetchImpl as unknown as FetchImpl,
    });
    // Node's FormData stringifies plain objects (RN keeps the ref): spy the
    // raw append args instead of reading back through `.get()`.
    const appendSpy = jest.spyOn(FormData.prototype, "append");
    try {
      await client.upload({uri: "file:///tmp/a.jpg", name: "a.jpg", type: "image/jpeg", size: 4242});
      const calls = appendSpy.mock.calls as unknown as Array<[string, unknown]>;
      const refPart = calls.map(([, value]) => value).find(value => isUploadFileRef(value as File));
      expect(refPart).toMatchObject({
        uri: "file:///tmp/a.jpg",
        name: "a.jpg",
        type: "image/jpeg",
      });
    } finally {
      appendSpy.mockRestore();
    }
    // The credential still rides the form (Misskey `i` field).
    expect(captured!.get("i")).toBe("sess-token");
  });

  it("refuses an auto-followed cross-origin redirect from the sender", async () => {
    const uploadImpl: UploadRequestImpl = jest.fn(async () => ({
      status: 200,
      bodyText: "{}",
      responseUrl: "https://evil.example/drive/files/create",
    }));
    const client = createMisskeyClient(session(), {
      fetchImpl: hangingFetch() as unknown as FetchImpl,
    });
    await expect(
      client.upload(new File(["x"], "a.png"), {uploadImpl}),
    ).rejects.toMatchObject({code: "errors.network.redirect"});
  });
});
