// P6.6 slice 1: Drive wire — usage, folder scoping/paging, sort probe
// gating, move-bulk with per-file fallback, show path walk. Transport
// stubbed; no network.

import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import {
  driveMoveBulkSupportFor,
  driveSortSupportFor,
  probeDriveMoveBulk,
  probeDriveSort,
  resetDriveMoveBulkSupportCache,
  resetDriveSortSupportCache,
  setDriveMoveBulkSupportFor,
} from "../src/misskey/drive";
import { ApiError } from "../src/core/errors";

interface RecordedCall {
  endpoint: string;
  params: Record<string, unknown>;
}

const ORIGIN = "https://mk.example";

function stubTransport(
  respond: (endpoint: string, params: Record<string, unknown>) => unknown,
): { transport: MisskeyTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    transport: {
      call<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ endpoint, params });
        return Promise.resolve(respond(endpoint, params) as T);
      },
      upload<T>(): Promise<T> {
        throw new Error("no upload in this test");
      },
    },
  };
}

const file = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  createdAt: "2026-10-20T10:00:00.000Z",
  name: "a.png",
  type: "image/png",
  md5: "md5",
  size: 10,
  isSensitive: false,
  blurhash: null,
  properties: {},
  url: "https://mk.example/f1.png",
  thumbnailUrl: null,
  comment: null,
  folderId: null,
  userId: "u1",
  ...over,
});

const folder = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  createdAt: "2026-10-20T10:00:00.000Z",
  name: "Photos",
  parentId: null,
  ...over,
});

describe("DriveApi.folders", () => {
  it("sends parentId only when non-null, with paging (B2)", async () => {
    const { transport, calls } = stubTransport(() => [folder()]);
    const backend = createMisskeyBackend(transport, "misskey", {origin: ORIGIN});
    await backend.drive!.folders!.list({ parentId: null, limit: 5 });
    expect(calls[0]!.params).toEqual({ limit: 5 });
    await backend.drive!.folders!.list({ parentId: "d9", limit: 5 });
    expect(calls[1]!.params).toEqual({ limit: 5, folderId: "d9" });
  });

  it("show walks parents root-first and stops at a missing parent", async () => {
    const { transport } = stubTransport(endpoint => {
      if (endpoint === "drive/folders/show") return folder();
      throw new ApiError("nope", 404);
    });
    // root folder: path is just itself
    const backend = createMisskeyBackend(transport, "misskey", {origin: ORIGIN});
    const detail = await backend.drive!.folders!.show("d1");
    expect(detail.folder.id).toBe("d1");
    expect(detail.path.map(f => f.id)).toEqual(["d1"]);
  });

  it("show builds the root-first path through nested parents", async () => {
    const { transport, calls } = stubTransport((endpoint, params) => {
      if (endpoint !== "drive/folders/show") throw new ApiError("nope", 404);
      const id = (params as { folderId: string }).folderId;
      if (id === "child") return folder({ id: "child", name: "Child", parentId: "d1" });
      return folder();
    });
    const backend = createMisskeyBackend(transport, "misskey", {origin: ORIGIN});
    const detail = await backend.drive!.folders!.show("child");
    expect(detail.path.map(f => f.name)).toEqual(["Photos", "Child"]);
    expect(calls.filter(c => c.endpoint === "drive/folders/show")).toHaveLength(2);
  });
});

describe("DriveApi.usage", () => {
  it("returns capacity/usage bytes, coercing garbage to 0", async () => {
    const { transport } = stubTransport(() => ({ capacity: 100, usage: 40 }));
    const backend = createMisskeyBackend(transport, "misskey", {origin: ORIGIN});
    expect(await backend.drive!.usage()).toEqual({ capacity: 100, usage: 40 });
    const bad = stubTransport(() => ({}));
    const backend2 = createMisskeyBackend(bad.transport, "misskey", {origin: ORIGIN});
    expect(await backend2.drive!.usage()).toEqual({ capacity: 0, usage: 0 });
  });
});

describe("drive sort probe (DC-7)", () => {
  beforeEach(() => {
    resetDriveSortSupportCache();
  });

  it("probe true on success, false on 400, null on network failure", async () => {
    const ok = stubTransport(() => []);
    expect(await probeDriveSort(ok.transport.call, "https://a.example")).toBe(true);
    expect(driveSortSupportFor("https://a.example")).toBe(true);

    resetDriveSortSupportCache();
    const bad = stubTransport(() => {
      throw new ApiError("bad", 400, "INVALID_PARAM");
    });
    expect(await probeDriveSort(bad.transport.call, "https://b.example")).toBe(false);

    const down = stubTransport(() => {
      throw new ApiError("down", 0);
    });
    expect(await probeDriveSort(down.transport.call, "https://c.example")).toBeNull();
    expect(driveSortSupportFor("https://c.example")).toBeNull();
  });

  it("never sends sort once the verdict is false; sends when unknown", async () => {
    const { transport, calls } = stubTransport(() => [file()]);
    const backend = createMisskeyBackend(transport, "misskey", {origin: ORIGIN});
    // unknown verdict: sent (implicit probe, caches true on success)
    await backend.drive!.files({ sort: "-createdAt" });
    expect(calls[0]!.params).toMatchObject({ sort: "-createdAt" });
    expect(backend.drive!.isSortSupported()).toBe(true);
    // seed false via a 400 probe on the same origin
    const failing = stubTransport(() => {
      throw new ApiError("bad", 400, "INVALID_PARAM");
    });
    await probeDriveSort(failing.transport.call, ORIGIN);
    const shared = stubTransport(() => [file()]);
    const backend2 = createMisskeyBackend(shared.transport, "misskey", {origin: ORIGIN});
    await backend2.drive!.files({ sort: "-createdAt" });
    expect(shared.calls[0]!.params).not.toHaveProperty("sort");
    expect(backend2.drive!.isSortSupported()).toBe(false);
  });
});

describe("drive move-bulk probe + fallback (DC-7)", () => {
  beforeEach(() => {
    resetDriveMoveBulkSupportCache();
  });

  it("probe false on 404, true on validation error", async () => {
    const gone = stubTransport(() => {
      throw new ApiError("nope", 404);
    });
    expect(await probeDriveMoveBulk(gone.transport.call, "https://a.example")).toBe(false);
    expect(driveMoveBulkSupportFor("https://a.example")).toBe(false);

    const exists = stubTransport(() => {
      throw new ApiError("empty", 400, "INVALID_PARAM");
    });
    expect(await probeDriveMoveBulk(exists.transport.call, "https://b.example")).toBe(true);
  });

  it("moveMany uses the endpoint when supported", async () => {
    setDriveMoveBulkSupportFor("https://mk.example", true);
    const shared = stubTransport(() => undefined);
    const backend = createMisskeyBackend(shared.transport, "misskey", {origin: ORIGIN});
    await backend.drive!.moveMany(["f1", "f2"], "d9");
    expect(shared.calls).toHaveLength(1);
    expect(shared.calls[0]).toEqual({
      endpoint: "drive/files/move-bulk",
      params: { fileIds: ["f1", "f2"], folderId: "d9" },
    });
  });

  it("moveMany falls back to per-file update on 404 and caches the verdict", async () => {
    const shared = stubTransport((endpoint) => {
      if (endpoint === "drive/files/move-bulk") throw new ApiError("nope", 404);
      return file();
    });
    const backend = createMisskeyBackend(shared.transport, "misskey", {origin: ORIGIN});
    await backend.drive!.moveMany(["f1", "f2"], null);
    const endpoints = shared.calls.map(c => c.endpoint);
    expect(endpoints[0]).toBe("drive/files/move-bulk");
    expect(endpoints.slice(1)).toEqual(["drive/files/update", "drive/files/update"]);
    expect(driveMoveBulkSupportFor("https://mk.example")).toBe(false);
    // second call skips the endpoint entirely
    await backend.drive!.moveMany(["f3"], null);
    expect(shared.calls[shared.calls.length - 1]!.endpoint).toBe("drive/files/update");
  });

  it("isMoveBulkSupported reads the per-origin verdict", async () => {
    const { transport } = stubTransport(() => undefined);
    const backend = createMisskeyBackend(transport, "misskey", {origin: ORIGIN});
    expect(backend.drive!.isMoveBulkSupported()).toBeNull();
    setDriveMoveBulkSupportFor("https://mk.example", true);
    expect(backend.drive!.isMoveBulkSupported()).toBe(true);
  });
});
