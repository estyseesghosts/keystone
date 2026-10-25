// Status-level sensitivity + language (repair X4.4 finding 11):
// `PostDraft.sensitive`/`language` ride `StatusBody` on create, edit and
// scheduled create; the Mastodon `uploadMedia` signature takes no
// per-file sensitivity flag (the family has none — status-level only).
//
// Jest port: `describe/it/expect` are globals (no vitest import).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { statusBodyOf } from "../src/mastodon/compose";
import { createMastodonBackend } from "../src/mastodon/backend";
import type { MastoClient, RequestResult } from "../src/mastodon/client";
import type { Status } from "../src/mastodon/wire";

function fixture<T>(flavor: string, name: string): T {
  const raw = readFileSync(join(__dirname, "fixtures", flavor, name), "utf8");
  return JSON.parse(raw) as T;
}

const status = fixture<Status>("mastodon", "status.json");

interface RecordedCall {
  method: string;
  path: string;
  body?: unknown;
}

function stubClient(): { client: MastoClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const respond = (
    method: string,
    path: string,
    body?: unknown,
  ): RequestResult<never> => {
    calls.push({ method, path, body });
    let data: unknown = [];
    if (path === "/api/v1/media/m1") {
      data = { id: "m1", type: "image", url: "https://files.example/m1.png", preview_url: null };
    } else if (path.startsWith("/api/v1/statuses") || path === "/api/v2/media") {
      data = path === "/api/v2/media"
        ? { id: "m1", type: "image", url: "https://files.example/m1.png", preview_url: null }
        : status;
    }
    return { status: 200, data: data as never, headers: new Headers() };
  };
  const client: MastoClient = {
    origin: "https://mastodon.example",
    token: "t",
    get: (path, query, _o) => Promise.resolve(respond("GET", path, query)),
    post: (path, body, _o) => Promise.resolve(respond("POST", path, body)),
    put: (path, body, _o) => Promise.resolve(respond("PUT", path, body)),
    patch: (path, body, _o) => Promise.resolve(respond("PATCH", path, body)),
    delete: (path, body, _o) => Promise.resolve(respond("DELETE", path, body)),
    postForm: (path, body, _o) => Promise.resolve(respond("POST", path, body)),
    postFormData: (path, body, _o) => Promise.resolve(respond("POST", path, body)),
    patchFormData: (path, body, _o) => Promise.resolve(respond("PATCH", path, body)),
  };
  return { client, calls };
}

describe("statusBodyOf sensitive/language", () => {
  it("sends sensitive + language when the draft sets them", () => {
    const body = statusBodyOf({
      text: "hello",
      visibility: { kind: "public", localOnly: false },
      sensitive: true,
      language: "de",
    });
    expect(body.sensitive).toBe(true);
    expect(body.language).toBe("de");
  });

  it("sends explicit false sensitivity (an edit clearing the flag)", () => {
    const body = statusBodyOf({
      text: "hello",
      visibility: { kind: "public", localOnly: false },
      sensitive: false,
    });
    expect(body.sensitive).toBe(false);
  });

  it("omits both when the draft does not set them", () => {
    const body = statusBodyOf({
      text: "hello",
      visibility: { kind: "public", localOnly: false },
    });
    expect(body).not.toHaveProperty("sensitive");
    expect(body).not.toHaveProperty("language");
  });

  it("omits an empty language, never sends a blank value", () => {
    const body = statusBodyOf({
      text: "hello",
      visibility: { kind: "public", localOnly: false },
      language: "",
    });
    expect(body).not.toHaveProperty("language");
  });
});

describe("backend sends sensitive/language", () => {
  it("createPost carries the draft flags in the wire body", async () => {
    const { client, calls } = stubClient();
    const backend = createMastodonBackend(client);
    await backend.createPost({
      text: "hello",
      visibility: { kind: "public", localOnly: false },
      sensitive: true,
      language: "fr",
    });
    const post = calls.find((c) => c.path === "/api/v1/statuses");
    expect(post?.body).toMatchObject({ sensitive: true, language: "fr" });
  });

  it("editPost carries the draft flags in the wire body", async () => {
    const { client, calls } = stubClient();
    const backend = createMastodonBackend(client);
    await backend.editPost("1", {
      text: "hello",
      visibility: { kind: "public", localOnly: false },
      sensitive: true,
      language: "fr",
    });
    expect(calls).toContainEqual({
      method: "PUT",
      path: "/api/v1/statuses/1",
      body: expect.objectContaining({ sensitive: true, language: "fr" }),
    });
  });

  it("scheduled.create carries the draft flags (same body builder)", async () => {
    const { client, calls } = stubClient();
    const backend = createMastodonBackend(client);
    await backend.scheduled?.create({
      text: "hello",
      visibility: { kind: "public", localOnly: false },
      sensitive: true,
      language: "fr",
      scheduledAt: "2030-01-01T00:00:00.000Z",
    });
    const create = calls.find(
      (c) => c.method === "POST" && c.path === "/api/v1/statuses",
    );
    expect(create?.body).toMatchObject({
      sensitive: true,
      language: "fr",
      scheduled_at: "2030-01-01T00:00:00.000Z",
    });
  });
});

describe("mastodon uploadMedia (finding 11)", () => {
  it("sends file + description and no sensitivity field, and returns a non-sensitive row", async () => {
    const { client, calls } = stubClient();
    const backend = createMastodonBackend(client);
    const file = new File(["bytes"], "pic.png", { type: "image/png" });
    const media = await backend.uploadMedia(file, { comment: "alt text" });
    const upload = calls.find((c) => c.path === "/api/v2/media");
    expect(upload).toBeDefined();
    const form = upload?.body as FormData;
    // Undici clones File parts on 3-arg append (RN keeps them): assert the
    // sent bytes by value, not by identity.
    const sent = form.get("file") as File
    expect(sent).toBeInstanceOf(File)
    expect(sent.name).toBe("pic.png")
    expect(sent.size).toBe(5)
    expect(form.get("description")).toBe("alt text");
    // No per-file sensitivity field exists on this family (finding 11).
    // (No `FormData.keys()` iteration: the test env's DOM lib lacks it;
    // assert the realistic field names directly instead.)
    expect(form.get("is_sensitive")).toBeNull()
    expect(form.get("sensitive")).toBeNull()
    expect(form.get("isSensitive")).toBeNull()
    expect(media.isSensitive).toBe(false);
  });
});
