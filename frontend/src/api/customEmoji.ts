// Hosted custom emoji listing. `POST /api/emojis` returns
// `{emojis: [{name, category, url, aliases}]}` — verified live on Sharkey
// dvd.chat 2026-10-16 (public, no auth; 3,488 items / 51 categories).
// Misskey-family servers share this endpoint; Pinetree answers 404
// (unknown POST paths 404 non-JSON there) and the picker omits the
// Custom section instead of erroring.
//
// Session-cached with in-flight dedupe (translate.ts pattern): one
// network round-trip per session no matter how many pickers open.
// The URL map lives in a module-level signal so chips, the like
// button, and picker cells all re-render when it lands.

import { createSignal } from "solid-js";
import { apiCall } from "./client";
import { ApiError } from "./error";
import { BACKEND_ID } from "./backend";
import { getActiveExternal } from "./external";
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

const [state, setState] = createSignal<CustomEmojiState>("idle");
const [emojiList, setEmojiList] = createSignal<CustomEmoji[]>([]);
const [urlByName, setUrlByName] = createSignal<Map<string, string>>(new Map());

let inflight: Promise<void> | null = null;
// Which target the cache was loaded from. Account switching (internal
// ↔ external) changes the emoji host, so a ready cache for another
// target does not satisfy a load.
let loadedKey: string | null = null;

function currentKey(): string {
  const ext = getActiveExternal();
  return ext ? `ext:${ext.host}` : `int:${BACKEND_ID}`;
}

/** Reactive load state for the Custom section. */
export function customEmojiState(): CustomEmojiState {
  return state();
}

/** Reactive hosted list (empty until loaded). */
export function customEmojis(): CustomEmoji[] {
  return emojiList();
}

/** Packed URL for a reaction key, or null when unknown (unicode,
 * unlisted, not-yet-loaded, or REMOTE — a remote `:name@host:` never
 * resolves against the local list, which would render the wrong emoji).
 * Accepts `:name:` and `:name@.:` (host reduces to the bare local name).
 * Reactive: re-evaluates when the listing lands. */
export function customEmojiUrl(reaction: string): string | null {
  const name = customEmojiNameFromReaction(reaction);
  if (name == null) return null;
  const parsed = parseEmojiCode(reaction);
  if (parsed && !isLocalEmojiHost(parsed.host)) return null;
  return urlByName().get(name) ?? null;
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
/** Upper bound on distinct remote hosts consulted per session. */
const MAX_REMOTE_HOSTS = 50;

const [hostMaps, setHostMaps] = createSignal<Record<string, Record<string, string>>>({});
const startedHosts = new Set<string>();
const deadHosts = new Set<string>();

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

/** Reactive hosted URL for a remote emoji, or null (unknown / not yet
 * loaded / host failed). Exact-name match on that host's listing only. */
export function remoteEmojiUrl(host: string, name: string): string | null {
  const table = hostMaps()[normalizeHost(host)];
  if (!table) return null;
  return table[name] ?? null;
}

/** Best-effort fetch of one host's public emoji listing. Idempotent —
 * safe to call from render derivations; exactly one round-trip per host
 * per session, failures remembered. */
export function ensureHostEmojis(host: string): void {
  const key = normalizeHost(host);
  if (key.length === 0 || startedHosts.has(key) || deadHosts.has(key)) return;
  if (key in hostMaps()) return;
  if (startedHosts.size + Object.keys(hostMaps()).length >= MAX_REMOTE_HOSTS) return;
  startedHosts.add(key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  void fetch(`https://${key}/api/emojis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: controller.signal,
    // No Referer: the browser's default would send the app's origin
    // (e.g. http://localhost:5173/), which the remote's Cloudflare
    // answers with a 403 challenge that carries no CORS header — the
    // preflight then fails and the host is marked dead for the session.
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
      setHostMaps((maps) => ({ ...maps, [key]: table }));
    })
    .catch(() => {
      deadHosts.add(key);
    })
    .finally(() => {
      clearTimeout(timer);
    });
}

/** Fetch once per session. Routed via `apiCall` (not `apiCallPublic`)
 * so an active external account lists ITS instance's emoji — the
 * public helper only ever hits the internal proxy backend and fails
 * there with no local backend running. The injected `i` credential is
 * consumed by the Misskey-family auth framework and never reaches
 * endpoint validation (public timelines and `meta` already rely on
 * this). 404 → `unavailable` (no custom-emoji support on this
 * backend — the section is omitted, not an error). Any other failure
 * → `error` (the section offers a retry). */
export function loadCustomEmojis(): void {
  const key = currentKey();
  if (loadedKey === key && (state() === "ready" || state() === "unavailable")) {
    return;
  }
  if (state() === "loading" || inflight) return;
  setState("loading");
  inflight = apiCall<EmojisResponse>("emojis", {})
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
      setEmojiList(list);
      setUrlByName(urls);
      loadedKey = key;
      setState("ready");
    })
    .catch((err) => {
      // Unknown endpoint (Pinetree): honest omission, not an error.
      if (err instanceof ApiError && err.status === 404) {
        loadedKey = key;
        setState("unavailable");
      } else {
        setState("error");
      }
    })
    .finally(() => {
      inflight = null;
    });
}

/** Retry after an `error` state (no-op otherwise). */
export function retryCustomEmojis(): void {
  if (state() !== "error" || inflight) return;
  setState("idle");
  loadCustomEmojis();
}
