// Clickstone §1.12 Misskey-family announcements: `announcements` (public,
// paged) + `i/read-announcement` (auth, `write:account`). Pins the request
// shapes and the packed-row adaptation; transport stubbed — no network.
//
// The slice brief named `announcements/dismiss`; the verified checkouts
// (Misskey 72d760f6bd, Sharkey, Catodon) all expose `i/read-announcement`
// with `{announcementId}` and no `announcements/dismiss`. The domain verb
// stays `dismiss`; the wire call is the endpoint the reference client's
// announcements page/dialog calls.

import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import { buildCapabilities } from "../src/core/detect";
import type { PackedAnnouncement } from "../src/misskey/announcements";

interface RecordedCall {
  endpoint: string;
  params: Record<string, unknown>;
}

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

// Shape of `AnnouncementEntityService.pack` (backend src/core/entities/
// AnnouncementEntityService.ts), trimmed to what the domain model keeps.
const packed: PackedAnnouncement = {
  id: "9abcann0000000001",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: null,
  title: "Maintenance window",
  text: "**Server** restarts at 03:00 UTC.",
  imageUrl: "https://mk.example/files/notice.png",
  icon: "warning",
  needConfirmationToRead: true,
  isRead: false,
};

describe("MisskeyBackend announcements", () => {
  it("lists through the public `announcements` endpoint, paged both ways", async () => {
    const { transport, calls } = stubTransport(() => [packed]);
    const backend = createMisskeyBackend(transport);
    const rows = await backend.announcements!.list({ limit: 5 });

    expect(calls[0]).toEqual({
      endpoint: "announcements",
      params: { limit: 5 },
    });
    expect(rows).toHaveLength(1);

    await backend.announcements!.list({
      cursor: JSON.stringify({ untilId: "u1" }) as never,
      limit: 2,
    });
    expect(calls[1].params).toEqual({ limit: 2, untilId: "u1" });

    // Pull-to-refresh can ask for rows newer than the newest held one.
    await backend.announcements!.list({
      cursor: JSON.stringify({ sinceId: "s1" }) as never,
    });
    expect(calls[2].params).toEqual({ limit: 20, sinceId: "s1" });
  });

  it("adapts the packed row: title, MFM body, severity, image, read flag", async () => {
    const { transport } = stubTransport(() => [packed]);
    const [row] = await createMisskeyBackend(transport).announcements!.list();

    expect(row).toMatchObject({
      id: "9abcann0000000001",
      title: "Maintenance window",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: null,
      imageUrl: "https://mk.example/files/notice.png",
      icon: "warning",
      needConfirmationToRead: true,
      isRead: false,
      // Mastodon-only fields are absent, never invented.
      startsAt: null,
      endsAt: null,
      allDay: false,
    });
    // Misskey announcement text IS MFM: the source is kept for the one
    // allow-listed AST parser; the plain projection is the same source.
    expect(row.content.mfm).toBe("**Server** restarts at 03:00 UTC.");
    expect(row.content.plain).toBe("**Server** restarts at 03:00 UTC.");
    expect(row.content.html).toBeUndefined();
  });

  it("keeps an unreported read flag null and unknown severity/image off the model", async () => {
    const { transport } = stubTransport(() => [
      {
        id: "a2",
        createdAt: "2026-10-19T00:00:00.000Z",
        title: "",
        text: "",
        imageUrl: null,
        icon: "megaphone",
        isRead: undefined,
      },
    ]);
    const [row] = await createMisskeyBackend(transport).announcements!.list();

    expect(row.title).toBeNull();
    expect(row.icon).toBeNull();
    expect(row.imageUrl).toBeNull();
    expect(row.isRead).toBeNull();
    expect(row.needConfirmationToRead).toBe(false);
    expect(row.content.mfm).toBeUndefined();
  });

  it("dismiss marks one announcement read through i/read-announcement", async () => {
    const { transport, calls } = stubTransport(() => undefined);
    const backend = createMisskeyBackend(transport);

    await backend.announcements!.dismiss!("9abcann0000000001");

    expect(calls).toEqual([
      {
        endpoint: "i/read-announcement",
        params: { announcementId: "9abcann0000000001" },
      },
    ]);
  });

  it("never sends isActive or unknown fields (the server default is active only)", async () => {
    const { transport, calls } = stubTransport(() => []);
    await createMisskeyBackend(transport).announcements!.list({ limit: 1 });
    expect(Object.keys(calls[0].params).sort()).toEqual(["limit"]);
  });
});

describe("announcements capability", () => {
  it("is supported on the Misskey family and Mastodon family, absent on Pinetree", () => {
    expect(buildCapabilities("misskey").announcements).toBe("supported");
    expect(buildCapabilities("sharkey").announcements).toBe("supported");
    // Catodon's endpoint list exports `announcements` + `i/read-announcement`.
    expect(buildCapabilities("catodon").announcements).toBe("supported");
    // Verified absence: Pinetree has no announcement endpoints at all.
    expect(buildCapabilities("pinetree").announcements).toBe("unsupported");
    // Mastodon family: `/api/v1/announcements` on vanilla + Akkoma/Pleroma.
    expect(buildCapabilities("mastodon").announcements).toBe("supported");
    expect(buildCapabilities("akkoma").announcements).toBe("supported");
    expect(buildCapabilities("pleroma").announcements).toBe("supported");
    // An undetected flavor unlocks nothing.
    expect(buildCapabilities("unknown").announcements).toBe("unknown");
  });

  it("the Misskey backend always exposes the module for the UI to gate", () => {
    const { transport } = stubTransport(() => []);
    const backend = createMisskeyBackend(transport);
    expect(backend.announcements).toBeDefined();
    expect(typeof backend.announcements!.dismiss).toBe("function");
    expect(backend.capabilities.announcements).toBe("supported");
  });
});
