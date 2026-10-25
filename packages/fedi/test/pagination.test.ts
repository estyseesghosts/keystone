// `parseLinkHeader` (repair X4.4 finding 18): regex entry parsing with
// no comma split, plus the cross-origin fallback the Akkoma proxy setup
// exercises through `nextContinuation`/`prevContinuation`.
//
// Jest port: `describe/it/expect` are globals (no vitest import).
import {
  cursorsFromUrl,
  nextContinuation,
  parseLinkHeader,
  prevContinuation,
} from "../src/mastodon/pagination";

function headers(link: string | null): Headers {
  return new Headers(link === null ? {} : { Link: link });
}

const ORIGIN = "https://mastodon.example";

describe("parseLinkHeader", () => {
  it("parses next and prev from a standard two-entry header", () => {
    const out = parseLinkHeader(
      '<https://mastodon.example/api/v1/timelines/home?max_id=109>; rel="next", <https://mastodon.example/api/v1/timelines/home?min_id=120>; rel="prev"',
    );
    expect(out.next).toBe("https://mastodon.example/api/v1/timelines/home?max_id=109");
    expect(out.prev).toBe("https://mastodon.example/api/v1/timelines/home?min_id=120");
  });

  it("does not cut an href containing a raw comma", () => {
    // The old comma split cut this entry in half and lost the next link.
    const out = parseLinkHeader(
      '<https://mastodon.example/api/v1/timelines/home?max_id=109&tag=a,b>; rel="next"',
    );
    expect(out.next).toBe("https://mastodon.example/api/v1/timelines/home?max_id=109&tag=a,b");
  });

  it("keeps commas inside quoted params on the same entry", () => {
    const out = parseLinkHeader(
      '<https://mastodon.example/api/v1/timelines/home?max_id=1>; rel="next"; title="a,b", <https://mastodon.example/api/v1/timelines/home?min_id=2>; rel="prev"',
    );
    expect(out.next).toBe("https://mastodon.example/api/v1/timelines/home?max_id=1");
    expect(out.prev).toBe("https://mastodon.example/api/v1/timelines/home?min_id=2");
  });

  it("reads a bare (unquoted) rel among other params", () => {
    const out = parseLinkHeader(
      '<https://mastodon.example/api/v1/timelines/home?max_id=7>; title="x"; rel=next',
    );
    expect(out.next).toBe("https://mastodon.example/api/v1/timelines/home?max_id=7");
  });

  it("skips entries with no rel", () => {
    const out = parseLinkHeader(
      '<https://mastodon.example/api/v1/timelines/home?max_id=7>; title="x", <https://mastodon.example/api/v1/timelines/home?min_id=9>; rel="prev"',
    );
    expect(out.next).toBeNull();
    expect(out.prev).toBe("https://mastodon.example/api/v1/timelines/home?min_id=9");
  });

  it("keeps relative hrefs verbatim for the origin check downstream", () => {
    const out = parseLinkHeader('</api/v1/timelines/home?max_id=42>; rel="next"');
    expect(out.next).toBe("/api/v1/timelines/home?max_id=42");
  });

  it("answers nulls for empty/missing headers, never throws", () => {
    expect(parseLinkHeader(null)).toEqual({ next: null, prev: null });
    expect(parseLinkHeader(undefined)).toEqual({ next: null, prev: null });
    expect(parseLinkHeader("")).toEqual({ next: null, prev: null });
    expect(parseLinkHeader("not a link header")).toEqual({ next: null, prev: null });
  });

  it("keeps the first next/prev when the server repeats a relation", () => {
    const out = parseLinkHeader(
      '<https://a.example/?max_id=1>; rel="next", <https://a.example/?max_id=2>; rel="next"',
    );
    expect(out.next).toBe("https://a.example/?max_id=1");
  });
});

describe("continuation fallback (finding 10 fixture shape)", () => {
  it("follows a same-origin next URL verbatim", () => {
    const cont = nextContinuation(
      headers('<https://mastodon.example/api/v1/timelines/list/1?max_id=99>; rel="next"'),
      ORIGIN,
    );
    expect(cont).toEqual({
      kind: "url",
      url: "https://mastodon.example/api/v1/timelines/list/1?max_id=99",
    });
  });

  it("rebuilds on the session origin from a cross-origin next URL's cursors", () => {
    // Akkoma behind a proxy advertises its configured base_url, which is
    // cross-origin here: only the cursor params carry over, so the token
    // never leaves the session origin.
    const cont = nextContinuation(
      headers('<https://internal:4000/api/v1/timelines/list/1?limit=20&max_id=99>; rel="next"'),
      ORIGIN,
    );
    expect(cont).toEqual({ kind: "cursors", cursors: { max_id: "99", limit: 20 } });
  });

  it("ends the feed on a cross-origin next URL with no recognized cursor", () => {
    const cont = nextContinuation(
      headers('<https://other.example/feed?page=3>; rel="next"'),
      ORIGIN,
    );
    expect(cont).toBeNull();
  });

  it("resolves cursorsFromUrl for id and offset cursors", () => {
    expect(cursorsFromUrl("https://x.example/?max_id=9&since_id=1&limit=20")).toEqual({
      max_id: "9",
      since_id: "1",
      limit: 20,
    });
    expect(cursorsFromUrl("https://x.example/api/v2/search?q=a&type=statuses&offset=2")).toEqual({
      offset: 2,
    });
    expect(cursorsFromUrl("not a url")).toEqual({});
  });

  it("prevContinuation recognizes the v2 search offset cursor", () => {
    const cont = prevContinuation(
      headers(
        '<https://search.example/api/v2/search?q=cat&type=statuses&offset=1>; rel="prev"',
      ),
      ORIGIN,
    );
    expect(cont).toEqual({ kind: "cursors", cursors: { offset: 1 } });
  });

  it("answers null when the Link header is absent", () => {
    expect(nextContinuation(headers(null), ORIGIN)).toBeNull();
    expect(prevContinuation(headers(null), ORIGIN)).toBeNull();
  });
});
