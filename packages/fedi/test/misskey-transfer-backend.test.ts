// P6.2 — Backend.transfer wiring (clickstone §2.3).
//
// The Misskey family exposes `transfer` (Drive-upload-then-`{fileId}`
// imports, enqueue-only exports); the Mastodon family leaves it
// undefined — the contract (`docs/mastoapi-contract.md`) records that
// Mastodon import/export is server-side CSV with no MastoAPI
// equivalent, so the UI disables those rows with a reason instead of
// faking them. Stub transports only; no network.

import { ApiError } from "../src/core/errors";
import type { Backend } from "../src/core/backend";
import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import { IMPORT_MAX_BYTES } from "../src/misskey/importExport";
import { createMastodonBackend } from "../src/mastodon/backend";
import type { MastoClient } from "../src/mastodon/client";

interface RecordedCall {
  endpoint: string;
  params: Record<string, unknown>;
}

/** Stub transport: `upload` returns a Drive id; `call` records + answers. */
function stubTransport(
  respond: (endpoint: string, params: Record<string, unknown>) => unknown,
  uploadedId: unknown = "file-9",
): { transport: MisskeyTransport; calls: RecordedCall[]; uploaded: File[] } {
  const calls: RecordedCall[] = [];
  const uploaded: File[] = [];
  return {
    calls,
    uploaded,
    transport: {
      call<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ endpoint, params });
        return Promise.resolve(respond(endpoint, params) as T);
      },
      upload<T>(file: File): Promise<T> {
        uploaded.push(file);
        calls.push({ endpoint: "drive/files/create", params: {} });
        return Promise.resolve({ id: uploadedId } as T);
      },
    },
  };
}

function stubMasto(): MastoClient {
  const ok = () => Promise.resolve({ status: 200, data: undefined as never, headers: new Headers() });
  return {
    origin: "https://mastodon.example",
    token: "t",
    get: ok,
    post: ok,
    put: ok,
    patch: ok,
    delete: ok,
    postForm: ok,
    postFormData: ok,
    patchFormData: ok,
  } as unknown as MastoClient;
}

describe("MisskeyBackend.transfer imports (upload-then-{fileId})", () => {
  it("uploads the file, then calls the import endpoint with {fileId} only", async () => {
    const { transport, calls, uploaded } = stubTransport(() => undefined);
    const backend = createMisskeyBackend(transport);
    const phases: string[] = [];
    const file = new File(["a,b\nc,d"], "following.csv", { type: "text/csv" });
    const result = await backend.transfer!.importFile("following", file, {
      onPhase: (phase) => phases.push(phase),
    });
    // Multipart upload first, with the picked bytes.
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].name).toBe("following.csv");
    // Then exactly one import call, `{fileId}` — never `{file}`.
    const imports = calls.filter((c) => c.endpoint === "i/import-following");
    expect(imports).toHaveLength(1);
    expect(imports[0].params).toEqual({ fileId: "file-9" });
    expect(JSON.stringify(calls)).not.toContain('"file":');
    // Phases run upload → submit → done; the result carries the Drive id.
    expect(phases).toEqual(["uploading", "submitting", "done"]);
    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("i/import-following");
    expect(result.fileId).toBe("file-9");
  });

  it("maps mute to i/import-muting and refuses oversize files before any I/O", async () => {
    const { transport, calls } = stubTransport(() => undefined);
    const backend = createMisskeyBackend(transport);
    const file = new File(["x"], "mute.csv");
    const result = await backend.transfer!.importFile("mute", file);
    expect(result.endpoint).toBe("i/import-muting");

    const big = new File([new Uint8Array(IMPORT_MAX_BYTES + 1)], "big.csv");
    await expect(backend.transfer!.importFile("blocking", big)).rejects.toThrow();
    // The oversize call added no transport traffic beyond the earlier import.
    expect(calls.filter((c) => c.endpoint === "i/import-blocking")).toHaveLength(0);
  });

  it("never calls the import endpoint when the upload fails", async () => {
    const calls: RecordedCall[] = [];
    const transport: MisskeyTransport = {
      call<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ endpoint, params });
        return Promise.resolve(undefined as T);
      },
      upload<T>(): Promise<T> {
        return Promise.reject(new ApiError("Too big", 400));
      },
    };
    const backend = createMisskeyBackend(transport);
    await expect(
      backend.transfer!.importFile("following", new File(["x"], "f.csv")),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("surfaces a stock 404 (e.g. notes import) as the unsupported error", async () => {
    const { transport } = stubTransport(() => {
      throw new ApiError("No such endpoint", 404);
    });
    const backend = createMisskeyBackend(transport);
    await expect(
      backend.transfer!.importFile("notes", new File(["x"], "notes.csv")),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("MisskeyBackend.transfer exports (enqueue-only)", () => {
  it("reports queued + exportCompleted for an empty-body enqueue", async () => {
    const { transport, calls } = stubTransport(() => undefined);
    const backend = createMisskeyBackend(transport);
    const result = await backend.transfer!.exportList("notes");
    expect(calls).toEqual([{ endpoint: "i/export-notes", params: {} }]);
    expect(result.status).toBe("queued");
    if (result.status !== "queued") throw new Error("expected queued");
    expect(result.notificationType).toBe("exportCompleted");
    expect(result.rateLimit).toEqual({ max: 1, window: "day" });
    expect(result.message).toContain("once a day");
  });

  it("reports a payload fork honestly instead of a fake queue", async () => {
    const { transport } = stubTransport(() => ({ rows: [1, 2] }));
    const backend = createMisskeyBackend(transport);
    const result = await backend.transfer!.exportList("following");
    expect(result).toEqual({
      status: "payload",
      endpoint: "i/export-following",
      payload: { rows: [1, 2] },
    });
  });
});

describe("MastodonBackend.transfer (no MastoAPI equivalent)", () => {
  it.each(["mastodon", "akkoma", "pleroma"] as const)(
    "leaves transfer undefined on %s",
    (flavor) => {
      const backend: Backend = createMastodonBackend(stubMasto(), { flavor });
      expect(backend.transfer).toBeUndefined();
    },
  );
});
