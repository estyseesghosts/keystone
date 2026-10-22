// DM inbox on the Mastodon transport (P6.2, clickstone §2.1).
//
// Endpoints (verified in the local checkouts — Mastodon
// `ConversationsController`, Akkoma `ConversationController`):
//   GET    /api/v1/conversations          Link-paged inbox
//   DELETE /api/v1/conversations/:id
//   POST   /api/v1/conversations/:id/read → the updated conversation
//
// There is deliberately NO get-one fetch: NEITHER server has a show
// route (Mastodon `resources :conversations, only: [:index, :destroy]`;
// Akkoma's `:show` lives under the `/api/v1/pleroma` namespace, a
// different shape, never called here). `fetchConversation` scans the
// inbox pages for the id instead — portable on both servers, terminating
// at the end of the list. A scan miss reads like any other absent row
// (the typed 404 the backend maps to the honest unavailable state).
//
// Error contract like `endpoints.ts`: these throw the RAW
// `MastoHttpError` — the backend's guarded client adapts it to the
// shared `ApiError` at the boundary. Row shape `{id, accounts[],
// last_status|null, unread}` is identical on both servers (Mastodon
// `REST::ConversationSerializer`, Akkoma `participation.json`).

import { ApiError } from "../core/errors";
import type { Conversation as CoreConversation } from "../core/backend";
import { adaptAccount, adaptStatus } from "./adapt";
import type { MastoClient, QueryValue } from "./client";
import { nextContinuation, withCursors } from "./pagination";
import type { Continuation } from "./pagination";
import type { Conversation as WireConversation } from "./wire";

const PAGE_LIMIT = 20; // server default; hard max 40 on both backends

/** Mastodon `REST::ConversationSerializer` / Akkoma `participation.json`
 * → core `Conversation`. Participants adapt like any other accounts; the
 * latest post adapts like any other status (or null when the server sent
 * none). `unread` is a real boolean on both servers, never derived. */
export function adaptConversation(raw: WireConversation): CoreConversation {
  return {
    id: String(raw.id ?? ""),
    accounts: Array.isArray(raw.accounts)
      ? raw.accounts.map(adaptAccount)
      : [],
    lastPost: raw.last_status ? adaptStatus(raw.last_status) : null,
    unread: raw.unread === true,
  };
}

export interface ConversationPageOptions {
  limit?: number;
  continuation?: Continuation | null;
}

export interface ConversationPage {
  items: CoreConversation[];
  continuation: Continuation | null;
  end: boolean;
}

/** One page of the DM inbox. Same paging contract as every other listing
 * (contract §5): the server's Link `rel="next"` (same-origin) continues,
 * a cross-origin next contributes only its cursor params, and `end` is a
 * missing next link OR an empty page — never `items.length < limit`. */
export async function fetchConversationsPage(
  client: MastoClient,
  opts: ConversationPageOptions = {},
): Promise<ConversationPage> {
  const path =
    opts.continuation?.kind === "url" ? opts.continuation.url : "/api/v1/conversations";
  const query: Record<string, QueryValue> =
    opts.continuation?.kind === "url"
      ? {}
      : opts.continuation?.kind === "cursors"
        ? withCursors({}, opts.continuation.cursors)
        : withCursors({}, { limit: opts.limit ?? PAGE_LIMIT });
  const res = await client.get<WireConversation[]>(path, query);
  if (!Array.isArray(res.data)) {
    throw new ApiError(
      `Conversations returned an unexpected response shape (HTTP ${res.status}).`,
      res.status,
      "errors.shape.expectedList",
      undefined,
      { kind: "conversation" },
    );
  }
  const items = res.data.map(adaptConversation);
  const continuation = nextContinuation(res.headers, client.origin);
  return {
    items,
    continuation,
    end: continuation === null || items.length === 0,
  };
}

/** One inbox row by id, via a terminating inbox scan (no show route on
 * either server — see the header). The scan stops at the end of the list
 * or when a server repeats a continuation (a buggy next link never spins
 * forever). Throws the typed 404 when no page holds the id. */
export async function fetchConversation(
  client: MastoClient,
  id: string,
): Promise<CoreConversation> {
  const seen = new Set<string>();
  let continuation: Continuation | null = null;
  for (;;) {
    const page: ConversationPage =
      continuation === null
        ? await fetchConversationsPage(client, {})
        : await fetchConversationsPage(client, { continuation });
    const hit = page.items.find((c) => c.id === id);
    if (hit) return hit;
    if (page.end || page.continuation === null) break;
    const signature = JSON.stringify(page.continuation);
    if (seen.has(signature)) break;
    seen.add(signature);
    continuation = page.continuation;
  }
  throw new ApiError(
    `No conversation found for id ${id}.`,
    404,
    "errors.shape.noConversationFound",
    undefined,
    { id },
  );
}

/** `DELETE /api/v1/conversations/:id` — both servers answer `{}`/empty.
 * The id is opaque: encoded, never parsed. */
export async function deleteConversation(client: MastoClient, id: string): Promise<void> {
  await client.delete(`/api/v1/conversations/${encodeURIComponent(id)}`);
}

/** `POST /api/v1/conversations/:id/read` — records the viewer as caught
 * up. Both servers answer the updated conversation row. */
export async function markConversationRead(
  client: MastoClient,
  id: string,
): Promise<CoreConversation> {
  const res = await client.post<WireConversation>(
    `/api/v1/conversations/${encodeURIComponent(id)}/read`,
  );
  if (!res.data || typeof res.data !== "object" || !("id" in res.data)) {
    throw new ApiError(
      `Marking conversation ${id} read returned an unexpected response shape.`,
      res.status,
      "errors.shape.conversation",
      undefined,
      { id },
    );
  }
  return adaptConversation(res.data);
}
