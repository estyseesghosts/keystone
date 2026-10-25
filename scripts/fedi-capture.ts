// scripts/fedi-capture.ts — owner-run fixture recorder (repair X5.6).
//
// Agents cannot reach the rig (Misskey :3101 / Sharkey :3102 / Mastodon), so
// every Misskey/Sharkey fixture in `packages/fedi/test/fixtures` is still
// `source: synthesised`. This script records REAL wire responses against a
// server the owner can reach, redacts credentials/PII, and writes the
// bodies plus `manifest.json` entries (`source: recorded`, server `version`,
// `recordedAt`). The owner reviews the diff before tests consume it.
//
// What it records (read-only unless `--include-writes`):
//   misskey/sharkey  POST /api/meta, /api/i, /api/notes/show,
//                    /api/notes/reactions, /api/users/followers,
//                    /api/users/following, /api/mute/list,
//                    /api/blocking/list, /api/users/search (2 pages),
//                    /api/chat/history
//   mastodon         GET /api/v2/instance (v1 fallback), verify_credentials,
//                    one public-timeline status + its context, v1 + v2
//                    notifications, markers
// Write round-trip (flag only): misskey notes/create -> notes/edit
// (`editId`, the confirmed Sharkey param — audit M5) -> notes/delete;
// mastodon POST /api/v1/statuses -> DELETE /api/v1/statuses/:id.
//
// Redaction (the golden contract in `packages/fedi/test/fedi-capture.test.ts`):
// every credential value is replaced, `Bearer <x>` / email-shaped / IPv4
// literals are scrubbed from free text, and the secrets passed on the
// command line can never appear in output. Emoji/reaction map KEYS
// (`:name@host:`) are structural, not PII, and survive verbatim.
//
// Runs on plain Node 24 (type stripping — erasable syntax only, no enums,
// no parameter properties) with zero repo imports, exactly like
// `scripts/fedi-smoke.ts` bundles for Node. Not imported by the app or by
// tests outside its own test file, so it can never enter the app bundle.
//
// Usage:
//   node scripts/fedi-capture.ts --family misskey --origin http://127.0.0.1:3101 --token <token>
//   node scripts/fedi-capture.ts --family mastodon --origin https://mastodon.example --token <token> \
//     --poll-status-id 123 --quote-status-id 456 --include-writes
//   node scripts/fedi-capture.ts --dry-run   # no network: in-process stub, temp dir (this is what CI runs)
// Env: FEDI_CAPTURE_TOKEN works instead of --token. Never commit a token.

export interface CaptureFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface CaptureFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type CaptureFetch = (url: string, init?: CaptureFetchInit) => Promise<CaptureFetchResponse>;

export interface CaptureFileSystem {
  mkdir(dir: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
}

export type CaptureFamily = "misskey" | "sharkey" | "mastodon";

export interface CaptureOptions {
  family: CaptureFamily;
  origin: string;
  token: string;
  outDir: string;
  /** `users/search` query (misskey) / unused on mastodon. */
  query?: string;
  /** Record the create/edit/delete round-trip (default off: read-only). */
  includeWrites?: boolean;
  /** Override the discovered note id (misskey notes/show + reactions). */
  noteId?: string;
  /** Mastodon status id carrying a poll (hidden totals). Skipped when absent. */
  pollStatusId?: string;
  /** Mastodon status id carrying a nested quote. Skipped when absent. */
  quoteStatusId?: string;
  fetchImpl?: CaptureFetch;
  fsImpl?: CaptureFileSystem;
  now?: () => string;
}

export type RowStatus = "ok" | "fail" | "empty" | "skip";

export interface CaptureRow {
  check: string;
  status: RowStatus;
  ms: number;
  detail: string;
}

export interface CaptureReport {
  rows: CaptureRow[];
  files: string[];
  manifestPath: string;
  exitCode: number;
}

const CALL_TIMEOUT_MS = 15_000;
const REDACTED = "[redacted]";

// --- redaction ---------------------------------------------------------------

const SENSITIVE_KEY =
  /^(i|token|access_token|refresh_token|client_secret|password|email|mnemonic|privatekey|private_key)$/i;
const SENSITIVE_KEY_PART = /(token|secret|password|passwd|email)/i;
const BEARER_RE = /Bearer\s+[A-Za-z0-9\-._~+/=]+/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/** Scrub one free-text string: bearer credentials, emails, IPs, secrets. */
function redactText(text: string, secrets: string[]): string {
  let out = text.replace(BEARER_RE, `Bearer ${REDACTED}`);
  out = out.replace(EMAIL_RE, (found: string, offset: number, full: string) => {
    // Reaction/emoji codes (`:name@host:`) are structural wire values, not
    // PII: skip only the fully colon-wrapped shape. A bare `at:foo@bar.com`
    // in prose still redacts (its tail is not a colon).
    if (full[offset - 1] === ":" && full[offset + found.length] === ":") return found;
    return REDACTED;
  });
  out = out.replace(IPV4_RE, REDACTED);
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join(REDACTED);
  }
  return out;
}

/**
 * Deep-redact a recorded body. Object KEYS are structural (kept, so the
 * fixture still matches the wire shape); every value under a sensitive key
 * becomes `[redacted]`, and every other string is scrubbed for bearer /
 * email / IP / secret occurrences. Reaction/emoji map keys (`:name@host:`)
 * are keys, not values, so they survive verbatim by construction.
 */
export function redactRecorded(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactRecorded(item, secrets));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key) || SENSITIVE_KEY_PART.test(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactRecorded(entry, secrets);
      }
    }
    return out;
  }
  return value;
}

// --- transport ----------------------------------------------------------------

// --- transport (fetch + fs seams; injectable for tests) -------------------------

function lazyNodeFs(): CaptureFileSystem {
  // Dynamic import only (no static node: imports): the module stays
  // importable anywhere, and tests inject their own fs and never reach here.
  // Typed as the real node module (a narrower structural annotation trips
  // strictFunctionTypes against node's overloads).
  const load = async (): Promise<typeof import("node:fs/promises")> =>
    import("node:fs/promises");
  return {
    mkdir: async (dir) => {
      await (await load()).mkdir(dir, { recursive: true });
    },
    writeFile: async (path, content) => {
      await (await load()).writeFile(path, content, "utf8");
    },
    readFile: (path) => load().then((fs) => fs.readFile(path, "utf8")),
  };
}

function joinPath(...parts: string[]): string {
  return parts
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

async function fetchJson(
  fetchImpl: CaptureFetch,
  url: string,
  init: CaptureFetchInit,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function runCapture(opts: CaptureOptions): Promise<CaptureReport> {
  const fetchImpl = opts.fetchImpl ?? nodeFetch();
  const fs = opts.fsImpl ?? lazyNodeFs();
  const now = opts.now ?? (() => new Date().toISOString());
  const origin = opts.origin.replace(/\/$/, "");
  const familyDir = opts.family === "mastodon" ? "mastodon" : opts.family;
  const secrets = [opts.token];
  const rows: CaptureRow[] = [];
  const written: Array<{ file: string; endpoint: string; version: string }> = [];
  let serverVersion = "unknown";

  async function misskeyCall(endpoint: string, params: Record<string, unknown>): Promise<unknown> {
    const { status, body } = await fetchJson(fetchImpl, `${origin}/api/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ i: opts.token, ...params }),
    });
    if (status < 200 || status >= 300) {
      throw new Error(`HTTP ${status} on ${endpoint}`);
    }
    return body;
  }

  async function mastoGet(path: string): Promise<unknown> {
    const { status, body } = await fetchJson(fetchImpl, `${origin}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${opts.token}` },
    });
    if (status === 404 || status === 405) return null;
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status} on ${path}`);
    return body;
  }

  async function mastoWrite(
    method: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const { status, body: res } = await fetchJson(fetchImpl, `${origin}${path}`, {
      method,
      headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status} on ${path}`);
    return res;
  }

  async function record(
    name: string,
    file: string,
    endpoint: string,
    load: () => Promise<unknown>,
  ): Promise<void> {
    const start = Date.now();
    try {
      const body = await load();
      if (body === null || body === undefined) {
        rows.push({ check: name, status: "skip", ms: Date.now() - start, detail: "absent" });
        return;
      }
      if (Array.isArray(body) && body.length === 0) {
        await write(file, body, endpoint);
        rows.push({ check: name, status: "empty", ms: Date.now() - start, detail: file });
        return;
      }
      await write(file, body, endpoint);
      rows.push({ check: name, status: "ok", ms: Date.now() - start, detail: file });
    } catch (err) {
      const detail = (err instanceof Error ? err.message : String(err)).slice(0, 120);
      rows.push({ check: name, status: "fail", ms: Date.now() - start, detail });
    }
  }

  async function write(rel: string, body: unknown, endpoint: string): Promise<void> {
    const redacted = redactRecorded(body, secrets);
    const path = joinPath(opts.outDir, familyDir, rel);
    await fs.mkdir(joinPath(opts.outDir, familyDir));
    await fs.writeFile(path, `${JSON.stringify(redacted, null, 2)}\n`);
    written.push({ file: `${familyDir}/${rel}`, endpoint, version: serverVersion });
  }

  if (opts.family === "mastodon") {
    const inst = (await mastoGet("/api/v2/instance").catch(() => null)) as {
      version?: unknown;
    } | null;
    const instBody = inst ?? ((await mastoGet("/api/v1/instance").catch(() => null)) as {
      version?: unknown;
    } | null);
    serverVersion = typeof instBody?.version === "string" ? instBody.version : "unknown";
    if (instBody) {
      await record("instance", inst ? "instance-v2.json" : "instance-v1.json", inst ? "GET /api/v2/instance" : "GET /api/v1/instance", async () => instBody);
    } else {
      rows.push({ check: "instance", status: "fail", ms: 0, detail: "no v2 or v1 instance body" });
    }
    await record("me", "me.json", "GET /api/v1/accounts/verify_credentials", () =>
      mastoGet("/api/v1/accounts/verify_credentials"),
    );
    let discovered = "";
    {
      const start = Date.now();
      try {
        const page = (await mastoGet("/api/v1/timelines/public?limit=5")) as Array<{
          id?: unknown;
        }> | null;
        const first = Array.isArray(page) ? page.find((s) => typeof s?.id === "string") : undefined;
        if (first && typeof first.id === "string") {
          discovered = first.id;
          rows.push({ check: "discover", status: "ok", ms: Date.now() - start, detail: `status ${discovered}` });
        } else {
          rows.push({ check: "discover", status: "empty", ms: Date.now() - start, detail: "public timeline empty" });
        }
      } catch (err) {
        rows.push({ check: "discover", status: "fail", ms: Date.now() - start, detail: String(err).slice(0, 120) });
      }
    }
    if (discovered) {
      await record("status", "status.json", "GET /api/v1/statuses/:id", () =>
        mastoGet(`/api/v1/statuses/${encodeURIComponent(discovered)}`),
      );
      await record("context", "status-context.json", "GET /api/v1/statuses/:id/context", () =>
        mastoGet(`/api/v1/statuses/${encodeURIComponent(discovered)}/context`),
      );
    }
    if (opts.pollStatusId) {
      const pollId = opts.pollStatusId;
      await record("poll", "status-poll.json", "GET /api/v1/statuses/:id (poll, hidden totals)", () =>
        mastoGet(`/api/v1/statuses/${encodeURIComponent(pollId)}`),
      );
    } else {
      rows.push({ check: "poll", status: "skip", ms: 0, detail: "no --poll-status-id" });
    }
    if (opts.quoteStatusId) {
      const quoteId = opts.quoteStatusId;
      await record("quote", "status-quote-recorded.json", "GET /api/v1/statuses/:id (nested quote)", () =>
        mastoGet(`/api/v1/statuses/${encodeURIComponent(quoteId)}`),
      );
    } else {
      rows.push({ check: "quote", status: "skip", ms: 0, detail: "no --quote-status-id" });
    }
    await record("notifications-v1", "notifications-recorded.json", "GET /api/v1/notifications", () =>
      mastoGet("/api/v1/notifications?limit=10"),
    );
    await record("notifications-v2", "notifications-grouped-recorded.json", "GET /api/v2/notifications", () =>
      mastoGet("/api/v2/notifications?limit=10"),
    );
    await record("markers", "markers.json", "GET /api/v1/markers", () =>
      mastoGet("/api/v1/markers?timeline[]=notifications"),
    );
    if (opts.includeWrites) {
      const start = Date.now();
      try {
        const created = (await mastoWrite("POST", "/api/v1/statuses", {
          status: `Keystone fixture probe ${now()} (safe to delete)`,
          visibility: "direct",
        })) as { id?: unknown };
        if (typeof created?.id !== "string") throw new Error("no status id in create response");
        await write("status-created.json", created, "POST /api/v1/statuses");
        await mastoWrite("DELETE", `/api/v1/statuses/${encodeURIComponent(created.id)}`, {});
        rows.push({ check: "write-roundtrip", status: "ok", ms: Date.now() - start, detail: "created + deleted" });
      } catch (err) {
        rows.push({ check: "write-roundtrip", status: "fail", ms: Date.now() - start, detail: String(err).slice(0, 120) });
      }
    }
  } else {
    const meta = (await misskeyCall("meta", {}).catch(() => null)) as {
      version?: unknown;
    } | null;
    serverVersion = meta && typeof meta.version === "string" ? meta.version : "unknown";
    if (meta) {
      await record("meta", "meta.json", "POST /api/meta", async () => meta);
    } else {
      rows.push({ check: "meta", status: "fail", ms: 0, detail: "meta unreachable" });
    }
    const me = (await misskeyCall("i", {}).catch(() => null)) as {
      id?: unknown;
    } | null;
    if (me) {
      await record("me", "me.json", "POST /api/i", async () => me);
    } else {
      rows.push({ check: "me", status: "fail", ms: 0, detail: "i unreachable" });
    }
    const meId = me && typeof me.id === "string" ? me.id : "";
    let noteId = opts.noteId ?? "";
    {
      const start = Date.now();
      try {
        const page = (await misskeyCall("notes/local-timeline", { limit: 5 })) as Array<{
          id?: unknown;
          reactions?: unknown;
        }>;
        const notes = Array.isArray(page) ? page.filter((n) => typeof n?.id === "string") : [];
        const withReactions = notes.find(
          (n) => typeof n.reactions === "object" && n.reactions !== null && Object.keys(n.reactions).length > 0,
        );
        const pick = withReactions ?? notes[0];
        if (pick && typeof pick.id === "string") {
          noteId = noteId || pick.id;
          rows.push({ check: "discover", status: "ok", ms: Date.now() - start, detail: `note ${noteId}` });
        } else {
          rows.push({ check: "discover", status: "empty", ms: Date.now() - start, detail: "local timeline empty" });
        }
      } catch (err) {
        rows.push({ check: "discover", status: "fail", ms: Date.now() - start, detail: String(err).slice(0, 120) });
      }
    }
    if (noteId) {
      await record("note", "note.json", "POST /api/notes/show", () => misskeyCall("notes/show", { noteId }));
      await record("reactions", "note-reactions.json", "POST /api/notes/reactions", () =>
        misskeyCall("notes/reactions", { noteId, limit: 20 }),
      );
    }
    if (meId) {
      await record("followers", "followers.json", "POST /api/users/followers", () =>
        misskeyCall("users/followers", { userId: meId, limit: 10 }),
      );
      await record("following", "following.json", "POST /api/users/following", () =>
        misskeyCall("users/following", { userId: meId, limit: 10 }),
      );
    } else {
      rows.push({ check: "followers", status: "skip", ms: 0, detail: "no me id" });
      rows.push({ check: "following", status: "skip", ms: 0, detail: "no me id" });
    }
    await record("mutes", "mutes.json", "POST /api/mute/list", () => misskeyCall("mute/list", { limit: 10 }));
    await record("blocks", "blocks.json", "POST /api/blocking/list", () =>
      misskeyCall("blocking/list", { limit: 10 }),
    );
    const q = opts.query ?? "a";
    await record("search-p1", "users-search-p1.json", "POST /api/users/search (offset 0)", () =>
      misskeyCall("users/search", { query: q, limit: 10, offset: 0 }),
    );
    await record("search-p2", "users-search-p2.json", "POST /api/users/search (offset 10)", () =>
      misskeyCall("users/search", { query: q, limit: 10, offset: 10 }),
    );
    await record("chat", "chat-history.json", "POST /api/chat/history", () =>
      misskeyCall("chat/history", { room: false, limit: 10 }),
    );
    if (opts.includeWrites) {
      const start = Date.now();
      try {
        const created = (await misskeyCall("notes/create", {
          text: `Keystone fixture probe ${now()} (safe to delete)`,
        })) as { createdNote?: { id?: unknown } };
        const createdId = created?.createdNote?.id;
        if (typeof createdId !== "string") throw new Error("no createdNote.id in create response");
        await write("note-created.json", created, "POST /api/notes/create");
        const edited = await misskeyCall("notes/edit", {
          editId: createdId,
          text: `Keystone fixture probe edit ${now()} (safe to delete)`,
        });
        await write("note-edited.json", edited, "POST /api/notes/edit");
        await misskeyCall("notes/delete", { noteId: createdId });
        rows.push({ check: "write-roundtrip", status: "ok", ms: Date.now() - start, detail: "created + edited + deleted" });
      } catch (err) {
        rows.push({ check: "write-roundtrip", status: "fail", ms: Date.now() - start, detail: String(err).slice(0, 120) });
      }
    }
  }

  // Manifest: every file written gains `source: recorded` + server version +
  // date. Existing entries for other files are preserved untouched.
  const manifestPath = joinPath(opts.outDir, "manifest.json");
  let manifest: { note?: string; fixtures: Record<string, Record<string, unknown>> } = {
    fixtures: {},
  };
  try {
    const raw = await fs.readFile(manifestPath);
    const parsed = JSON.parse(raw) as typeof manifest;
    if (parsed && typeof parsed.fixtures === "object") manifest = parsed;
  } catch {
    manifest = {
      note: "Recorded by scripts/fedi-capture.ts. See docs/setup.md 'Recording fixtures'.",
      fixtures: {},
    };
  }
  const recordedAt = now();
  for (const entry of written) {
    manifest.fixtures[entry.file] = {
      endpoint: entry.endpoint,
      source: "recorded",
      version: entry.version,
      recordedAt,
    };
  }
  await fs.mkdir(opts.outDir);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const exitCode = rows.some((row) => row.status === "fail") ? 1 : 0;
  return { rows, files: written.map((entry) => entry.file), manifestPath, exitCode };
}

function nodeFetch(): CaptureFetch {
  if (typeof fetch === "undefined") throw new Error("no global fetch (Node 24+ or a fetchImpl)");
  return (url, init) =>
    fetch(url, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
    });
}

// --- in-process stub (dry-run: no network, no rig) -----------------------------

interface StubRoute {
  method: string;
  match: (url: string, body: Record<string, unknown>) => boolean;
  respond: (url: string, body: Record<string, unknown>) => { status: number; body: unknown };
}

const STUB_VERSION = "stub-0.0.0-dryrun";

/** Canned both-family responses. Bodies deliberately contain secrets (token
 * echoes, emails, IPs, Bearer strings) so the dry-run proves redaction. */
function stubRoutes(): StubRoute[] {
  const note = {
    id: "note1",
    createdAt: "2026-10-25T00:00:00.000Z",
    userId: "user1",
    text: "hello — Bearer STUB_BEARER_PROBE_123, mail stub-contact@example.org, from 203.0.113.7",
    cw: null,
    visibility: "public",
    renoteId: null,
    replyId: null,
    fileIds: [],
    reactions: { ":cat@stub.example:": 3 },
    reactionEmojis: { "cat@stub.example": "https://stub.example/emoji/cat.png" },
    user: {
      id: "user1",
      username: "stubuser",
      host: null,
      name: null,
      avatarUrl: "http://203.0.113.7/avatar.png",
      avatarBlurhash: null,
      isBot: false,
      isCat: false,
      emojis: {},
      onlineStatus: "unknown",
    },
  };
  const me = {
    id: "user9",
    username: "stubowner",
    email: "stub-owner@example.org",
    avatarUrl: "https://stub.example/avatar.png",
    host: null,
  };
  const wrapper = (inner: unknown, rowId: string) => ({ id: rowId, follower: inner, followee: inner, mutee: inner, blockee: inner, createdAt: "2026-10-25T00:00:00.000Z" });
  const status = {
    id: "4001",
    content: "<p>stub — Bearer STUB_BEARER_PROBE_123, stub-contact@example.org, 203.0.113.7</p>",
    account: { id: "7", username: "stubowner", acct: "stubowner", display_name: "", avatar: "", avatar_static: "" },
    poll: null,
    quote: null,
  };
  const misskeyOk = (body: unknown): { status: number; body: unknown } => ({ status: 200, body });
  return [
    { method: "POST", match: (url) => url.endsWith("/api/meta"), respond: () => misskeyOk({ version: STUB_VERSION, name: "stubkey", maintainerEmail: "stub-owner@example.org" }) },
    { method: "POST", match: (url) => url.endsWith("/api/i"), respond: () => misskeyOk(me) },
    { method: "POST", match: (url) => url.endsWith("/api/notes/local-timeline"), respond: () => misskeyOk([note]) },
    { method: "POST", match: (url) => url.endsWith("/api/notes/show"), respond: () => misskeyOk(note) },
    { method: "POST", match: (url) => url.endsWith("/api/notes/reactions"), respond: () => misskeyOk([{ id: "r1", createdAt: "2026-10-25T00:00:00.000Z", user: me, type: ":cat@stub.example:" }]) },
    { method: "POST", match: (url) => url.endsWith("/api/users/followers"), respond: () => misskeyOk([wrapper(me, "row1")]) },
    { method: "POST", match: (url) => url.endsWith("/api/users/following"), respond: () => misskeyOk([wrapper(me, "row2")]) },
    { method: "POST", match: (url) => url.endsWith("/api/mute/list"), respond: () => misskeyOk([wrapper(me, "row3")]) },
    { method: "POST", match: (url) => url.endsWith("/api/blocking/list"), respond: () => misskeyOk([wrapper(me, "row4")]) },
    {
      method: "POST",
      match: (url, body) => url.endsWith("/api/users/search") && (body.offset as number) === 0,
      respond: () => misskeyOk([me]),
    },
    {
      method: "POST",
      match: (url, body) => url.endsWith("/api/users/search") && (body.offset as number) !== 0,
      respond: () => misskeyOk([]),
    },
    { method: "POST", match: (url) => url.endsWith("/api/chat/history"), respond: () => misskeyOk([]) },
    {
      method: "POST",
      match: (url) => url.endsWith("/api/notes/create"),
      respond: () => misskeyOk({ createdNote: { ...note, id: "note-created" } }),
    },
    {
      method: "POST",
      match: (url) => url.endsWith("/api/notes/edit"),
      respond: () => misskeyOk({ createdNote: { ...note, id: "note-created" } }),
    },
    { method: "POST", match: (url) => url.endsWith("/api/notes/delete"), respond: () => misskeyOk({}) },
    { method: "GET", match: (url) => url.includes("/api/v2/instance"), respond: () => ({ status: 200, body: { version: STUB_VERSION, title: "stub" } }) },
    { method: "GET", match: (url) => url.includes("/api/v1/instance"), respond: () => ({ status: 200, body: { version: STUB_VERSION } }) },
    { method: "GET", match: (url) => url.includes("/verify_credentials"), respond: () => ({ status: 200, body: { id: "7", username: "stubowner", email: "stub-owner@example.org" } }) },
    { method: "GET", match: (url) => url.includes("/timelines/public"), respond: () => ({ status: 200, body: [status] }) },
    { method: "GET", match: (url) => /\/statuses\/[^/]+\/context$/.test(url), respond: () => ({ status: 200, body: { ancestors: [], descendants: [] } }) },
    { method: "GET", match: (url) => /\/statuses\/[^/]+$/.test(url), respond: () => ({ status: 200, body: status }) },
    { method: "GET", match: (url) => url.includes("/api/v2/notifications"), respond: () => ({ status: 200, body: { notification_groups: [] } }) },
    { method: "GET", match: (url) => url.includes("/api/v1/notifications"), respond: () => ({ status: 200, body: [] }) },
    { method: "GET", match: (url) => url.includes("/api/v1/markers"), respond: () => ({ status: 200, body: { notifications: { last_read_id: "1" } } }) },
    { method: "POST", match: (url) => url.includes("/api/v1/statuses"), respond: () => ({ status: 200, body: { ...status, id: "4002" } }) },
    { method: "DELETE", match: (url) => /\/statuses\/[^/]+$/.test(url), respond: () => ({ status: 200, body: {} }) },
  ];
}

export function createStubFetch(): CaptureFetch {
  const routes = stubRoutes();
  return async (url: string, init: CaptureFetchInit = {}) => {
    let body: Record<string, unknown> = {};
    try {
      body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    const route = routes.find((r) => r.method === (init.method ?? "GET") && r.match(url, body));
    if (!route) return { ok: false, status: 404, json: async () => ({ error: "stub: no route" }) };
    const res = route.respond(url, body);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.body };
  };
}

// --- CLI -----------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    console.log("usage: node scripts/fedi-capture.ts --family misskey|sharkey|mastodon --origin <url> --token <token> [--out <dir>] [--query <q>] [--include-writes] [--note-id <id>] [--poll-status-id <id>] [--quote-status-id <id>] [--dry-run]");
    return;
  }
  if (args["dry-run"]) {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fedi-capture-"));
    const family = (args.family as CaptureFamily) ?? "misskey";
    const report = await runCapture({
      family,
      origin: "http://stub.local",
      token: "STUB_DRYRUN_TOKEN",
      outDir: tmp,
      includeWrites: true,
      pollStatusId: "4001",
      quoteStatusId: "4001",
      fetchImpl: createStubFetch(),
      fsImpl: {
        mkdir: (dir) => fs.mkdir(dir, { recursive: true }).then(() => undefined),
        writeFile: (p, c) => fs.writeFile(p, c, "utf8").then(() => undefined),
        readFile: (p) => fs.readFile(p, "utf8"),
      },
      now: () => "2026-10-25T00:00:00.000Z",
    });
    for (const row of report.rows) console.log(`${row.status}\t${row.check}\t${row.detail}`);
    console.log(`files: ${report.files.length} under ${tmp}`);
    if (report.exitCode !== 0) {
      console.error("dry-run failed");
      throw new Error("dry-run failed");
    }
    return;
  }
  const family = args.family as CaptureFamily;
  if (family !== "misskey" && family !== "sharkey" && family !== "mastodon") {
    throw new Error("--family must be misskey|sharkey|mastodon");
  }
  const origin = args.origin as string;
  if (!origin || !/^https?:\/\//.test(origin)) throw new Error("--origin must be an http(s) URL");
  const envToken = process.env.FEDI_CAPTURE_TOKEN ?? "";
  const token = (args.token as string) || envToken;
  if (!token) throw new Error("missing token: --token or FEDI_CAPTURE_TOKEN");
  const out = (args.out as string) || "packages/fedi/test/fixtures";
  const fs = await import("node:fs/promises");
  const report = await runCapture({
    family,
    origin,
    token,
    outDir: out,
    query: (args.query as string) || "a",
    includeWrites: args["include-writes"] === true,
    noteId: args["note-id"] as string | undefined,
    pollStatusId: args["poll-status-id"] as string | undefined,
    quoteStatusId: args["quote-status-id"] as string | undefined,
    fsImpl: {
      mkdir: (dir) => fs.mkdir(dir, { recursive: true }).then(() => undefined),
      writeFile: (p, c) => fs.writeFile(p, c, "utf8").then(() => undefined),
      readFile: (p) => fs.readFile(p, "utf8"),
    },
  });
  for (const row of report.rows) console.log(`${row.status}\t${row.check}\t${row.detail}`);
  console.log(`manifest: ${report.manifestPath}`);
  if (report.exitCode !== 0) throw new Error("capture had failing rows");
}

const invokedAsCli =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /fedi-capture\.(ts|mts|cts|js|cjs|mjs)$/.test(process.argv[1] ?? "");

if (invokedAsCli) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
