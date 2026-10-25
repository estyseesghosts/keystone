// X2.4 link-preview policy: no fetch for non-public pages, policy-checked
// manual redirects, stream-capped bodies, and a timeout that covers the
// body. Every policy test fails on the old transport (unconditional fetch
// + auto-follow + unbounded text()).
import {
  clearPreviewCache,
  extractLinkPreview,
  fetchLinkPreview,
  type PreviewFetch,
} from "../src/api/linkpreview";

const HEAD = [
  "<!doctype html><html><head>",
  '<meta property="og:title" content="A public article">',
  '<meta property="og:description" content="Read all about it.">',
  "</head><body>hi</body></html>",
].join("");

function ok(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "Content-Type": "text/html" } });
}

function redirectTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}

beforeEach(() => {
  clearPreviewCache();
});

describe("fetchLinkPreview outbound policy (X2.4)", () => {
  it("never fetches private/loopback/non-https pages (zero network)", async () => {
    const calls: string[] = [];
    const fetchImpl: PreviewFetch = async url => {
      calls.push(url);
      throw new Error("must not fetch");
    };
    for (const page of [
      "http://192.168.1.1/x",
      "https://192.168.1.1/x",
      "https://10.0.0.5/p",
      "https://127.1/",
      "http://[::1]/",
      "http://2130706433/",
      "http://localhost/x",
      "https://foo.local/y",
      "http://example.com/article",
    ]) {
      await expect(
        fetchLinkPreview(page, { fetchImpl, proxy: null }),
      ).resolves.toBeNull();
      // The miss is cached: a second view costs no fetch either.
      await expect(
        fetchLinkPreview(page, { fetchImpl, proxy: null }),
      ).resolves.toBeNull();
    }
    expect(calls).toEqual([]);
  });

  it("allows http for public hosts only with the dev escape", async () => {
    const calls: string[] = [];
    const fetchImpl: PreviewFetch = async url => {
      calls.push(url);
      return ok(HEAD);
    };
    await expect(
      fetchLinkPreview("http://example.com/a", { fetchImpl, proxy: null, allowHttp: true }),
    ).resolves.toMatchObject({ title: "A public article" });
    expect(calls).toEqual(["http://example.com/a"]);
  });

  it("sends redirect-manual with no credentials and no token", async () => {
    const seen: RequestInit[] = [];
    const fetchImpl: PreviewFetch = async (_url, init) => {
      seen.push(init ?? {});
      return ok(HEAD);
    };
    await fetchLinkPreview("https://example.com/headers", { fetchImpl, proxy: null });
    expect(seen).toHaveLength(1);
    expect(seen[0].redirect).toBe("manual");
    expect(seen[0].credentials).toBe("omit");
    expect(JSON.stringify(seen[0])).not.toMatch(/authorization|bearer|token/i);
  });

  it("stops a redirect chain at a private hop without fetching it", async () => {
    const calls: string[] = [];
    const fetchImpl: PreviewFetch = async url => {
      calls.push(url);
      if (url === "https://public.example/a") return redirectTo("http://169.254.169.254/");
      throw new Error(`must not fetch ${url}`);
    };
    await expect(
      fetchLinkPreview("https://public.example/a", { fetchImpl, proxy: null }),
    ).resolves.toBeNull();
    expect(calls).toEqual(["https://public.example/a"]);
  });

  it("follows a redirect to a public host and parses the target", async () => {
    const calls: string[] = [];
    const fetchImpl: PreviewFetch = async url => {
      calls.push(url);
      if (url === "https://public.example/a") return redirectTo("https://cdn.example/b");
      if (url === "https://cdn.example/b") return ok(HEAD);
      throw new Error(`must not fetch ${url}`);
    };
    await expect(
      fetchLinkPreview("https://public.example/a", { fetchImpl, proxy: null }),
    ).resolves.toMatchObject({ title: "A public article" });
    expect(calls).toEqual(["https://public.example/a", "https://cdn.example/b"]);
  });

  it("drops private and non-https preview assets, keeps relative ones", async () => {
    const html = [
      "<!doctype html><html><head>",
      '<meta property="og:title" content="Assets">',
      '<meta property="og:image" content="http://192.168.1.1/p.png">',
      "</head><body></body></html>",
    ].join("");
    const fetchImpl: PreviewFetch = async () => ok(html);
    const found = await fetchLinkPreview("https://public.example/assets", {
      fetchImpl,
      proxy: null,
    });
    expect(found).toMatchObject({ title: "Assets", image: null });

    const html2 = [
      "<!doctype html><html><head>",
      '<meta property="og:title" content="Local">',
      '<meta property="og:image" content="https://10.0.0.5/p.png">',
      '<link rel="icon" href="/icon.png">',
      "</head><body></body></html>",
    ].join("");
    const fetchImpl2: PreviewFetch = async () => ok(html2);
    const found2 = await fetchLinkPreview("https://public.example/assets2", {
      fetchImpl: fetchImpl2,
      proxy: null,
    });
    // The LAN image is dropped; the relative icon resolves to the vetted page.
    expect(found2).toMatchObject({
      title: "Local",
      image: null,
      icon: "https://public.example/icon.png",
    });
  });

  it("caps the streamed body: a huge page costs bounded reads", async () => {
    const prefix = [
      "<!doctype html><html><head>",
      '<meta property="og:title" content="Big page">',
      "</head><body>",
    ].join("");
    const enc = new TextEncoder();
    const pre = enc.encode(prefix);
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(pre);
          return;
        }
        if (pulls > 11) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(64 * 1024).fill(97));
      },
    });
    const fetchImpl: PreviewFetch = async () =>
      new Response(stream, { status: 200 });
    const found = await fetchLinkPreview("https://public.example/big", {
      fetchImpl,
      proxy: null,
    });
    expect(found).toMatchObject({ title: "Big page" });
    // 11 chunk pulls would read the whole 640 KiB; the 256 KiB cap stops early.
    expect(pulls).toBeLessThanOrEqual(7);
  });

  it("a stalled body resolves null inside the deadline", async () => {
    const fetchImpl: PreviewFetch = async () =>
      new Response(new ReadableStream<Uint8Array>({ pull() {} }), { status: 200 });
    const startedAt = Date.now();
    await expect(
      fetchLinkPreview("https://public.example/stall", {
        fetchImpl,
        proxy: null,
        timeoutMs: 60,
      }),
    ).resolves.toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  it("follows the proxy leg only through policy-passing hops", async () => {
    const calls: string[] = [];
    const fetchImpl: PreviewFetch = async url => {
      calls.push(url);
      if (url === "https://public.example/via-proxy") throw new Error("CORS");
      if (url.startsWith("https://proxy.example/")) {
        return redirectTo("https://cdn.example/p");
      }
      if (url === "https://cdn.example/p") return ok(HEAD);
      throw new Error(`must not fetch ${url}`);
    };
    await expect(
      fetchLinkPreview("https://public.example/via-proxy", {
        fetchImpl,
        proxy: "https://proxy.example/?u={url}",
      }),
    ).resolves.toMatchObject({ title: "A public article" });
    expect(calls).toEqual([
      "https://public.example/via-proxy",
      "https://proxy.example/?u=https%3A%2F%2Fpublic.example%2Fvia-proxy",
      "https://cdn.example/p",
    ]);
  });
});

describe("extractLinkPreview asset policy (X2.4)", () => {
  const PAGE = "https://public.example/article";
  const htmlWith = (image: string): string =>
    [
      "<!doctype html><html><head>",
      '<meta property="og:title" content="T">',
      `<meta property="og:image" content="${image}">`,
      "</head><body></body></html>",
    ].join("");

  it("drops http assets by default, keeps them with the dev escape", () => {
    expect(
      extractLinkPreview(htmlWith("http://public.example/p.png"), PAGE),
    ).toMatchObject({ image: null });
    expect(
      extractLinkPreview(htmlWith("http://public.example/p.png"), PAGE, { allowHttp: true }),
    ).toMatchObject({ image: "http://public.example/p.png" });
  });

  it("drops https assets on private hosts", () => {
    expect(
      extractLinkPreview(htmlWith("https://192.168.1.1/p.png"), PAGE),
    ).toMatchObject({ image: null });
    expect(
      extractLinkPreview(htmlWith("/cover.png"), PAGE),
    ).toMatchObject({ image: "https://public.example/cover.png" });
  });
});
