// P6.0 — Misskey import/export upstream shapes.
//
// The v1 port sent `{ file: rawText }` to `i/import-*` (upstream requires
// `{ fileId }` of a Drive upload) and awaited a payload from
// `i/export-notes` (upstream only enqueues a job and answers 204). These
// tests pin the corrected flow at the transport boundary:
//   - the import uploads the picked file as multipart (right name/bytes),
//   - then calls `i/import-*` with `{ fileId }`, never `{ file }`,
//   - the size guard runs before any upload,
//   - exports report queued/rate-limit semantics (or an honest payload),
//   - a 429 is not swallowed.
//
// Transports are stubbed; the multipart test builds the real session-bound
// client with `fetch` stubbed and restored (same pattern as
// `misskey-client.test.ts`). No rig, no network.

import { ApiError, FediError } from "../src/core/errors";
import type { Session } from "../src/core/sessions";
import { createMisskeyClient } from "../src/misskey/client";
import type { WireCall } from "../src/misskey/client";
import {
  EXPORT_RATE_LIMITS,
  IMPORT_ENDPOINTS,
  IMPORT_MAX_BYTES,
  assertImportFileSize,
  exportData,
  importData,
  serializeExport,
  type ExportKind,
  type ImportTransport,
} from "../src/misskey/importExport";

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

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = jest.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return impl(url, init);
  }) as unknown as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

interface RecordedCall {
  endpoint: string;
  params: Record<string, unknown>;
}

/** Stub transport with a recording `upload` (returns a Drive file id). */
function stubTransport(
  respond: (endpoint: string, params: Record<string, unknown>) => unknown,
  uploadedId: string | null = "file-9",
): {
  transport: ImportTransport;
  calls: RecordedCall[];
  uploads: File[];
} {
  const calls: RecordedCall[] = [];
  const uploads: File[] = [];
  const call = ((endpoint: string, params: Record<string, unknown> = {}) => {
    calls.push({ endpoint, params });
    return Promise.resolve().then(() => respond(endpoint, params));
  }) as WireCall;
  async function upload<T>(file: File): Promise<T> {
    uploads.push(file);
    if (!uploadedId) return {} as T;
    return { id: uploadedId } as T;
  }
  return { transport: { call, upload }, calls, uploads };
}

function stubCall(respond: (endpoint: string) => unknown): {
  call: WireCall;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const call = ((endpoint: string, params: Record<string, unknown> = {}) => {
    calls.push({ endpoint, params });
    return Promise.resolve().then(() => respond(endpoint));
  }) as WireCall;
  return { call, calls };
}

const csv = () => new File(["acct,host\n"], "following.csv", { type: "text/csv" });

// --- import: upload first, then { fileId } ---------------------------------

describe("misskey/importExport — import uploads to Drive, then imports by id", () => {
  it("uploads the picked CSV as multipart, then calls i/import-following with {fileId}", async () => {
    const fetched = stubFetch((url) =>
      url.endsWith("/api/drive/files/create")
        ? Promise.resolve(json({ id: "file-1", name: "following.csv" }))
        : Promise.resolve(new Response(null, { status: 204 })),
    );
    const transport = createMisskeyClient(session());
    const phases: string[] = [];

    const result = await importData(transport, "following", csv(), {
      onProgress: (p) => phases.push(p.phase),
    });

    // 1) Multipart Drive upload, with the picked file's own name/bytes.
    expect(fetched).toHaveLength(2);
    expect(fetched[0].url).toBe(`${ORIGIN}/api/drive/files/create`);
    const form = fetched[0].init.body as FormData;
    const uploaded = form.get("file") as File;
    expect(uploaded.name).toBe("following.csv");
    expect(uploaded.type).toBe("text/csv");
    expect(await uploaded.text()).toBe("acct,host\n");
    // The browser sets the multipart boundary — never by hand.
    expect(
      (fetched[0].init.headers as Record<string, string>)["Content-Type"],
    ).toBeUndefined();

    // 2) The import call names the Drive file, never the file body.
    expect(fetched[1].url).toBe(`${ORIGIN}/api/i/import-following`);
    const body = JSON.parse(String(fetched[1].init.body)) as Record<string, unknown>;
    expect(body.fileId).toBe("file-1");
    expect(body).not.toHaveProperty("file");
    expect(body).not.toHaveProperty("content");

    expect(phases).toEqual(["uploading", "submitting", "done"]);
    expect(result).toMatchObject({
      ok: true,
      endpoint: "i/import-following",
      fileId: "file-1",
    });
    expect(result.message).toMatch(/following list/);
  });

  it("maps every kind to its upstream endpoint and sends {fileId} only", async () => {
    for (const [kind, endpoint] of [
      ["following", "i/import-following"],
      ["blocking", "i/import-blocking"],
      ["mute", "i/import-muting"],
      ["notes", "i/import-notes"],
    ] as const) {
      const { transport, calls, uploads } = stubTransport(() => undefined);
      const file = csv();
      const result = await importData(transport, kind, file);

      expect(uploads).toEqual([file]);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ endpoint, params: { fileId: "file-9" } });
      expect(calls[0].params).not.toHaveProperty("file");
      expect(result.endpoint).toBe(endpoint);
      expect(result.fileId).toBe("file-9");
      expect(IMPORT_ENDPOINTS[kind]).toBe(endpoint);
    }
  });

  it("never calls i/import-* when the Drive upload fails", async () => {
    const calls: RecordedCall[] = [];
    const call = ((endpoint: string, params: Record<string, unknown> = {}) => {
      calls.push({ endpoint, params });
      return Promise.resolve(undefined);
    }) as WireCall;
    const transport: ImportTransport = {
      call,
      upload: () =>
        Promise.reject(
          new FediError(
            "Cannot upload the file because you have no free space of drive.",
            "NO_FREE_SPACE",
            { status: 400 },
          ),
        ),
    };
    await expect(importData(transport, "notes", csv())).rejects.toMatchObject({
      code: "NO_FREE_SPACE",
    });
    expect(calls).toHaveLength(0);
  });

  it("rejects an upload response with no file id instead of sending undefined", async () => {
    const { transport, calls } = stubTransport(() => undefined, null);
    await expect(importData(transport, "following", csv())).rejects.toMatchObject({
      code: "errors.shape.uploadedFile",
    });
    expect(calls).toHaveLength(0);
  });

  it("size guard runs before any upload", async () => {
    const { transport, uploads, calls } = stubTransport(() => undefined);
    const big = new File([new Uint8Array(IMPORT_MAX_BYTES + 1)], "big.csv");
    await expect(importData(transport, "following", big)).rejects.toMatchObject({
      code: "errors.compose.fileTooLarge",
    });
    expect(uploads).toHaveLength(0);
    expect(calls).toHaveLength(0);
    // The standalone guard is the same one the importer uses.
    expect(() => assertImportFileSize(big)).toThrow(FediError);
  });
});

// --- export: enqueue only --------------------------------------------------

describe("misskey/importExport — export enqueues a job, never awaits a payload", () => {
  it("i/export-notes returns queued + rate limit + exportCompleted notification", async () => {
    const { call, calls } = stubCall(() => undefined);
    const result = await exportData(call, "notes");

    // One POST, empty body — no second read, no polling, no fabricated bytes.
    expect(calls).toEqual([{ endpoint: "i/export-notes", params: {} }]);
    expect(result).toMatchObject({
      status: "queued",
      endpoint: "i/export-notes",
      delivery: "notification",
      notificationType: "exportCompleted",
      rateLimit: { max: 1, window: "day" },
    });
    if (result.status !== "queued") throw new Error("expected queued");
    expect(result.message).toContain("once a day");
    expect(result.message).toContain("exportCompleted");
    expect(result).not.toHaveProperty("payload");
  });

  it("maps all eight export endpoints with the upstream rate windows", async () => {
    const { call, calls } = stubCall(() => undefined);
    const expected: Array<[ExportKind, string, "minute" | "hour" | "day"]> = [
      ["following", "i/export-following", "hour"],
      ["blocking", "i/export-blocking", "hour"],
      ["mute", "i/export-mute", "hour"],
      ["notes", "i/export-notes", "day"],
      ["user-lists", "i/export-user-lists", "minute"],
      ["antennas", "i/export-antennas", "hour"],
      ["clips", "i/export-clips", "day"],
      ["favorites", "i/export-favorites", "day"],
    ];
    for (const [kind, endpoint] of expected) {
      const result = await exportData(call, kind);
      expect(calls[calls.length - 1]).toEqual({ endpoint, params: {} });
      expect(result.status).toBe("queued");
      expect(EXPORT_RATE_LIMITS[kind].window).toBe(
        expected.find(([k]) => k === kind)![2],
      );
    }
    expect(new Set(calls.map((c) => c.endpoint)).size).toBe(8);
  });

  it("a fork's payload is reported as payload, not as the queued notes shape", async () => {
    const rows = [{ id: "n1" }];
    const { call } = stubCall(() => rows);
    const result = await exportData(call, "notes");
    expect(result).toEqual({ status: "payload", endpoint: "i/export-notes", payload: rows });
    if (result.status !== "payload") throw new Error("expected payload");
    expect(serializeExport("notes.json", result.payload)).toEqual({
      filename: "notes.json",
      mimeType: "application/json",
      text: '[\n  {\n    "id": "n1"\n  }\n]',
    });
  });

  it("propagates the server's 429 instead of pretending the job queued", async () => {
    const { call } = stubCall(() => {
      throw new ApiError("Rate limit exceeded", 429);
    });
    await expect(exportData(call, "notes")).rejects.toMatchObject({ status: 429 });
  });
});
