// Shared test helpers (not a test file — jest only collects *.test.ts).
//
// Jest port: `__dirname`-relative fixture reads (no `import.meta.url`,
// which the babel CJS transform cannot provide).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = __dirname;

/** Load a raw fixture body (see the old repo's fixtures/README.md: all synthesised). */
export function fixture<T = unknown>(rel: string): T {
  return JSON.parse(readFileSync(join(HERE, "fixtures", rel), "utf8")) as T;
}

// --- Build core Posts from partial WIRE notes -------------------------------
//
// The helpers take `core/models.Post`; tests keep passing partial WIRE
// shapes (their assertions were written against the wire field names) and
// this fills every required wire field — nested `reply` / `renote`
// partials included — before adapting. Provenance stays honest: this is a
// test convenience, not a mapping under test (misskey-adapt.test.ts owns
// that).

import { adaptNote } from "../src/misskey/adapt";
import type { Note } from "../src/misskey/wire";
import type { Post } from "../src/core/models";

/** Partial wire note with partial packed reply/renote (recursive). */
export type WireNotePatch = {
  [K in keyof Note]?: K extends "reply" | "renote" ? WireNotePatch | null : Note[K];
};

function fillUser(over: Partial<Note["user"]> = {}): Note["user"] {
  return {
    id: "u1",
    name: null,
    username: "a",
    host: null,
    avatarUrl: null,
    avatarBlurhash: null,
    isBot: false,
    isCat: false,
    emojis: {},
    onlineStatus: "unknown",
    ...over,
  };
}

function fillNote(over: WireNotePatch): Note {
  const user = fillUser(over.user as Partial<Note["user"]> | undefined);
  const merged: Note = {
    id: "x",
    createdAt: "2026-01-01T00:00:00.000Z",
    userId: "u1",
    user,
    text: null,
    cw: null,
    visibility: "public",
    localOnly: false,
    reactionAcceptance: null,
    renoteCount: 0,
    repliesCount: 0,
    reactionCount: 0,
    reactions: {},
    reactionEmojis: {},
    fileIds: [],
    files: [],
    replyId: null,
    renoteId: null,
    reply: null,
    renote: null,
    poll: null,
    mentions: [],
    tags: [],
    emojis: {},
    myReaction: null,
    ...(over as Partial<Note>),
  };
  merged.user = user;
  return {
    ...merged,
    reply: merged.reply ? fillNote(merged.reply as WireNotePatch) : merged.reply,
    renote: merged.renote ? fillNote(merged.renote as WireNotePatch) : merged.renote,
  };
}

/** Core Post from a partial wire Note (recursive for packed reply/renote). */
export function postFromWire(over: WireNotePatch = {}): Post {
  return adaptNote(fillNote(over));
}
