// clickstone §1.7 — edit history, delete-and-redraft's delete, and
// post-upload media descriptions. Wire-level pinning against the read-only
// Mastodon checkout:
//   - `GET /api/v1/statuses/:id/history` → `HistoriesController#show`,
//     `StatusEdit.ordered` = `order(id: :asc)` (OLDEST first, creation
//     snapshot first), serialized by `REST::StatusEditSerializer`
//     (content/spoiler_text/sensitive/created_at/media_attachments).
//     Mastodon web reverses it (`reducers/history.js`); we do the same and
//     keep the honest `original` flag on the first SERVER entry.
//   - `DELETE /api/v1/statuses/:id?delete_media=false` keeps the
//     attachments for a redraft (`StatusesController#destroy` →
//     `RemovalWorker(redraft: !truthy_param?(:delete_media))`).
//   - `PUT /api/v1/media/:id` accepts `description`/`focus` only
//     (`updateable_media_attachment_params`).
//   - Misskey caption edit is `drive/files/update` `comment`
//     (nullable, maxLength 512) — no focus field exists there.

import { adaptStatusHistory } from "../src/mastodon/adapt";
import { createMastodonBackend } from "../src/mastodon/backend";
import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import type { MastoClient, RequestOptions } from "../src/mastodon/client";
import type { DriveFile, Note } from "../src/misskey/wire";
import type { MediaAttachment, StatusEdit } from "../src/mastodon/wire";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", "misskey", name), "utf8"),
  ) as T;
}

const media: MediaAttachment = {
  id: "m1",
  type: "image",
  url: "https://mastodon.example/media/1.png",
  preview_url: null,
  description: "a cat",
};

function edit(overrides: Partial<StatusEdit>): StatusEdit {
  return {
    content: "<p>hello</p>",
    spoiler_text: "",
    sensitive: false,
    created_at: "2026-10-20T00:00:00.000Z",
    account: { id: "a1", acct: "me", username: "me", display_name: "Me" } as StatusEdit["account"],
    media_attachments: [],
    ...overrides,
  };
}

interface Recorded {
  method: string;
  path: string;
  body?: unknown;
  opts?: RequestOptions;
}

function mastoStub(respond: (method: string, path: string) => unknown) {
  const calls: Recorded[] = [];
  const result = (r: unknown) => ({ status: 200, data: r as never, headers: new Headers() });
  const client: MastoClient = {
    origin: "https://mastodon.example",
    token: "t",
    get: (path, _query, opts) => {
      calls.push({ method: "GET", path, opts });
      return Promise.resolve(result(respond("GET", path)));
    },
    post: (path, body) => {
      calls.push({ method: "POST", path, body });
      return Promise.resolve(result(respond("POST", path)));
    },
    put: (path, body) => {
      calls.push({ method: "PUT", path, body });
      return Promise.resolve(result(respond("PUT", path)));
    },
    patch: (path, body) => {
      calls.push({ method: "PATCH", path, body });
      return Promise.resolve(result(respond("PATCH", path)));
    },
    delete: (path, body, opts) => {
      calls.push({ method: "DELETE", path, body, opts });
      return Promise.resolve(result(respond("DELETE", path)));
    },
    postForm: (path, body) => {
      calls.push({ method: "POSTFORM", path, body });
      return Promise.resolve(result(respond("POST", path)));
    },
    postFormData: (path, body) => {
      calls.push({ method: "POSTFORMDATA", path, body });
      return Promise.resolve(result(respond("POST", path)));
    },
    patchFormData: (path, body) => {
      calls.push({ method: "PATCHFORMDATA", path, body });
      return Promise.resolve(result(respond("PATCH", path)));
    },
  };
  return { client, calls };
}

describe("edit history — Mastodon /statuses/:id/history", () => {
  it("reads the history endpoint and reverses the server's oldest-first order", async () => {
    const original = edit({
      content: "<p>first</p>",
      created_at: "2026-10-20T00:00:00.000Z",
      media_attachments: [{ ...media, description: "old alt" }],
    });
    const revised = edit({
      content: "<p>second</p>",
      spoiler_text: "cw",
      sensitive: true,
      created_at: "2026-10-21T00:00:00.000Z",
      media_attachments: [{ ...media, description: "new alt" }],
    });
    const { client, calls } = mastoStub(() => [original, revised]);
    const revisions = await createMastodonBackend(client).editHistory!("s1");

    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/api/v1/statuses/s1/history",
    });
    // NEWEST first, exactly reversed from the server answer.
    expect(revisions.map((r) => r.createdAt)).toEqual([
      "2026-10-21T00:00:00.000Z",
      "2026-10-20T00:00:00.000Z",
    ]);
    // The ORIGINAL stays flagged on the server's first entry, now last.
    expect(revisions.map((r) => r.original)).toEqual([false, true]);
    expect(revisions[0].content.html).toBe("<p>second</p>");
    expect(revisions[0].cw).toBe("cw");
    expect(revisions[0].sensitive).toBe(true);
    // Each revision carries its own alt text, never today's.
    expect(revisions[0].media[0].description).toBe("new alt");
    expect(revisions[1].media[0].description).toBe("old alt");
    expect(revisions[1].content.plain).toBe("first");
  });

  it("adapts an unedited status's single snapshot as the original", () => {
    const out = adaptStatusHistory([edit({})]);
    expect(out).toHaveLength(1);
    expect(out[0].original).toBe(true);
  });

  it("keeps an empty answer empty — never a fabricated revision", () => {
    expect(adaptStatusHistory([])).toEqual([]);
  });

  it("a server without the endpoint surfaces its typed 404 (no fake history)", async () => {
    const { client } = mastoStub(() => {
      throw Object.assign(new Error("not found"), { status: 404 });
    });
    await expect(createMastodonBackend(client).editHistory!("s1")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("has no history method on the Misskey family (no endpoint upstream)", () => {
    const transport: MisskeyTransport = {
      call: <T,>() => Promise.resolve([] as T),
      upload: <T,>() => Promise.resolve({} as T),
    };
    expect(createMisskeyBackend(transport).editHistory).toBeUndefined();
  });
});

describe("delete-and-redraft's delete keeps media", () => {
  it("sends delete_media=false in the QUERY when keepMedia is asked for", async () => {
    const { client, calls } = mastoStub(() => ({}));
    await createMastodonBackend(client).deletePost("s1", { keepMedia: true });
    expect(calls[0]).toMatchObject({
      method: "DELETE",
      path: "/api/v1/statuses/s1",
      opts: { query: { delete_media: false } },
    });
  });

  it("a plain delete sends no delete_media override", async () => {
    const { client, calls } = mastoStub(() => ({}));
    await createMastodonBackend(client).deletePost("s1");
    expect(calls[0].opts).toBeUndefined();
  });
});

describe("media description update — Mastodon PUT /media/:id", () => {
  it("sends description only when only the description is set", async () => {
    const { client, calls } = mastoStub(() => media);
    const updated = await createMastodonBackend(client).updateMedia!("m1", {
      description: "a cat, close up",
    });
    expect(calls[0]).toMatchObject({ method: "PUT", path: "/api/v1/media/m1" });
    expect(calls[0].body).toEqual({ description: "a cat, close up" });
    expect(updated.description).toBe("a cat");
    expect(updated.id).toBe("m1");
  });

  it("sends focus only when only the focus is set — never wiping the description", async () => {
    const { client, calls } = mastoStub(() => media);
    await createMastodonBackend(client).updateMedia!("m1", { focus: "-0.5,0.5" });
    expect(calls[0].body).toEqual({ focus: "-0.5,0.5" });
  });

  it("sends both when both are set, and null clears", async () => {
    const { client, calls } = mastoStub(() => media);
    await createMastodonBackend(client).updateMedia!("m1", {
      description: null,
      focus: "0,0",
    });
    expect(calls[0].body).toEqual({ description: null, focus: "0,0" });
  });
});

describe("media description update — Misskey drive/files/update comment", () => {
  function misskeyStub(respond: (endpoint: string, params: Record<string, unknown>) => unknown) {
    const calls: Array<{ endpoint: string; params: Record<string, unknown> }> = [];
    const transport: MisskeyTransport = {
      call<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ endpoint, params });
        return Promise.resolve(respond(endpoint, params) as T);
      },
      upload<T>(): Promise<T> {
        return Promise.resolve(fixture<DriveFile>("drive-file.json") as T);
      },
    };
    return { transport, calls };
  }

  it("sends the caption as `comment` and never a focus field", async () => {
    const { transport, calls } = misskeyStub(() => fixture<DriveFile>("drive-file.json"));
    const updated = await createMisskeyBackend(transport).updateMedia!("f1", {
      description: "alt text",
      // Misskey has no focus field; it must never reach the wire.
      focus: "-1,1",
    });
    expect(calls[0]).toEqual({
      endpoint: "drive/files/update",
      params: { fileId: "f1", comment: "alt text" },
    });
    expect(updated).toMatchObject({ id: expect.any(String) });
  });

  it("null clears the caption; an untouched description sends no comment", async () => {
    const { transport, calls } = misskeyStub(() => fixture<DriveFile>("drive-file.json"));
    const backend = createMisskeyBackend(transport);
    await backend.updateMedia!("f1", { description: null });
    await backend.updateMedia!("f1", {});
    expect(calls.map((c) => c.params)).toEqual([
      { fileId: "f1", comment: null },
      { fileId: "f1" },
    ]);
  });
});

describe("Misskey edit timestamp (Edited badge gating)", () => {
  it("reads Sharkey's Note.updatedAt into editedAt and stays null when absent", async () => {
    const base = fixture<Note>("note.json");
    const withUpdated: MisskeyTransport = {
      call: <T,>(endpoint: string): Promise<T> =>
        Promise.resolve(
          (endpoint === "notes/show"
            ? { ...base, updatedAt: "2026-10-21T00:00:00.000Z" }
            : base) as T,
        ),
      upload: <T,>() => Promise.resolve({} as T),
    };
    const edited = await createMisskeyBackend(withUpdated).post("n1");
    expect(edited.editedAt).toBe("2026-10-21T00:00:00.000Z");

    // Upstream Misskey packs no `updatedAt`: no badge, never a guessed edit.
    const withoutUpdated: MisskeyTransport = {
      call: <T,>(): Promise<T> => Promise.resolve(base as T),
      upload: <T,>() => Promise.resolve({} as T),
    };
    const untouched = await createMisskeyBackend(withoutUpdated).post("n1");
    expect(untouched.editedAt).toBeNull();
  });
});
