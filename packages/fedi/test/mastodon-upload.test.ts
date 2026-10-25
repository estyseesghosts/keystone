// Repair X7.4 steps 1, 2, 5: the Mastodon media upload — multipart POST
// with the size-scaled deadline, the bounded processing poll (~15 s, M13:
// a null URL is returned as-is, never `done`), caller abort through the
// poll, the distinct upload-timeout code, and native references.
//
// The backend runs against a stubbed `MastoClient`; the injectable-sender
// path is covered at the endpoint level. No network.

import { createMastodonBackend } from "../src/mastodon/backend";
import { uploadMediaAttachment } from "../src/mastodon/endpoints";
import type { MastoClient, RequestResult } from "../src/mastodon/client";
import { MastoHttpError } from "../src/mastodon/client";
import type { UploadRequestImpl } from "../src/core/backend";

const ORIGIN = "https://mastodon.example";

function ok<T>(data: T): Promise<RequestResult<T>> {
  return Promise.resolve({status: 200, data, headers: new Headers()});
}

interface MastoStub {
  client: MastoClient;
  postFormData: jest.Mock;
  get: jest.Mock;
}

function stubClient(): MastoStub {
  const postFormData = jest.fn();
  const get = jest.fn();
  const noop = () => ok(undefined);
  const client = {
    origin: ORIGIN,
    token: "t",
    get,
    post: noop,
    put: noop,
    patch: noop,
    delete: noop,
    postForm: noop,
    postFormData,
    patchFormData: noop,
  } as unknown as MastoClient;
  return {client, postFormData, get};
}

const PROCESSING = {id: "m1", type: "image", url: null, preview_url: null};
const READY = {id: "m1", type: "image", url: "https://mastodon.example/m1.png", preview_url: null};

afterEach(() => {
  jest.useRealTimers();
});

describe("backend processing poll (X7.4 step 5)", () => {
  it("resolves through the poll when the server finishes", async () => {
    jest.useFakeTimers();
    const {client, postFormData, get} = stubClient();
    postFormData.mockResolvedValue({status: 202, data: PROCESSING, headers: new Headers()});
    get.mockResolvedValueOnce({status: 200, data: PROCESSING, headers: new Headers()});
    get.mockResolvedValue({status: 200, data: READY, headers: new Headers()});
    const backend = createMastodonBackend(client);
    const promise = backend.uploadMedia(new File(["x"], "a.png"));
    const assertion = expect(promise).resolves.toMatchObject({id: "m1"});
    await jest.advanceTimersByTimeAsync(5_000);
    const media = await promise;
    await assertion;
    expect(media.url).toBe("https://mastodon.example/m1.png");
    // The scaled deadline rides the POST (1 byte → 90 s).
    expect(postFormData.mock.calls[0][2]).toMatchObject({timeoutMs: 90_000});
  });

  it("returns the media as-is when the budget elapses (processing, never done-with-null)", async () => {
    jest.useFakeTimers();
    const {client, postFormData, get} = stubClient();
    postFormData.mockResolvedValue({status: 202, data: PROCESSING, headers: new Headers()});
    get.mockResolvedValue({status: 200, data: PROCESSING, headers: new Headers()});
    const backend = createMastodonBackend(client);
    const promise = backend.uploadMedia(new File(["x"], "a.png"));
    await jest.advanceTimersByTimeAsync(16_000);
    const media = await promise;
    expect(media.id).toBe("m1");
    expect(media.url).toBeNull();
    expect(get.mock.calls.length).toBeGreaterThan(1);
  });

  it("aborts the poll on caller Cancel (never swallowed, never outlived)", async () => {
    jest.useFakeTimers();
    const {client, postFormData, get} = stubClient();
    postFormData.mockResolvedValue({status: 202, data: PROCESSING, headers: new Headers()});
    get.mockResolvedValue({status: 200, data: PROCESSING, headers: new Headers()});
    const backend = createMastodonBackend(client);
    const ctrl = new AbortController();
    const promise = backend.uploadMedia(new File(["x"], "a.png"), {signal: ctrl.signal});
    const assertion = expect(promise).rejects.toMatchObject({kind: "aborted"});
    // Let the POST resolve and the first poll delay start.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    ctrl.abort();
    await assertion;
  });

  it("maps a deadline failure to timeoutUpload (may be stored)", async () => {
    const {client, postFormData} = stubClient();
    postFormData.mockRejectedValue(
      new MastoHttpError({
        kind: "timeout",
        code: "errors.network.timeoutInstance",
        params: {target: "POST /api/v2/media", n: 90},
        origin: ORIGIN,
        method: "POST",
        path: "/api/v2/media",
        message: "Request timed out.",
      }),
    );
    const backend = createMastodonBackend(client);
    await expect(backend.uploadMedia(new File(["x"], "a.png"))).rejects.toMatchObject({
      code: "errors.network.timeoutUpload",
    });
    await expect(
      backend.uploadMedia(new File(["x"], "a.png")),
    ).rejects.toThrow(/may already be on the server/);
  });

  it("appends a native reference as {uri, name, type}", async () => {
    const {client, postFormData} = stubClient();
    postFormData.mockImplementation((_path: string, form: FormData) =>
      ok({...READY, id: "m9"}),
    );
    const backend = createMastodonBackend(client);
    // Node's FormData stringifies plain objects (RN keeps the ref): spy the
    // raw append args instead of reading back through `.get()`.
    const appendSpy = jest.spyOn(FormData.prototype, "append");
    try {
      const media = await backend.uploadMedia({
        uri: "file:///tmp/a.jpg",
        name: "a.jpg",
        type: "image/jpeg",
        size: 4242,
      });
      expect(media.id).toBe("m9");
      const calls = appendSpy.mock.calls as unknown as Array<[string, unknown]>;
      const refPart = calls
        .map(([, value]) => value)
        .find(value => typeof value === "object" && value !== null && "uri" in (value as Record<string, unknown>));
      expect(refPart).toMatchObject({
        uri: "file:///tmp/a.jpg",
        name: "a.jpg",
        type: "image/jpeg",
      });
    } finally {
      appendSpy.mockRestore();
    }
  });
});

describe("uploadMediaAttachment injectable sender (X7.4 steps 1-2)", () => {
  const client = {origin: ORIGIN, token: "t"} as unknown as MastoClient;
  const form = () => {
    const f = new FormData();
    f.append("file", new File(["x"], "a.png"));
    return f;
  };

  function abortError(): Error {
    const err = new Error("aborted");
    err.name = "AbortError";
    return err;
  }

  it("sends auth headers and returns the parsed attachment", async () => {
    const uploadImpl: UploadRequestImpl = jest.fn(async req => ({
      status: 200,
      bodyText: JSON.stringify(READY),
    }));
    const out = await uploadMediaAttachment(client, form(), {timeoutMs: 60_000, uploadImpl});
    expect(out.id).toBe("m1");
    expect(uploadImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${ORIGIN}/api/v2/media`,
        method: "POST",
        headers: {Authorization: "Bearer t"},
      }),
    );
  });

  it("reports the upload timeout distinctly (may be stored)", async () => {
    jest.useFakeTimers();
    const uploadImpl: UploadRequestImpl = jest.fn(
      (_req): Promise<{status: number; bodyText: string}> =>
        new Promise((_resolve, reject) => {
          _req.signal?.addEventListener("abort", () => reject(abortError()), {once: true});
        }),
    );
    const promise = uploadMediaAttachment(client, form(), {timeoutMs: 5_000, uploadImpl});
    const assertion = expect(promise).rejects.toMatchObject({
      code: "errors.network.timeoutUpload",
    });
    await jest.advanceTimersByTimeAsync(6_000);
    await assertion;
  });

  it("aborts distinctly after 60 s without progress (stall)", async () => {
    jest.useFakeTimers();
    const uploadImpl: UploadRequestImpl = jest.fn(async req => {
      req.onProgress?.(1, 100);
      await new Promise((_resolve, reject) => {
        req.signal?.addEventListener("abort", () => reject(abortError()), {once: true});
      });
      throw new Error("unreachable");
    });
    const promise = uploadMediaAttachment(client, form(), {
      timeoutMs: 600_000,
      uploadImpl,
      onProgress: () => {},
    });
    const assertion = expect(promise).rejects.toMatchObject({
      code: "errors.network.timeoutUpload",
    });
    await jest.advanceTimersByTimeAsync(66_000);
    await assertion;
    await expect(promise).rejects.toThrow(/stalled/);
  });

  it("maps caller abort to errors.network.aborted", async () => {
    const uploadImpl: UploadRequestImpl = jest.fn(
      req =>
        new Promise<{status: number; bodyText: string}>((_resolve, reject) => {
          req.signal?.addEventListener("abort", () => reject(abortError()), {once: true});
        }),
    );
    const ctrl = new AbortController();
    const promise = uploadMediaAttachment(client, form(), {
      timeoutMs: 60_000,
      uploadImpl,
      signal: ctrl.signal,
    });
    const assertion = expect(promise).rejects.toMatchObject({
      code: "errors.network.aborted",
    });
    ctrl.abort();
    await assertion;
  });

  it("refuses an auto-followed cross-origin redirect", async () => {
    const uploadImpl: UploadRequestImpl = jest.fn(async () => ({
      status: 200,
      bodyText: "{}",
      responseUrl: "https://evil.example/api/v2/media",
    }));
    await expect(
      uploadMediaAttachment(client, form(), {timeoutMs: 60_000, uploadImpl}),
    ).rejects.toMatchObject({code: "errors.network.redirect"});
  });

  it("maps an HTTP failure through the server error text", async () => {
    const uploadImpl: UploadRequestImpl = jest.fn(async () => ({
      status: 422,
      bodyText: JSON.stringify({error: "File is too large"}),
    }));
    await expect(
      uploadMediaAttachment(client, form(), {timeoutMs: 60_000, uploadImpl}),
    ).rejects.toThrow(/File is too large/);
  });
});
