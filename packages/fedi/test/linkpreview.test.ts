// E9 honest client unfurl: single-flight per URL + memory cache —
// N mounted cards for one URL cost one fetch, never a fetch storm.
import {
  clearPreviewCache,
  extractLinkPreview,
  fetchLinkPreview,
  hostOf,
  type PreviewFetch,
} from "../src/api/linkpreview";

const PAGE = "https://example.social/article";
const HTML = [
  "<!doctype html><html><head>",
  '<meta property="og:title" content="An article">',
  '<meta property="og:description" content="Read all about it.">',
  '<meta property="og:image" content="/cover.png">',
  "</head><body>hi</body></html>",
].join("");

function ok(html: string): Response {
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
}

/** Deferred fetch stub: holds the in-flight window open on demand. */
function deferred() {
  let resolve!: (r: Response) => void;
  let reject!: (e: unknown) => void;
  const gate = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const calls: string[] = [];
  const fetchImpl: PreviewFetch = url => {
    calls.push(url);
    return gate;
  };
  return { calls, fetchImpl, resolve, reject };
}

beforeEach(() => {
  clearPreviewCache();
});

describe("fetchLinkPreview single-flight (E9)", () => {
  it("concurrent callers share one in-flight fetch", async () => {
    const d = deferred();
    const p1 = fetchLinkPreview(PAGE, { fetchImpl: d.fetchImpl, proxy: null });
    const p2 = fetchLinkPreview(PAGE, { fetchImpl: d.fetchImpl, proxy: null });
    const p3 = fetchLinkPreview(PAGE, { fetchImpl: d.fetchImpl, proxy: null });
    // All three joined before the fetch settled: a single underlying call.
    expect(d.calls).toHaveLength(1);
    d.resolve(ok(HTML));
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(d.calls).toHaveLength(1);
    expect(r1).toEqual({
      title: "An article",
      description: "Read all about it.",
      siteName: undefined,
      image: "https://example.social/cover.png",
      icon: null,
    });
    expect(r2).toBe(r1);
    expect(r3).toBe(r1);
  });

  it("settled results come from cache: a second view costs no fetch", async () => {
    let n = 0;
    const fetchImpl: PreviewFetch = async () => {
      n += 1;
      return ok(HTML);
    };
    const first = await fetchLinkPreview(PAGE, { fetchImpl, proxy: null });
    const second = await fetchLinkPreview(PAGE, { fetchImpl, proxy: null });
    expect(n).toBe(1);
    expect(second).toBe(first);
  });

  it("misses are cached too: a failed fetch never retries itself", async () => {
    let n = 0;
    const fetchImpl: PreviewFetch = async () => {
      n += 1;
      throw new Error("down");
    };
    const url = "https://example.social/down";
    await expect(fetchLinkPreview(url, { fetchImpl, proxy: null })).resolves.toBeNull();
    await expect(fetchLinkPreview(url, { fetchImpl, proxy: null })).resolves.toBeNull();
    expect(n).toBe(1);
  });

  it("different URLs fetch independently", async () => {
    let n = 0;
    const fetchImpl: PreviewFetch = async () => {
      n += 1;
      return ok(HTML);
    };
    await fetchLinkPreview(`${PAGE}-1`, { fetchImpl, proxy: null });
    await fetchLinkPreview(`${PAGE}-2`, { fetchImpl, proxy: null });
    expect(n).toBe(2);
  });

  it("clearPreviewCache resets both cache and in-flight joins", async () => {
    let n = 0;
    const fetchImpl: PreviewFetch = async () => {
      n += 1;
      return ok(HTML);
    };
    await fetchLinkPreview(PAGE, { fetchImpl, proxy: null });
    clearPreviewCache();
    await fetchLinkPreview(PAGE, { fetchImpl, proxy: null });
    expect(n).toBe(2);
  });

  it("non-http URLs never fetch", async () => {
    const fetchImpl: PreviewFetch = async () => {
      throw new Error("must not fetch");
    };
    await expect(
      fetchLinkPreview("notaurl", { fetchImpl, proxy: null }),
    ).resolves.toBeNull();
  });

  it("extractLinkPreview degrades to null without tags; hostOf strips to host", () => {
    expect(extractLinkPreview("<html><body>no tags</body></html>", PAGE)).toBeNull();
    expect(hostOf(PAGE)).toBe("example.social");
  });
});
