// Misskey-family antennas (`antennas/*`) — moved out of `backend.ts`
// (D3.1) with no behavior change. `antennaBody` stays the R1.1 allow-list:
// omit-but-never-null (Sharkey 400s on null/empty fields).

import type { Antenna, AntennasApi } from "../core/backend";
import type { Page, Post } from "../core/models";
import { decodeCursor, pageOf } from "./adapt";
import type { WireCall } from "./client";

export function antennaBody(params: Omit<Antenna, "id">): Record<string, unknown> {
  // Omit-but-never-null: Sharkey 400s on null/empty fields, and the
  // server defaults absent booleans to false. Arrays send only when
  // non-empty; booleans always send so an update can flip true → false.
  return {
    name: params.name,
    src: params.src,
    ...(params.userListId != null ? { userListId: params.userListId } : {}),
    ...(params.keywords.length > 0 ? { keywords: params.keywords } : {}),
    ...(params.excludeKeywords.length > 0 ? { excludeKeywords: params.excludeKeywords } : {}),
    ...(params.users.length > 0 ? { users: params.users } : {}),
    caseSensitive: params.caseSensitive,
    localOnly: params.localOnly,
    excludeBots: params.excludeBots,
    withReplies: params.withReplies,
    withFile: params.withFile,
  };
}

function adaptAntenna(raw: Record<string, unknown>): Antenna {
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const strGroups = (v: unknown): string[][] =>
    Array.isArray(v)
      ? v
          .filter((g): g is unknown[] => Array.isArray(g))
          .map((g) => g.filter((x): x is string => typeof x === "string"))
      : [];
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    name: typeof raw.name === "string" ? raw.name : "",
    src: (typeof raw.src === "string" ? raw.src : "all") as Antenna["src"],
    userListId: typeof raw.userListId === "string" ? raw.userListId : null,
    keywords: strGroups(raw.keywords),
    excludeKeywords: strGroups(raw.excludeKeywords),
    users: strArray(raw.users),
    caseSensitive: raw.caseSensitive === true,
    localOnly: raw.localOnly === true,
    excludeBots: raw.excludeBots === true,
    withReplies: raw.withReplies === true,
    withFile: raw.withFile === true,
  };
}

export function createAntennasApi(
  call: WireCall,
  callNotes: (endpoint: string, params: Record<string, unknown>) => Promise<Page<Post>>,
): AntennasApi {
  const DEFAULT_LIMIT = 20;
  return {
    async list() {
      const items = await call<Array<Record<string, unknown>>>("antennas/list", {});
      return (items ?? []).map(adaptAntenna);
    },
    async create(params) {
      return adaptAntenna(
        await call<Record<string, unknown>>("antennas/create", antennaBody(params)),
      );
    },
    async update(id, params) {
      return adaptAntenna(
        await call<Record<string, unknown>>("antennas/update", {
          antennaId: id,
          ...antennaBody(params),
        }),
      );
    },
    async delete(id) {
      await call<undefined>("antennas/delete", { antennaId: id });
    },
    async notes(id, opts = {}) {
      return callNotes("antennas/notes", {
        antennaId: id,
        limit: opts.limit ?? DEFAULT_LIMIT,
        ...decodeCursor(opts.cursor ?? null),
      });
    },
  };
}
