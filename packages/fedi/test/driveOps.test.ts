// P6.6 slice 1: driveOps — pool concurrency/order/failure, folder
// delete order, mosaic collection rules. Pure.

import { collectMosaic, planFolderDelete, runPool } from "../src/core/driveOps";
import type { Post } from "../src/core/models";

function post(over: Partial<Post> = {}): Post {
  return {
    id: "n1",
    createdAt: "2026-10-26T12:00:00.000Z",
    author: null as never,
    content: { mfm: "", plain: "" },
    cw: null,
    visibility: "public",
    localOnly: false,
    media: [],
    ...over,
  } as Post;
}

function image(id: string, sensitive = false) {
  return {
    id,
    kind: "image",
    mimeType: "image/png",
    url: `https://mk.example/${id}.png`,
    previewUrl: null,
    name: `${id}.png`,
    description: null,
    blurhash: null,
    isSensitive: sensitive,
    size: 10,
    md5: null,
    meta: null,
    createdAt: null,
    folderId: null,
    userId: "u1",
  } as const;
}

describe("runPool", () => {
  it("runs at most `concurrency` in flight and keeps input order", async () => {
    let live = 0;
    let peak = 0;
    const worker = async (n: number) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise(r => setTimeout(r, 5));
      live--;
      return n;
    };
    const out = await runPool([1, 2, 3, 4, 5], worker, { concurrency: 2 });
    expect(peak).toBeLessThanOrEqual(2);
    expect(out.map(r => r.item)).toEqual([1, 2, 3, 4, 5]);
    expect(out.every(r => r.ok)).toBe(true);
  });

  it("captures per-item failures without rejecting", async () => {
    const out = await runPool(["a", "b", "c"], async item => {
      if (item === "b") throw new Error("boom");
    }, { concurrency: 4 });
    expect(out).toEqual([
      { item: "a", ok: true },
      { item: "b", ok: false, error: expect.any(Error) },
      { item: "c", ok: true },
    ]);
  });
});

describe("planFolderDelete", () => {
  it("orders files, then subtrees depth-first, then the folder", () => {
    const steps = planFolderDelete({
      id: "root",
      files: ["f1"],
      children: [
        { id: "sub", files: ["f2", "f3"], children: [{ id: "deep", files: [], children: [] }] },
      ],
    });
    expect(steps).toEqual([
      { kind: "file", id: "f1" },
      { kind: "file", id: "f2" },
      { kind: "file", id: "f3" },
      { kind: "folder", id: "deep" },
      { kind: "folder", id: "sub" },
      { kind: "folder", id: "root" },
    ]);
  });

  it("empty folder deletes just itself", () => {
    expect(planFolderDelete({ id: "e", files: [], children: [] })).toEqual([{ kind: "folder", id: "e" }]);
  });
});

describe("collectMosaic", () => {
  it("takes up to 4 image urls in order, skipping video", () => {
    const video = { ...image("v"), kind: "video", mimeType: "video/mp4" } as never;
    const posts = [
      post({ media: [video, image("a")] as never }),
      post({ media: [image("b"), image("c"), image("d"), image("e")] as never }),
    ];
    expect(collectMosaic(posts).map(m => m.url)).toEqual([
      "https://mk.example/a.png",
      "https://mk.example/b.png",
      "https://mk.example/c.png",
      "https://mk.example/d.png",
    ]);
  });

  it("dedupes, keeps the sensitive flag, empty for text-only", () => {
    const posts = [
      post({ media: [image("a", true), image("a")] as never }),
      post({ media: [] }),
    ];
    expect(collectMosaic(posts)).toEqual([{ url: "https://mk.example/a.png", isSensitive: true }]);
    expect(collectMosaic([post()])).toEqual([]);
  });
});
