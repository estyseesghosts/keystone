// Hosted custom emoji listing. `POST /api/emojis` returns
// `{emojis: [{name, category, url, aliases}]}` — verified live on Sharkey
// dvd.chat 2026-10-16 (public, no auth; 3,488 items / 51 categories).
// Misskey-family servers share this endpoint; Pinetree answers 404
// (unknown POST paths 404 non-JSON there) and the picker omits the
// Custom section instead of erroring.
//
// One store per session (`createCustomEmojiStore`): the old module-global
// Solid signals became instance state + an `eventemitter3` change event
// (pure-TS rule: no UI framework in this package). In-flight dedupe is
// preserved — one network round-trip per store no matter how many pickers
// open. The backend's `customEmojis()` stays the one-shot list read; this
// store is the reactive cache the picker/chips subscribe to.

import EventEmitter from "eventemitter3";
import { ApiError } from "../core/errors";
import type { ServerFamily } from "../core/detect";
import type { WireCall } from "./client";
import type { CustomEmoji } from "./emoji";
import { customEmojiNameFromReaction, isLocalEmojiHost, parseEmojiCode } from "./emoji";

interface EmojisResponse {
  emojis?: Array<{
    name?: unknown;
    category?: unknown;
    url?: unknown;
    aliases?: unknown;
  }>;
}

export type CustomEmojiState =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

export interface CustomEmojiStore {
  /** Current load state (badges/placeholders read this). */
  state(): CustomEmojiState;
  /** Hosted list (empty until loaded). */
  emojis(): CustomEmoji[];
  /** Packed URL for a reaction key, or null when unknown (unicode,
   * unlisted, not-yet-loaded, or REMOTE — a remote `:name@host:` never
   * resolves against the local list, which would render the wrong emoji).
   * Accepts `:name:` and `:name@.:` (host reduces to the bare local name). */
  urlFor(reaction: string): string | null;
  /** Hosted URL for a remote emoji, or null (unknown / not yet loaded /
   * host failed). Exact-name match on that host's listing only. */
  remoteUrlFor(host: string, name: string): string | null;
  /** Every remote-host entry fetched so far (picker search surface).
   * Empty until host listings land; hosts that failed are absent. The
   * returned array is stable by reference until the next host lands, so
   * it is safe as a `useSyncExternalStore` snapshot. */
  remoteEmojis(): Array<{ host: string; name: string; url: string }>;
  /** Best-effort fetch of one host's public emoji listing. Idempotent —
   * safe to call from render derivations; exactly one round-trip per host
   * per store, failures remembered. */
  ensureHostEmojis(host: string): void;
  /** Fetch once per store (no-op when ready/unavailable/loading). */
  load(): void;
  /** Retry after an `error` state (no-op otherwise). */
  retry(): void;
  /** Subscribe to any state/list change. Returns an unsubscribe function. */
  onChange(handler: () => void): () => void;
}

// --- Remote custom emoji (`:name@host:`) ---
//
// The global `emojis` listing is local-only, and backends may pack empty
// per-object maps, so remote codes need their own source: the remote
// instance's public `POST /api/emojis`, fetched directly (works on
// CORS-open instances), cached per host for the session. Hosts that fail
// are remembered as misses (no hot retry); unknown codes stay literal —
// never a fabricated or local-lookalike URL. Fetching a host's public
// listing is no new privacy class (remote avatars/media already load
// cross-origin). A first-party proxy endpoint would remove the CORS
// dependency; see the state log.

const REMOTE_TIMEOUT_MS = 10_000;
/** Upper bound on distinct remote hosts consulted per store. */
const MAX_REMOTE_HOSTS = 50;

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

export function createCustomEmojiStore(
  call: WireCall,
  family: ServerFamily = "misskey",
): CustomEmojiStore {
  const events = new EventEmitter();
  const emit = () => {
    events.emit("change");
  };

  let state: CustomEmojiState = "idle";
  let emojiList: CustomEmoji[] = [];
  let urlByName = new Map<string, string>();
  let inflight: Promise<void> | null = null;

  const hostMaps: Record<string, Record<string, string>> = {};
  const startedHosts = new Set<string>();
  const deadHosts = new Set<string>();
  // Flattened remote entries, cached by reference: `useSyncExternalStore`
  // snapshots must be referentially stable (a fresh array every read
  // would re-render forever), so the flat list is rebuilt only when a
  // host table lands and invalidated here.
  let remoteCache: Array<{ host: string; name: string; url: string }> | null = null;

  function setState(next: CustomEmojiState): void {
    if (state === next) return;
    state = next;
    emit();
  }

  function ensureHost(host: string): void {
    const key = normalizeHost(host);
    if (key.length === 0 || startedHosts.has(key) || deadHosts.has(key)) return;
    if (key in hostMaps) return;
    if (startedHosts.size + Object.keys(hostMaps).length >= MAX_REMOTE_HOSTS) return;
    startedHosts.add(key);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
    void fetch(`https://${key}/api/emojis`, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal,
      // No Referer: the default would send the app's origin, which some
      // remotes' Cloudflare answers with a 403 challenge that carries no
      // CORS header — the request then fails and the host is marked dead.
      referrerPolicy: "no-referrer",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: unknown = await res.json();
        const table: Record<string, string> = {};
        const list: unknown = (body as EmojisResponse).emojis;
        if (Array.isArray(list)) {
          for (const entry of list) {
            if (
              typeof entry?.name === "string" &&
              typeof entry?.url === "string" &&
              entry.name.length > 0 &&
              entry.url.length > 0 &&
              !(entry.name in table)
            ) {
              table[entry.name] = entry.url;
            }
          }
        }
        hostMaps[key] = table;
        remoteCache = null;
        emit();
      })
      .catch(() => {
        deadHosts.add(key);
      })
      .finally(() => {
        clearTimeout(timer);
      });
  }

  function load(): void {
    // MISSKEY-FAMILY ONLY: `POST /api/emojis` is not part of the MastoAPI
    // surface, so a non-Misskey session must never issue the call at all.
    // It resolves to the same `unavailable` state a 404 produces, so the
    // picker's Custom section is omitted rather than shown spinning or
    // offering a pointless retry.
    if (family !== "misskey") {
      setState("unavailable");
      return;
    }
    if (state === "ready" || state === "unavailable") return;
    if (state === "loading" || inflight) return;
    setState("loading");
    inflight = call<EmojisResponse>("emojis", {})
      .then((res) => {
        const list: CustomEmoji[] = [];
        const urls = new Map<string, string>();
        if (Array.isArray(res.emojis)) {
          for (const entry of res.emojis) {
            if (
              typeof entry?.name !== "string" ||
              typeof entry?.url !== "string" ||
              entry.name.length === 0 ||
              entry.url.length === 0
            ) {
              continue;
            }
            const aliases = Array.isArray(entry.aliases)
              ? entry.aliases.filter(
                  (alias): alias is string => typeof alias === "string",
                )
              : [];
            list.push({
              name: entry.name,
              category:
                typeof entry.category === "string" ? entry.category : null,
              url: entry.url,
              aliases,
            });
            if (!urls.has(entry.name)) urls.set(entry.name, entry.url);
          }
        }
        emojiList = list;
        urlByName = urls;
        setState("ready");
      })
      .catch((err) => {
        // Unknown endpoint (Pinetree): honest omission, not an error.
        if (err instanceof ApiError && err.status === 404) {
          emojiList = [];
          urlByName = new Map();
          setState("unavailable");
        } else {
          setState("error");
        }
      })
      .finally(() => {
        inflight = null;
      });
  }

  return {
    state: () => state,
    emojis: () => emojiList,
    urlFor: (reaction: string): string | null => {
      const name = customEmojiNameFromReaction(reaction);
      if (name == null) return null;
      const parsed = parseEmojiCode(reaction);
      if (parsed && !isLocalEmojiHost(parsed.host)) return null;
      return urlByName.get(name) ?? null;
    },
    remoteUrlFor: (host: string, name: string): string | null => {
      const table = hostMaps[normalizeHost(host)];
      if (!table) return null;
      return table[name] ?? null;
    },
    remoteEmojis: (): Array<{ host: string; name: string; url: string }> => {
      if (!remoteCache) {
        const out: Array<{ host: string; name: string; url: string }> = [];
        for (const host of Object.keys(hostMaps)) {
          const table = hostMaps[host];
          for (const name of Object.keys(table)) {
            const url = table[name];
            if (typeof url === "string" && url.length > 0) out.push({ host, name, url });
          }
        }
        remoteCache = out;
      }
      return remoteCache;
    },
    ensureHostEmojis: (host: string): void => {
      ensureHost(host);
    },
    load,
    retry: (): void => {
      if (state !== "error" || inflight) return;
      state = "idle";
      load();
    },
    onChange: (handler: () => void): (() => void) => {
      events.on("change", handler);
      return () => {
        events.off("change", handler);
      };
    },
  };
}
