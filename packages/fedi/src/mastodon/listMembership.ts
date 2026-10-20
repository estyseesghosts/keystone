// List membership (slice 4.4), Mastodon family. `GET /accounts/:id/lists`
// names the viewer's lists holding the account; add/remove ride
// `/lists/:id/accounts` with `account_ids`.

import type { MastoClient } from "./client";

export async function listsContaining(client: MastoClient, accountId: string): Promise<string[]> {
  const res = await client.get<Array<{ id: string }>>(`/api/v1/accounts/${encodeURIComponent(accountId)}/lists`);
  return (Array.isArray(res.data) ? res.data : []).map((l) => l.id);
}

export async function addToList(client: MastoClient, listId: string, accountId: string): Promise<void> {
  await client.post(`/api/v1/lists/${encodeURIComponent(listId)}/accounts`, { account_ids: [accountId] });
}

export async function removeFromList(client: MastoClient, listId: string, accountId: string): Promise<void> {
  await client.delete(`/api/v1/lists/${encodeURIComponent(listId)}/accounts`, { account_ids: [accountId] });
}
