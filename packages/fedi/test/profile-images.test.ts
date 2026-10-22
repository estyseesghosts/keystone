// Profile images (clickstone §1.8): `Backend.uploadProfileImage` uploads
// an avatar or banner on BOTH families, with the family's real transport —
// no JSON stand-in for a multipart upload and no Drive id sent where the
// server expects a file.
//
// Verified against the read-only server sources:
// - Mastodon `app/controllers/api/v1/accounts/credentials_controller.rb`
//   (`PATCH /api/v1/accounts/update_credentials`, `account_params` permits
//   `:avatar` / `:header` as attached files) and the web client
//   (`app/javascript/mastodon/actions/accounts.js` +
//   `reducers/slices/profile_edit.ts`: one FormData, `avatar`/`header` key).
// - Misskey `packages/backend/src/server/api/endpoints/i/update.ts`
//   (`avatarId`/`bannerId` must be a Drive file owned by the caller and
//   image-typed) and `drive/files/create` (existing `upload`).
//
// Every request is asserted against a stubbed transport — no network.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createMastodonBackend } from "../src/mastodon/backend";
import type { MastoClient, RequestResult } from "../src/mastodon/client";
import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import type { Account as WireAccount } from "../src/mastodon/wire";
import type { DriveFile, MeDetailed } from "../src/misskey/wire";

function fixture<T>(flavor: string, name: string): T {
  const raw = readFileSync(join(__dirname, "fixtures", flavor, name), "utf8");
  return JSON.parse(raw) as T;
}

const accountFixture = fixture<WireAccount>("mastodon", "account.json");
const meFixture = fixture<MeDetailed>("misskey", "user.json");
const driveFileFixture = fixture<DriveFile>("misskey", "drive-file.json");

const PNG = () => new File(["png-bytes"], "me.png", { type: "image/png" });

// --- Mastodon ---------------------------------------------------------------

interface MastoCall {
  method: string;
  path: string;
  formData?: FormData;
}

function stubMastoClient(): { client: MastoClient; calls: MastoCall[] } {
  const calls: MastoCall[] = [];
  const ok = (data: unknown): Promise<RequestResult<never>> =>
    Promise.resolve({ status: 200, data: data as never, headers: new Headers() });
  const client: MastoClient = {
    origin: "https://mastodon.example",
    token: "t",
    get: () => ok(undefined),
    post: (_path, body) => ok(body),
    put: (_path, body) => ok(body),
    patch: (_path, body) => ok(body),
    delete: (_path, body) => ok(body),
    postForm: (_path, form) => ok(form),
    postFormData: (_path, form) => ok(form),
    // The credential-image transport: multipart PATCH (never a JSON body).
    patchFormData: (path: string, formData: FormData) => {
      calls.push({ method: "PATCH", path, formData });
      const avatar = "https://mastodon.example/me.png";
      return ok({ ...accountFixture, avatar, avatar_static: avatar });
    },
  };
  return { client, calls };
}

describe("Mastodon — update_credentials multipart (avatar/header)", () => {
  it("sends the avatar file as the `avatar` multipart field, PATCH, no JSON body", async () => {
    const { client, calls } = stubMastoClient();
    const updated = await createMastodonBackend(client).uploadProfileImage!("avatar", PNG());

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].path).toBe("/api/v1/accounts/update_credentials");
    const form = calls[0].formData!;
    expect((form.get("avatar") as File).name).toBe("me.png");
    // The banner key is never invented for an avatar patch.
    expect(form.get("header")).toBeNull();
    // The server answers with the credential account; its new URL is what
    // the UI shows (no optimistic thumbnail).
    expect(updated.avatarUrl).toBe("https://mastodon.example/me.png");
  });

  it("sends the banner file as the `header` multipart field", async () => {
    const { client, calls } = stubMastoClient();
    await createMastodonBackend(client).uploadProfileImage!("banner", PNG());
    const form = calls[0].formData!;
    expect((form.get("header") as File).name).toBe("me.png");
    expect(form.get("avatar")).toBeNull();
  });
});

// --- Misskey ----------------------------------------------------------------

interface MisskeyCall {
  endpoint: string;
  params: Record<string, unknown>;
}

function stubMisskeyTransport(): { transport: MisskeyTransport; calls: MisskeyCall[] } {
  const calls: MisskeyCall[] = [];
  return {
    calls,
    transport: {
      call<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ endpoint, params });
        return Promise.resolve(meFixture as T);
      },
      upload<T>(_file: File, opts: Record<string, unknown> = {}): Promise<T> {
        calls.push({ endpoint: "drive/files/create", params: { ...opts } });
        return Promise.resolve(driveFileFixture as T);
      },
    },
  };
}

describe("Misskey — Drive upload then i/update with the file id", () => {
  it("uploads the avatar, then sets avatarId to the returned Drive file id", async () => {
    const { transport, calls } = stubMisskeyTransport();
    const updated = await createMisskeyBackend(transport).uploadProfileImage!("avatar", PNG());

    expect(calls.map((c) => c.endpoint)).toEqual(["drive/files/create", "i/update"]);
    expect(calls[1].params).toEqual({ avatarId: driveFileFixture.id });
    // No banner id is written by an avatar upload.
    expect(calls[1].params.bannerId).toBeUndefined();
    expect(updated.username).toBe(meFixture.username);
  });

  it("uploads the banner, then sets bannerId", async () => {
    const { transport, calls } = stubMisskeyTransport();
    await createMisskeyBackend(transport).uploadProfileImage!("banner", PNG());
    expect(calls.map((c) => c.endpoint)).toEqual(["drive/files/create", "i/update"]);
    expect(calls[1].params).toEqual({ bannerId: driveFileFixture.id });
  });
});

// --- Availability -----------------------------------------------------------

describe("both families expose the profile-image path (no fake disable)", () => {
  it("Mastodon and Misskey backends both implement uploadProfileImage", () => {
    const { client } = stubMastoClient();
    const { transport } = stubMisskeyTransport();
    expect(typeof createMastodonBackend(client).uploadProfileImage).toBe("function");
    expect(typeof createMisskeyBackend(transport).uploadProfileImage).toBe("function");
  });
});
