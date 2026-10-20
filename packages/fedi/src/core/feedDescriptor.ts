// Feed descriptors (plan §2): the deck's foundation. Every timeline screen
// and every deck column is addressed by one of these strings; a column is
// `{descriptor, sessionId, options}`.
//
// The string form is what crosses persistence (deck layout) and query keys.
// The parsed form is what the query layer dispatches on. `parse` / `format`
// round-trip exactly: `format(parse(x)) === x` for every valid descriptor.
//
// Pure TS: no framework imports, no globals (enforced by `no-ui-in-fedi`).

import type { TimelineKind } from "./backend";
import { FediError } from "./errors";

/** Every feed address, exactly as plan §2. */
export type FeedDescriptor =
  | "timeline|home"
  | "timeline|local"
  | "timeline|social"
  | "timeline|global"
  | `list|${string}`
  | `antenna|${string}`
  | `channel|${string}`
  | `clip|${string}`
  | `tag|${string}`
  | `search|${string}`
  | "bookmarks"
  | "mentions"
  | `user|${string}|${"posts" | "replies" | "media" | "featured"}`;

/** Profile-tab feeds addressable as `user|<id>|<tab>`. */
export type UserFeedTab = "posts" | "replies" | "media" | "featured";

/** The structured form of a `FeedDescriptor` for dispatch. */
export type ParsedFeedDescriptor =
  | { kind: "timeline"; timeline: TimelineKind }
  | { kind: "list"; id: string }
  | { kind: "antenna"; id: string }
  | { kind: "channel"; id: string }
  | { kind: "clip"; id: string }
  | { kind: "tag"; tag: string }
  | { kind: "search"; query: string }
  | { kind: "bookmarks" }
  | { kind: "mentions" }
  | { kind: "user"; id: string; tab: UserFeedTab };

const TIMELINES: ReadonlySet<string> = new Set(["home", "local", "social", "global"]);

const USER_TABS: ReadonlySet<string> = new Set(["posts", "replies", "media", "featured"]);

function invalid(descriptor: unknown): never {
  throw new FediError("Invalid feed descriptor.", "errors.feeds.invalidDescriptor", {
    descriptor,
  });
}

/**
 * An id/tag/query argument is valid when it is non-empty, not blank-only,
 * and carries no `|` (the segment separator — structural, never content).
 * The exact string is otherwise preserved verbatim so `format(parse(x))`
 * is the identity on every valid descriptor.
 */
function arg(kind: string, value: string, descriptor: unknown): string {
  if (value.length === 0 || value.trim().length === 0 || value.includes("|")) {
    invalid(descriptor);
  }
  void kind;
  return value;
}

/**
 * Parse a descriptor string into its structured form. Throws `FediError`
 * (`errors.feeds.invalidDescriptor`) on anything outside the plan §2
 * union — never a best-effort guess.
 */
export function parseFeedDescriptor(descriptor: string): ParsedFeedDescriptor {
  if (typeof descriptor !== "string" || descriptor.length === 0) {
    invalid(descriptor);
  }
  const parts = descriptor.split("|");
  if (parts.length === 1) {
    if (parts[0] === "bookmarks") return { kind: "bookmarks" };
    if (parts[0] === "mentions") return { kind: "mentions" };
    invalid(descriptor);
  }
  if (parts.length === 2) {
    const [ns, rest] = parts as [string, string];
    if (ns === "timeline") {
      if (TIMELINES.has(rest)) return { kind: "timeline", timeline: rest as TimelineKind };
      invalid(descriptor);
    }
    if (ns === "list") return { kind: "list", id: arg(ns, rest, descriptor) };
    if (ns === "antenna") return { kind: "antenna", id: arg(ns, rest, descriptor) };
    if (ns === "channel") return { kind: "channel", id: arg(ns, rest, descriptor) };
    if (ns === "clip") return { kind: "clip", id: arg(ns, rest, descriptor) };
    if (ns === "tag") return { kind: "tag", tag: arg(ns, rest, descriptor) };
    if (ns === "search") return { kind: "search", query: arg(ns, rest, descriptor) };
    invalid(descriptor);
  }
  if (parts.length === 3) {
    const [ns, id, tab] = parts as [string, string, string];
    if (ns === "user" && USER_TABS.has(tab)) {
      return { kind: "user", id: arg(ns, id, descriptor), tab: tab as UserFeedTab };
    }
    invalid(descriptor);
  }
  invalid(descriptor);
}

/** Type-guard form of `parseFeedDescriptor`: false instead of throwing. */
export function isFeedDescriptor(value: unknown): value is FeedDescriptor {
  if (typeof value !== "string") return false;
  try {
    parseFeedDescriptor(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format a parsed descriptor back to its string form. Validates the
 * arguments with the same rules as `parse` so only round-trippable
 * descriptors can be built. Throws `FediError` on empty/blank ids or
 * anything containing `|`.
 */
export function formatFeedDescriptor(parsed: ParsedFeedDescriptor): FeedDescriptor {
  switch (parsed.kind) {
    case "timeline":
      if (!TIMELINES.has(parsed.timeline)) invalid(parsed);
      return `timeline|${parsed.timeline}` as FeedDescriptor;
    case "list":
    case "antenna":
    case "channel":
    case "clip":
      return `${parsed.kind}|${arg(parsed.kind, parsed.id, parsed)}` as FeedDescriptor;
    case "tag":
      return `tag|${arg("tag", parsed.tag, parsed)}` as FeedDescriptor;
    case "search":
      return `search|${arg("search", parsed.query, parsed)}` as FeedDescriptor;
    case "bookmarks":
      return "bookmarks";
    case "mentions":
      return "mentions";
    case "user":
      if (!USER_TABS.has(parsed.tab)) invalid(parsed);
      return `user|${arg("user", parsed.id, parsed)}|${parsed.tab}` as FeedDescriptor;
  }
}
