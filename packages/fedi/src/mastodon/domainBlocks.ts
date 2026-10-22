// Personal domain blocks (clickstone §1.4), Mastodon family.
//
// Endpoint contract (verified against the Mastodon checkout — source paths
// in the session log, not here):
// - `GET    /api/v1/domain_blocks`         → string[]  (Link-paged, 100/page)
// - `POST   /api/v1/domain_blocks`         `{domain}`
// - `DELETE /api/v1/domain_blocks?domain=` → 200/204
//
// These are the ACCOUNT's own blocks (`DomainBlocksController#show` reads
// `current_account.domain_blocks`), never `/api/v1/admin/domain_blocks`:
// the admin surface needs `admin:write` and affects the whole instance, so
// it must not be reachable from a personal settings row.
//
// The server normalizes the domain itself (`block_domain!`); the client
// still sends a bare host (`normalizeDomainBlock` in core/backend trims the
// input) because the wire field is the stored domain string, and the tag is
// removed by that exact string.
//
// Akkoma/Pleroma serve the same trio (`DomainBlockController`), so this
// module is defined for every Mastodon-family flavor; a fork that 404s
// reads as absent at the caller (the UI disables the row with a reason).

import { FediError } from "../core/errors";
import type { QueryValue } from "./client";
import type { MastoClient } from "./client";
import type { Continuation } from "./pagination";
import { nextContinuation, withCursors } from "./pagination";

/** Server page cap (`BLOCK_LIMIT`). */
const DOMAIN_BLOCKS_PAGE_LIMIT = 100;

export interface DomainBlockPageOptions {
  limit?: number;
  continuation?: Continuation | null;
}

export interface DomainBlockPage {
  domains: string[];
  continuation: Continuation | null;
  /** Contract §5: no next link OR an empty page. */
  end: boolean;
}

/** `GET /api/v1/domain_blocks` — the account's blocked domains. A
 * non-array body is a shape error, never an empty list (an empty list
 * claims "you block nothing", which is a fact only the server may state). */
export async function fetchDomainBlocksPage(
  client: MastoClient,
  opts: DomainBlockPageOptions = {},
): Promise<DomainBlockPage> {
  const path =
    opts.continuation?.kind === "url" ? opts.continuation.url : "/api/v1/domain_blocks";
  let query: Record<string, QueryValue> = {};
  if (opts.continuation?.kind === "cursors") {
    query = withCursors({}, opts.continuation.cursors);
  } else if (opts.continuation?.kind !== "url") {
    query = { limit: opts.limit ?? DOMAIN_BLOCKS_PAGE_LIMIT };
  }
  const res = await client.get<unknown>(path, query);
  if (!Array.isArray(res.data)) {
    throw new FediError(
      `Expected a domain-block list (HTTP ${res.status}).`,
      "errors.shape.expectedList",
      { kind: "domainBlock", status: res.status },
    );
  }
  const domains = (res.data as unknown[]).filter(
    (d): d is string => typeof d === "string" && d.length > 0,
  );
  const continuation = nextContinuation(res.headers, client.origin);
  return {
    domains,
    continuation,
    end: continuation === null || domains.length === 0,
  };
}

/** `POST /api/v1/domain_blocks` with the bare host. */
export async function blockDomain(client: MastoClient, domain: string): Promise<void> {
  await client.post("/api/v1/domain_blocks", { domain });
}

/**
 * `DELETE /api/v1/domain_blocks` with the domain in the QUERY, matching the
 * reference web client (`api().delete('/api/v1/domain_blocks', {params:
 * {domain}})`): Rails reads `params[:domain]` for both the vanilla and the
 * Akkoma controller, and a query string avoids body-parsing differences on
 * forks. The domain never goes in the path.
 */
export async function unblockDomain(client: MastoClient, domain: string): Promise<void> {
  await client.delete("/api/v1/domain_blocks", undefined, { query: { domain } });
}
