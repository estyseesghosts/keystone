// Repair X7.4: shared upload-source helpers (`core/backend.ts`) — the
// native `{uri, name, type}` reference form, byte sizes, the size-scaled
// deadline (networking M8: min 60 s, +30 s per 10 MB, max 15 min), and the
// multipart append. Pure functions, no transport.

import {
  appendUploadFile,
  isUploadFileRef,
  uploadSizeOf,
  uploadTimeoutForBytes,
} from "../src/core/backend";

describe("isUploadFileRef", () => {
  it("duck-types on `uri` (never instanceof — Hermes may lack File)", () => {
    expect(isUploadFileRef({uri: "file:///a.jpg", name: "a.jpg", type: "image/jpeg"})).toBe(true);
    expect(isUploadFileRef(new File(["x"], "a.png"))).toBe(false);
    expect(isUploadFileRef(null as unknown as File)).toBe(false);
  });
});

describe("uploadSizeOf", () => {
  it("reads File sizes and ref counts, null when unknown", () => {
    expect(uploadSizeOf(new File(["12345"], "a.png"))).toBe(5);
    expect(uploadSizeOf({uri: "file:///a", name: "a", type: "image/jpeg", size: 42})).toBe(42);
    expect(uploadSizeOf({uri: "file:///a", name: "a", type: "image/jpeg"})).toBeNull();
    expect(uploadSizeOf({uri: "file:///a", name: "a", type: "image/jpeg", size: -1})).toBeNull();
  });
});

describe("uploadTimeoutForBytes", () => {
  const MB = 1024 * 1024;
  it("floors unknown sizes at 60 s and scales +30 s per 10 MB up to 15 min", () => {
    expect(uploadTimeoutForBytes(null)).toBe(60_000);
    expect(uploadTimeoutForBytes(undefined)).toBe(60_000);
    expect(uploadTimeoutForBytes(0)).toBe(60_000);
    expect(uploadTimeoutForBytes(1)).toBe(90_000);
    expect(uploadTimeoutForBytes(10 * MB)).toBe(90_000);
    expect(uploadTimeoutForBytes(10 * MB + 1)).toBe(120_000);
    expect(uploadTimeoutForBytes(100 * MB)).toBe(360_000);
    expect(uploadTimeoutForBytes(1024 * MB)).toBe(15 * 60_000);
  });
});

describe("appendUploadFile", () => {
  it("appends Files with their name and refs as {uri, name, type}", () => {
    const forFile = new FormData();
    appendUploadFile(forFile, "file", new File(["x"], "a.png", {type: "image/png"}), "upload");
    expect((forFile.get("file") as File).name).toBe("a.png");

    const forRef = new FormData();
    // Node's FormData stringifies plain objects (RN keeps the
    // `{uri, name, type}` ref): assert the raw append arg, not `.get()`.
    const appendSpy = jest.spyOn(FormData.prototype, "append");
    try {
      appendUploadFile(
        forRef,
        "file",
        {uri: "file:///tmp/a.jpg", name: "a.jpg", type: "image/jpeg"},
        "upload",
      );
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
  });
});
