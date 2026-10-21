// Contract smoke for `packages/fedi` (plan Phase 2, slice 2.6).
//
// Read-only calls against one server URL, printed as a result table:
//   1. detect      — family / flavor / version / capabilities (no auth)
//   2. meta        — Misskey `POST /api/meta`, else Mastodon
//                    `GET /api/v2/instance` (v1 fallback on 404/405)
//   3. timeline    — first page of the public (global) timeline, limit 5
//   4. post        — the first timeline item re-fetched by id; `empty`
//                    when the timeline has no items (never an invented id)
//   5. account     — that post's author re-fetched by id; `empty` likewise
//   6. me          — authed `me()` when FEDI_SMOKE_TOKEN is set (authed
//                    read-only path); `skip` without a token, never a failure
//   7. stream      — a stream handle builds (no socket opened here)
//   8. stream-connect — a bounded authed connect probe when FEDI_SMOKE_TOKEN
//                    is set; `skip` otherwise (anonymous connects are never
//                    attempted) or when the edge is unreachable
//   9. submodules  — one list-only row per capability-gated sub-module the
//                    backend exposes (limit 1, never a write); a 404/405
//                    reads as `skip` (honest absent), a refused edge as
//                    `skip` (rig down), never a failure
//
// MK11: all calls are anonymous except row 6/8's explicitly authed probes,
// and NOTHING is ever written: the smoke has no create/update/delete path.
// Exit code is nonzero when any row fails (`empty`/`skip` are not failures).
//
// Usage:
//   pnpm smoke --url http://127.0.0.1:3101 [--url ...]
//   pnpm smoke --all        # every rig server in RIG_URLS below
//   FEDI_SMOKE_URL=http://127.0.0.1:3101 pnpm smoke
//   FEDI_SMOKE_URL="http://a/,http://b/" pnpm smoke   # comma-separated
//   FEDI_SMOKE_TOKEN=<token> pnpm smoke --url ...     # authed rows
//
// Runs on plain Node: `pnpm smoke` bundles this file with esbuild (already
// a repo dev dependency) and runs the bundle. No RN, no UI imports.

import {
  ApiError,
  backendForSession,
  createMastodonClient,
  createMisskeyClient,
  detectServer,
  sessionId,
  UNKNOWN_ACCOUNT_ID,
  type ServerDetection,
  type Session,
} from "../packages/fedi/src/index.js";

const CALL_TIMEOUT_MS = 15_000;

// Rig servers. :3101/:3102/:3000 per `docs/setup.md` §1; :4000 is the
// local Mastodon-family (Akkoma) rig on this machine — `docs/setup.md`
// names no Mastodon port, so it is listed here, not there.
const RIG_URLS = [
  "http://127.0.0.1:3101", // Misskey
  "http://127.0.0.1:3102", // Sharkey
  "http://127.0.0.1:3000", // Pinetree
  "http://127.0.0.1:4000", // Akkoma (Mastodon family)
];

type RowStatus = "ok" | "fail" | "empty" | "skip";

interface Row {
  check: string;
  status: RowStatus;
  ms: number;
  detail: string;
}

function failDetail(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, " ").slice(0, 140);
}

async function timed<T>(label: string, run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  void label;
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${CALL_TIMEOUT_MS}ms`)), CALL_TIMEOUT_MS);
      }),
    ]);
    return { value, ms: Date.now() - start };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function anonymousSession(detection: ServerDetection, origin: string): Session {
  return {
    id: sessionId(origin, UNKNOWN_ACCOUNT_ID),
    origin,
    family: detection.family ?? "misskey",
    flavor: detection.flavor,
    accountId: UNKNOWN_ACCOUNT_ID,
    token: "",
    grant: "password",
    hosting: "third-party",
  };
}

function summarizeDetection(d: ServerDetection): string {
  const supported = Object.entries(d.features)
    .filter(([, v]) => v === "supported")
    .map(([k]) => k)
    .join(",");
  return (
    `family=${d.family ?? "?"} flavor=${d.flavor} ` +
    `version=${d.version ?? "?"} decidedBy=${d.decidedBy} supported=[${supported}]`
  );
}

async function fetchMeta(
  origin: string,
  detection: ServerDetection,
): Promise<{ ms: number; detail: string }> {
  if (detection.family === "mastodon") {
    const client = createMastodonClient(origin, null);
    const attempt = async (path: string) => timed("meta", () => client.get<Record<string, unknown>>(path));
    try {
      const { value, ms } = await attempt("/api/v2/instance");
      if (value.status === 200 && value.data) {
        return { ms, detail: instanceDetail("v2", value.data) };
      }
      if (value.status !== 404 && value.status !== 405) {
        throw new Error(`GET ${origin}/api/v2/instance -> HTTP ${value.status}`);
      }
    } catch (err) {
      // A transport/auth/timeout error is not evidence of absence (same
      // rule as detect: v1 fallback on 404/405 only — but a throw here
      // means v2 gave no status at all, so try v1 once before failing).
      void err;
    }
    const { value, ms } = await attempt("/api/v1/instance");
    if (value.status !== 200 || !value.data) {
      throw new Error(`GET ${origin}/api/v1/instance -> HTTP ${value.status}`);
    }
    return { ms, detail: instanceDetail("v1", value.data) };
  }
  const session = anonymousSession(detection, origin);
  const { value, ms } = await timed("meta", () =>
    createMisskeyClient(session).callPublic<Record<string, unknown>>("meta", {}),
  );
  const name = typeof value.name === "string" ? value.name : "?";
  const version = typeof value.version === "string" ? value.version : "?";
  const uri = typeof value.uri === "string" ? value.uri : "?";
  return { ms, detail: `name=${name} version=${version} uri=${uri}` };
}

function instanceDetail(which: string, body: Record<string, unknown>): string {
  const title = typeof body.title === "string" ? body.title : "?";
  const version = typeof body.version === "string" ? body.version : "?";
  const domain = typeof body.domain === "string" ? body.domain : "?";
  return `${which} title=${JSON.stringify(title)} version=${version} domain=${domain}`;
}

async function smokeOne(rawOrigin: string): Promise<{ origin: string; rows: Row[] }> {
  const origin = rawOrigin.replace(/\/+$/, "");
  const rows: Row[] = [];

  let detection: ServerDetection | null = null;
  try {
    const { value, ms } = await timed("detect", () => detectServer(origin));
    detection = value;
    const ok = value.flavor !== "unknown" && value.family !== null;
    rows.push({
      check: "detect",
      status: ok ? "ok" : "fail",
      ms,
      detail: summarizeDetection(value),
    });
    if (!ok) return { origin, rows };
  } catch (err) {
    rows.push({ check: "detect", status: "fail", ms: 0, detail: failDetail(err) });
    return { origin, rows };
  }

  try {
    const { ms, detail } = await fetchMeta(origin, detection);
    rows.push({ check: "meta", status: "ok", ms, detail });
  } catch (err) {
    rows.push({ check: "meta", status: "fail", ms: 0, detail: failDetail(err) });
    return { origin, rows };
  }

  const backend = backendForSession(anonymousSession(detection, origin));
  let firstId: string | null = null;
  let firstAccountId: string | null = null;
  try {
    const { value, ms } = await timed("timeline", () => backend.timeline("global", { limit: 5 }));
    const first = value.items[0] ?? null;
    firstId = first?.id ?? null;
    firstAccountId = first?.accountId ?? null;
    rows.push({
      check: "timeline",
      status: "ok",
      ms,
      detail:
        value.items.length > 0
          ? `n=${value.items.length} end=${value.end} firstId=${firstId}`
          : "n=0 (no public posts)",
    });
  } catch (err) {
    rows.push({ check: "timeline", status: "fail", ms: 0, detail: failDetail(err) });
    return { origin, rows };
  }

  if (firstId === null) {
    rows.push({ check: "post", status: "empty", ms: 0, detail: "timeline empty — no id to fetch" });
    rows.push({ check: "account", status: "empty", ms: 0, detail: "timeline empty — no author to fetch" });
    return { origin, rows };
  }

  const noteId: string = firstId;
  try {
    const { value, ms } = await timed("post", () => backend.post(noteId));
    rows.push({
      check: "post",
      status: "ok",
      ms,
      detail: `id=${value.id} author=@${value.author.acct} visibility=${value.visibility.kind}`,
    });
  } catch (err) {
    rows.push({ check: "post", status: "fail", ms: 0, detail: failDetail(err) });
  }

  if (firstAccountId === null) {
    rows.push({ check: "account", status: "empty", ms: 0, detail: "no author id on first post" });
    return { origin, rows };
  }
  const accountId: string = firstAccountId;
  try {
    const { value, ms } = await timed("account", () => backend.account({ id: accountId }));
    rows.push({
      check: "account",
      status: "ok",
      ms,
      detail: `@${value.acct} name=${JSON.stringify(value.displayName)} posts=${value.statusesCount}`,
    });
  } catch (err) {
    rows.push({ check: "account", status: "fail", ms: 0, detail: failDetail(err) });
  }

  // MK11 authed + sub-module + streaming probes. All degrade to `skip`
  // (never `fail`): the rig (:3101/:3102 down, :3000 404 on /) is the
  // expected state, and a refused edge must read as blocked, not broken.
  await probeAuthed(origin, detection, rows);
  await probeSubmodules(backend, rows);
  await probeStream(backend, rows);

  return { origin, rows };
}

// --- MK11 probes -------------------------------------------------------------

function smokeToken(): string {
  return (process.env.FEDI_SMOKE_TOKEN ?? "").trim();
}

function authedSession(detection: ServerDetection, origin: string): Session | null {
  const token = smokeToken();
  if (!token) return null;
  return {
    id: sessionId(origin, "smoke"),
    origin,
    family: detection.family ?? "misskey",
    flavor: detection.flavor,
    accountId: "smoke",
    token,
    grant: "password",
    hosting: "third-party",
  };
}

/** Authed `me()` — read-only, scoped to FEDI_SMOKE_TOKEN. */
async function probeAuthed(
  origin: string,
  detection: ServerDetection,
  rows: Row[],
): Promise<void> {
  const session = authedSession(detection, origin);
  if (!session) {
    rows.push({
      check: "me",
      status: "skip",
      ms: 0,
      detail: "no FEDI_SMOKE_TOKEN (authed read-only probe skipped)",
    });
    return;
  }
  try {
    const { value, ms } = await timed("me", () => backendForSession(session).me());
    rows.push({
      check: "me",
      status: "ok",
      ms,
      detail: `@${value.acct} id=${value.id}`,
    });
  } catch (err) {
    const detail = failDetail(err);
    rows.push({
      check: "me",
      status: "skip",
      ms: 0,
      detail:
        err instanceof ApiError && (err.status === 401 || err.status === 403)
          ? `token rejected (HTTP ${err.status}) — re-mint FEDI_SMOKE_TOKEN`
          : `edge unreachable (${detail})`,
    });
  }
}

/** List-only sub-module probes (limit 1, never a write). */
async function probeSubmodules(
  backend: ReturnType<typeof backendForSession>,
  rows: Row[],
): Promise<void> {
  const probes: Array<[string, () => Promise<unknown>]> = [];
  if (backend.drive) probes.push(["drive", () => backend.drive!.files({ limit: 1 })]);
  if (backend.antennas) probes.push(["antennas", () => backend.antennas!.list()]);
  if (backend.clips) probes.push(["clips", () => backend.clips!.list()]);
  if (backend.lists) probes.push(["lists", () => backend.lists!.list()]);
  if (backend.scheduled) probes.push(["scheduled", () => backend.scheduled!.list({ limit: 1 })]);
  if (backend.serverDrafts)
    probes.push(["serverDrafts", () => backend.serverDrafts!.list({ limit: 1 })]);
  if (backend.bookmarks) probes.push(["bookmarks", () => backend.bookmarks!.list({ limit: 1 })]);
  for (const [name, run] of probes) {
    try {
      const { value, ms } = await timed(name, run);
      const n = Array.isArray(value)
        ? value.length
        : typeof (value as { items?: unknown[] }).items?.length === "number"
          ? (value as { items: unknown[] }).items.length
          : "?";
      rows.push({ check: `sub:${name}`, status: "ok", ms, detail: `list-only n=${n}` });
    } catch (err) {
      rows.push({
        check: `sub:${name}`,
        status: "skip",
        ms: 0,
        detail:
          err instanceof ApiError && (err.status === 404 || err.status === 405)
            ? `absent (HTTP ${err.status} — honest unavailable)`
            : `blocked (${failDetail(err)})`,
      });
    }
  }
}

/** Stream handle presence + a bounded authed connect probe. */
async function probeStream(
  backend: ReturnType<typeof backendForSession>,
  rows: Row[],
): Promise<void> {
  const handle = backend.stream();
  if (!handle) {
    rows.push({
      check: "stream",
      status: "skip",
      ms: 0,
      detail: "no handle (unsupported flavor — paging only)",
    });
    rows.push({
      check: "stream-connect",
      status: "skip",
      ms: 0,
      detail: "no handle — nothing to connect",
    });
    return;
  }
  rows.push({ check: "stream", status: "ok", ms: 0, detail: "handle created (no socket opened)" });
  if (!smokeToken()) {
    rows.push({
      check: "stream-connect",
      status: "skip",
      ms: 0,
      detail: "guarded: anonymous connects are never attempted (set FEDI_SMOKE_TOKEN)",
    });
    return;
  }
  const start = Date.now();
  try {
    const sub = handle.subscribeTimeline({ kind: "global" }, () => undefined);
    let state = sub.status();
    while (state !== "subscribed" && Date.now() - start < 6_000) {
      await new Promise<void>((r) => setTimeout(r, 250));
      state = sub.status();
    }
    sub.unsubscribe();
    rows.push(
      state === "subscribed"
        ? { check: "stream-connect", status: "ok", ms: Date.now() - start, detail: "live" }
        : {
            check: "stream-connect",
            status: "skip",
            ms: Date.now() - start,
            detail: `no live edge within 6s (last: ${state})`,
          },
    );
  } catch (err) {
    rows.push({
      check: "stream-connect",
      status: "skip",
      ms: Date.now() - start,
      detail: `blocked (${failDetail(err)})`,
    });
  }
}

function printTable(origin: string, rows: Row[]): void {
  console.log(`\nsmoke ${origin}`);
  const head = ["check", "result", "ms", "detail"];
  const body = rows.map((r) => [r.check, r.status, String(r.ms), r.detail]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]?.length ?? 0)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(head));
  for (const row of body) console.log(line(row));
}

function parseArgs(argv: string[]): { urls: string[]; all: boolean } {
  const urls: string[] = [];
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") {
      all = true;
    } else if (arg === "--url") {
      const next = argv[++i];
      if (!next) throw new Error("--url needs a value");
      urls.push(next);
    } else if (arg.startsWith("--url=")) {
      urls.push(arg.slice("--url=".length));
    } else if (!arg.startsWith("-")) {
      urls.push(arg);
    } else {
      throw new Error(`unknown flag ${arg}`);
    }
  }
  const env = (process.env.FEDI_SMOKE_URL ?? "").trim();
  if (env) urls.push(...env.split(",").map((s) => s.trim()).filter(Boolean));
  if (all) urls.push(...RIG_URLS);
  return { urls: [...new Set(urls)], all };
}

async function main(): Promise<void> {
  let parsed: { urls: string[]; all: boolean };
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`fedi-smoke: ${failDetail(err)}`);
    console.error("usage: fedi-smoke --url <origin> [--url ...] | --all | FEDI_SMOKE_URL=<origin>");
    process.exitCode = 2;
    return;
  }
  if (parsed.urls.length === 0) {
    console.error("fedi-smoke: no server URL (pass --url, --all, or FEDI_SMOKE_URL)");
    process.exitCode = 2;
    return;
  }
  let failed = false;
  for (const url of parsed.urls) {
    const { origin, rows } = await smokeOne(url);
    printTable(origin, rows);
    if (rows.some((r) => r.status === "fail")) failed = true;
  }
  if (parsed.urls.length > 1) {
    console.log(failed ? "\nSMOKE: FAIL" : "\nSMOKE: PASS");
  }
  if (failed) process.exitCode = 1;
}

void main();
