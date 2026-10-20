// Phase 1 item A — port of /tmp/opencode/thread-verify.mjs (assertions) plus
// the constants checks implied by thread-check.mjs (the esbuild bundle whose
// functions are inlined copies of `src/api/thread` + `src/api/types`). These
// tests import the real source modules.
import {
  CONVERSATION_PAGE_SIZE,
  MAX_ANCESTOR_WALK,
  REPLIES_PAGE_SIZE,
  THREAD_MAX_DEPTH,
  computeFeedThreadLinks,
  isDirectReplyTo,
  mergeNotes,
  orderAncestors,
  replyParentId,
  replyParentNote,
} from "../src/misskey/thread";
import type { Note } from "../src/misskey/wire";
import type { Post } from "../src/core/models";
import { postFromWire, type WireNotePatch } from "./helpers";

function note(over: WireNotePatch = {}): Post {
  return postFromWire(over);
}

const parent = note({ id: "p" });
const child = note({ id: "c", replyId: "p", reply: { id: "p" } });

describe("thread constants", () => {
  it("REPLIES_PAGE_SIZE", () => expect(REPLIES_PAGE_SIZE).toBe(20));
  it("CONVERSATION_PAGE_SIZE", () => expect(CONVERSATION_PAGE_SIZE).toBe(30));
  it("MAX_ANCESTOR_WALK", () => expect(MAX_ANCESTOR_WALK).toBe(512));
  it("THREAD_MAX_DEPTH", () => expect(THREAD_MAX_DEPTH).toBe(32));
});

describe("reply parent resolution", () => {
  it("parentId direct", () => expect(replyParentId(child)).toBe("p"));
  it("parentNote packed", () => expect(replyParentNote(child)?.id).toBe("p"));
  it("parentId root null", () => expect(replyParentId(parent)).toBeNull());
  it("parentNote root null", () => expect(replyParentNote(parent)).toBeNull());
});

describe("isDirectReplyTo", () => {
  it("direct child->parent", () => expect(isDirectReplyTo(child, parent)).toBe(true));
  it("parent not reply to child", () => expect(isDirectReplyTo(parent, child)).toBe(false));
  const quote = note({ id: "q", renoteId: "p" });
  it("quote never links", () => expect(isDirectReplyTo(quote, parent)).toBe(false));
  it("self never links", () => expect(isDirectReplyTo(parent, parent)).toBe(false));
  const wrapperOfChild = note({
    id: "w",
    renoteId: "c",
    renote: { id: "c", replyId: "p" },
    text: null,
    cw: null,
    replyId: null,
    poll: null,
    fileIds: [],
  });
  it("wrapper parentId via original", () => expect(replyParentId(wrapperOfChild)).toBe("p"));
  it("wrapper links to parent", () => expect(isDirectReplyTo(wrapperOfChild, parent)).toBe(true));
});

describe("computeFeedThreadLinks", () => {
  const unrelated = note({ id: "u" });
  it("adjacent below/above", () => {
    const r = computeFeedThreadLinks([child, parent, unrelated]);
    expect(r.connectedBelow[0]).toBe(true);
    expect(r.connectedBelow[1]).toBe(false);
    expect(r.connectedAbove[1]).toBe(true);
    expect(r.connectedAbove[0]).toBe(false);
    expect(r.connectedAbove[2]).toBe(false);
  });
  it("chain3", () => {
    const b = note({ id: "b", replyId: "a" });
    const a = note({ id: "a" });
    const c2 = note({ id: "c2", replyId: "b" });
    const r = computeFeedThreadLinks([c2, b, a]);
    expect(r.connectedBelow).toEqual([true, true, false]);
    expect(r.connectedAbove).toEqual([false, true, true]);
  });
  it("non-adjacent no link", () => {
    const r = computeFeedThreadLinks([child, unrelated, parent]);
    expect(r.connectedBelow.every((v) => !v)).toBe(true);
    expect(r.connectedAbove.every((v) => !v)).toBe(true);
  });
  it("quote adjacency no link", () => {
    const quote = note({ id: "q", renoteId: "p" });
    expect(computeFeedThreadLinks([quote, parent]).connectedBelow[0]).toBe(false);
  });
  it("empty", () => {
    const r = computeFeedThreadLinks([]);
    expect(r.connectedAbove.length).toBe(0);
    expect(r.connectedBelow.length).toBe(0);
  });
  it("single", () => {
    const r = computeFeedThreadLinks([parent]);
    expect(r.connectedBelow[0]).toBe(false);
    expect(r.connectedAbove[0]).toBe(false);
  });
});

describe("regression: merge + ancestors", () => {
  it("merge dedupe", () => {
    const m = mergeNotes([parent], [parent, child]);
    expect(m.merged.length).toBe(2);
    expect(m.freshCount).toBe(1);
  });
  it("ancestors walk", () => {
    const o = orderAncestors("p", [parent]);
    expect(o.ancestors.length).toBe(1);
    expect(o.incomplete).toBe(false);
  });
});
