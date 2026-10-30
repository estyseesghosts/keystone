// P6.5 Pages slice 1: wire module (adapt/serialize/endpoints/errors)
// + backend wiring (flavor gating). Transports stubbed; fixtures are
// synthesised (manifest marks them — never live proof).

import {readFileSync} from "node:fs";
import {join} from "node:path";

import {ApiError} from "../src/core/errors";
import type {PageBlock} from "../src/core/models";
import {
  adaptPage,
  adaptPageBlock,
  createPage,
  deletePage,
  featuredPages,
  likedPages,
  likePage,
  myPages,
  pagesByUser,
  pinPage,
  serializePageBlock,
  showPage,
  unlikePage,
  updatePage,
} from "../src/misskey/pages";
import {createMisskeyBackend, type MisskeyTransport} from "../src/misskey/backend";
import {createMastodonBackend} from "../src/mastodon/backend";
import type {WireCall} from "../src/misskey/client";

const ORIGIN = "https://misskey.example";

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as T;
}

function stubCall(
  respond: (endpoint: string, params: Record<string, unknown>) => unknown,
): {call: WireCall; calls: Array<{endpoint: string; params: Record<string, unknown>}>} {
  const calls: Array<{endpoint: string; params: Record<string, unknown>}> = [];
  const call = ((endpoint: string, params: Record<string, unknown> = {}) => {
    calls.push({endpoint, params});
    return Promise.resolve().then(() => respond(endpoint, params));
  }) as WireCall;
  return {call, calls};
}

const full = () => fixture<Record<string, unknown>>("misskey/pages-full.json");

describe("adaptPage", () => {
  it("adapts every block kind, three-deep sections, legacy + unknown preserved", () => {
    const page = adaptPage(full(), ORIGIN);
    expect(page.id).toBe("9pagesfull00001");
    expect(page.author.username).toBe("sk");
    expect(page.font).toBe("serif");
    expect(page.hideTitleWhenPinned).toBe(true);
    expect(page.likedCount).toBe(3);
    expect(page.isLiked).toBe(true);
    expect(page.hasLegacyScript).toBe(true);
    expect(page.url).toBe("https://misskey.example/@sk/pages/full-page");
    expect(page.eyeCatchingImageId).toBe("9drivefile0001");
    expect(page.eyeCatchingImage?.url).toBe("https://sharkey.example.com/files/cover.png");
    expect(page.attachedFiles.map(f => f.id)).toEqual(["9drivefile0001"]);
    const kinds = page.blocks.map(b => b.kind);
    expect(kinds).toEqual(["text", "section", "image", "note", "unknown", "unknown"]);
    const section = page.blocks[1];
    expect(section.kind).toBe("section");
    if (section.kind === "section") {
      expect(section.title).toBe("Part one");
      expect(section.children.map(c => c.kind)).toEqual(["text", "section"]);
      const deep = section.children[1];
      expect(deep.kind).toBe("section");
      if (deep.kind === "section") {
        expect(deep.children[0]).toMatchObject({kind: "text", id: "b2b1"});
      }
    }
    const legacy = page.blocks[4];
    expect(legacy).toMatchObject({kind: "unknown", type: "button"});
    expect((legacy as {raw: unknown}).raw).toMatchObject({title: "Legacy", action: "dialog"});
    expect(page.blocks[5]).toMatchObject({kind: "unknown", type: "future-widget"});
    const image = page.blocks[2];
    expect(image).toMatchObject({kind: "image", fileId: "9drivefile0001"});
    const note = page.blocks[3];
    expect(note).toMatchObject({kind: "note", noteId: "9note00000001", detailed: true});
  });

  it("tolerates a sparse pack (never throws)", () => {
    const page = adaptPage(fixture("misskey/pages-minimal.json"), ORIGIN);
    expect(page.title).toBe("Minimal");
    expect(page.summary).toBeNull();
    expect(page.font).toBe("sans-serif");
    expect(page.eyeCatchingImage).toBeNull();
    expect(page.attachedFiles).toEqual([]);
    expect(page.isLiked).toBeUndefined();
    expect(page.hasLegacyScript).toBe(false);
    expect(page.blocks[0]).toMatchObject({kind: "text", id: "m1", text: ""});
    expect(page.blocks[1]).toMatchObject({kind: "image", id: "m2", fileId: null});
    expect(page.blocks[2]).toMatchObject({kind: "note", id: "m3", noteId: null, detailed: false});
    expect(page.blocks[3]).toMatchObject({kind: "section", id: "m4", title: "", children: []});
  });

  it("degrades a missing author and tolerates a null pinnedPage", () => {
    const raw = full() as Record<string, unknown>;
    const user = {...(raw.user as Record<string, unknown>), pinnedPage: null};
    const page = adaptPage({...raw, user}, ORIGIN);
    expect(page.author.username).toBe("sk");
    const degraded = adaptPage({...raw, user: null, userId: "9sharkeyuser00001"}, ORIGIN);
    expect(degraded.author.id).toBe("9sharkeyuser00001");
    expect(degraded.url).toBe("/@/pages/full-page");
  });
});

describe("serializePageBlock", () => {
  it("round-trips every block kind byte-equal (incl. legacy + unknown)", () => {
    const page = adaptPage(full(), ORIGIN);
    const wire = page.blocks.map(serializePageBlock);
    expect(wire).toEqual((full().content as unknown[]));
  });

  it("drops nothing on unknown blocks", () => {
    const block: PageBlock = {kind: "unknown", id: "x", type: "weird", raw: {id: "x", type: "weird", z: [1]}};
    expect(serializePageBlock(block)).toEqual({id: "x", type: "weird", z: [1]});
  });
});

describe("page endpoints", () => {
  it("show resolves by id and by username+name", async () => {
    const {call, calls} = stubCall(() => full());
    await showPage(call, ORIGIN, {id: "9pagesfull00001"});
    expect(calls[0]).toEqual({endpoint: "pages/show", params: {pageId: "9pagesfull00001"}});
    await showPage(call, ORIGIN, {username: "sk", name: "full-page"});
    expect(calls[1]).toEqual({endpoint: "pages/show", params: {username: "sk", name: "full-page"}});
  });

  it("create sends script '' + variables [] and omits undefined", async () => {
    const {call, calls} = stubCall(() => full());
    await createPage(call, ORIGIN, {
      title: "T",
      name: "t",
      content: [{kind: "text", id: "a", text: "hi"}],
      variables: [],
    });
    expect(calls[0].endpoint).toBe("pages/create");
    expect(calls[0].params).toEqual({
      title: "T",
      name: "t",
      content: [{id: "a", type: "text", text: "hi"}],
      variables: [],
      script: "",
    });
  });

  it("update sends exactly the patch keys, never script/variables", async () => {
    const {call, calls} = stubCall(() => undefined);
    await updatePage(call, "p1", {title: "New"});
    expect(calls[0]).toEqual({endpoint: "pages/update", params: {pageId: "p1", title: "New"}});
    const patch = {title: "T", content: [{kind: "text" as const, id: "a", text: "hi"}], summary: null};
    await updatePage(call, "p1", patch);
    const params = calls[1].params;
    expect(Object.keys(params).sort()).toEqual(["content", "pageId", "summary", "title"]);
    expect(params).not.toHaveProperty("script");
    expect(params).not.toHaveProperty("variables");
    expect(params.summary).toBeNull();
  });

  it("delete/like/unlike/pin hit their endpoints", async () => {
    const {call, calls} = stubCall(() => undefined);
    await deletePage(call, "p1");
    await likePage(call, "p1");
    await unlikePage(call, "p1");
    await pinPage(call, "p1");
    await pinPage(call, null);
    expect(calls.map(c => [c.endpoint, c.params])).toEqual([
      ["pages/delete", {pageId: "p1"}],
      ["pages/like", {pageId: "p1"}],
      ["pages/unlike", {pageId: "p1"}],
      ["i/update", {pinnedPageId: "p1"}],
      ["i/update", {pinnedPageId: null}],
    ]);
  });

  it("featured maps, byUser pages, mine + liked adapt rows", async () => {
    const byUser = stubCall(() => [full()]);
    const pages = await pagesByUser(byUser.call, ORIGIN, "u1", {limit: 10});
    expect(byUser.calls[0].params).toMatchObject({userId: "u1", limit: 10});
    expect(pages.items[0].id).toBe("9pagesfull00001");
    const mine = stubCall(() => [full()]);
    expect((await myPages(mine.call, ORIGIN)).items).toHaveLength(1);
    const liked = stubCall(() => fixture("misskey/pages-likes.json"));
    const likes = await likedPages(liked.call, ORIGIN);
    expect(likes.items[0].id).toBe("9pagelike00001");
    expect(likes.items[0].page.title).toBe("Liked");
    expect(likes.items[0].page.isLiked).toBeUndefined();
    const feat = stubCall(() => [full()]);
    expect((await featuredPages(feat.call, ORIGIN)).map(p => p.id)).toEqual(["9pagesfull00001"]);
    expect(feat.calls[0]).toEqual({endpoint: "pages/featured", params: {}});
  });

  it("sends no key outside the §2 contract (Sharkey 400s otherwise)", async () => {
    const allowedCreate = new Set([
      "title", "name", "content", "variables", "script", "summary",
      "eyeCatchingImageId", "font", "alignCenter", "hideTitleWhenPinned",
    ]);
    const allowedUpdate = new Set([
      "pageId", "title", "name", "content", "summary",
      "eyeCatchingImageId", "font", "alignCenter", "hideTitleWhenPinned",
    ]);
    const {call, calls} = stubCall(() => full());
    await createPage(call, ORIGIN, {
      title: "T", name: "t",
      content: [{kind: "section", id: "s", title: "S", children: [{kind: "image", id: "i", fileId: "f"}]}],
      variables: [],
      summary: null, eyeCatchingImageId: "f", font: "serif", alignCenter: true, hideTitleWhenPinned: true,
    });
    for (const k of Object.keys(calls[0].params)) expect(allowedCreate.has(k)).toBe(true);
    await updatePage(call, "p1", {
      title: "T", name: "t",
      content: [{kind: "note", id: "n", noteId: "x", detailed: false}],
      summary: null, eyeCatchingImageId: null, font: "sans-serif", alignCenter: false, hideTitleWhenPinned: false,
    });
    for (const k of Object.keys(calls[1].params)) expect(allowedUpdate.has(k)).toBe(true);
  });
});

describe("page error mapping", () => {
  const cases: Array<[string, unknown, string]> = [
    ["NO_SUCH_PAGE string", new ApiError("x", 404, "NO_SUCH_PAGE"), "errors.pages.notFound"],
    ["NO_SUCH_PAGE uuid", new ApiError("x", 404, "222120c0-abc"), "errors.pages.notFound"],
    ["NAME_ALREADY_EXISTS string", new ApiError("x", 400, "NAME_ALREADY_EXISTS"), "errors.pages.nameTaken"],
    ["NAME_ALREADY_EXISTS uuid", new ApiError("x", 400, "4650348e-abc"), "errors.pages.nameTaken"],
    ["update collision uuid", new ApiError("x", 400, "2298a392-abc"), "errors.pages.nameTaken"],
    ["NO_SUCH_FILE string", new ApiError("x", 400, "NO_SUCH_FILE"), "errors.pages.fileMissing"],
    ["NO_SUCH_FILE uuid", new ApiError("x", 400, "b7b9748e-abc"), "errors.pages.fileMissing"],
    ["YOUR_PAGE", new ApiError("x", 400, "YOUR_PAGE"), "errors.pages.ownPage"],
    ["ALREADY_LIKED", new ApiError("x", 400, "ALREADY_LIKED"), "errors.pages.alreadyLiked"],
    ["NOT_LIKED", new ApiError("x", 400, "NOT_LIKED"), "errors.pages.notLiked"],
    ["ACCESS_DENIED string", new ApiError("x", 403, "ACCESS_DENIED"), "errors.pages.accessDenied"],
    ["ACCESS_DENIED uuid", new ApiError("x", 403, "d0017699-abc"), "errors.pages.accessDenied"],
  ];
  for (const [name, err, code] of cases) {
    it(`maps ${name}`, async () => {
      const {call} = stubCall(() => {
        throw err;
      });
      await expect(showPage(call, ORIGIN, {id: "p"})).rejects.toMatchObject({code});
    });
  }
  it("passes rate limits and unknown errors through untouched", async () => {
    const limited = new ApiError("slow", 429, "errors.network.apiError");
    const {call} = stubCall(() => {
      throw limited;
    });
    await expect(showPage(call, ORIGIN, {id: "p"})).rejects.toBe(limited);
    const weird = new ApiError("weird", 400, "SOME_FUTURE_CODE");
    const {call: call2} = stubCall(() => {
      throw weird;
    });
    await expect(showPage(call2, ORIGIN, {id: "p"})).rejects.toBe(weird);
  });
});

describe("adaptPageBlock", () => {
  it("never throws on junk", () => {
    for (const raw of [null, undefined, 42, "text", [], {type: 7}]) {
      const b = adaptPageBlock(raw);
      expect(b.kind).toBe("unknown");
    }
    expect(adaptPageBlock({id: "a", type: "text", text: 7})).toMatchObject({kind: "text", text: ""});
  });
});

function stubTransport(respond: (endpoint: string, params: Record<string, unknown>) => unknown) {
  return {
    call<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
      return Promise.resolve(respond(endpoint, params) as T);
    },
  };
}

describe("backend PagesApi wiring", () => {
  it("attaches pages with mine/liked on misskey + sharkey", () => {
    for (const flavor of ["misskey", "sharkey"] as const) {
      const backend = createMisskeyBackend(stubTransport(() => full()) as never, flavor);
      expect(backend.pages).toBeDefined();
      expect(typeof backend.pages!.mine).toBe("function");
      expect(typeof backend.pages!.liked).toBe("function");
      expect(typeof backend.pages!.pin).toBe("function");
    }
  });
  it("omits mine/liked on pinetree but keeps the rest", () => {
    const backend = createMisskeyBackend(stubTransport(() => full()) as never, "pinetree");
    expect(backend.pages).toBeDefined();
    expect(backend.pages!.mine).toBeUndefined();
    expect(backend.pages!.liked).toBeUndefined();
    expect(typeof backend.pages!.pin).toBe("function");
    expect(typeof backend.pages!.show).toBe("function");
  });
  it("mastodon has no pages module", () => {
    expect(createMastodonBackend().pages).toBeUndefined();
  });
});
