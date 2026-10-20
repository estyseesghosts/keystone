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
//
// All calls are anonymous: the session carries an empty token, so no
// credential can leak, and nothing is written. Exit code is nonzero when
// any row fails (`empty` is not a failure).
//
// Usage:
//   pnpm smoke --url http://127.0.0.1:3101 [--url ...]
//   pnpm smoke --all        # every rig server in RIG_URLS below
//   FEDI_SMOKE_URL=http://127.0.0.1:3101 pnpm smoke
//   FEDI_SMOKE_URL="http://a/,http://b/" pnpm smoke   # comma-separated
//
// Runs on plain Node: `pnpm smoke` bundles this file with esbuild (already
// a repo dev dependency) and runs the bundle. No RN, no UI imports.

import {
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

type RowStatus = "ok" | "fail" | "empty";

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

  return { origin, rows };
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
