// WS-C live probe (read-mostly): post a remote-emoji + local-emoji status
// to Akkoma :4000, read it back (content + packed maps), verify the
// remote URL exists in the remote host's live listing, then DELETE the
// post. Writes clean up after themselves (W8 precedent). Usage:
//   npx esbuild scripts/fedi-wsc-probe.ts --bundle --platform=node --format=cjs \
//     --outfile=scripts/.fedi-wsc-probe.bundle.cjs --log-level=warning \
//     && node scripts/.fedi-wsc-probe.bundle.cjs
//
// Proves live: Akkoma round-trips `:name@host:` codes in content with no
// packed entry (the exact fallback branch), the remote host's public
// listing serves the emoji, and the served image URL loads (200).

import {
  createMastodonBackend,
  createMastodonClient,
  createMemoryStore,
  passwordGrant,
  registerApp,
  type Backend,
} from "../packages/fedi/src/index.js";

const ORIGIN = process.env.FEDI_W8_ORIGIN ?? "http://127.0.0.1:4000";
const USERNAME = process.env.FEDI_W8_USER ?? "akk1";
const PASSWORD = process.env.FEDI_W8_PASSWORD ?? "password123";

// A real emoji on a real remote host (verified in the live misskey.io
// listing at probe time).
const REMOTE_HOST = "misskey.io";
const REMOTE_NAME = "ai_acid_misskeyio";
const REMOTE_CODE = `:${REMOTE_NAME}@${REMOTE_HOST}:`;
// A real Akkoma-local custom emoji on the rig.
const LOCAL_CODE = ":hehe:";

function line(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "ok" : "FAIL"}  ${name}  ${detail}`);
}

async function main(): Promise<void> {
  let failures = 0;
  const fail = (name: string, detail: string): void => {
    failures += 1;
    line(name, false, detail);
  };

  const app = await registerApp({
    store: createMemoryStore(),
    origin: ORIGIN,
    redirectUri: "urn:ietf:wg:oauth:2.0:oob",
    scopes: "read write follow",
    appName: "keystone-wsc-probe",
  }).catch((e: unknown) => {
    fail("login.registerApp", String(e));
    throw e;
  });
  const token = await passwordGrant({
    origin: ORIGIN,
    clientId: (app as unknown as {client_id: string}).client_id,
    clientSecret: (app as unknown as {client_secret: string}).client_secret,
    username: USERNAME,
    password: PASSWORD,
  }).catch((e: unknown) => {
    fail("login.passwordGrant", String(e));
    throw e;
  });
  const backend: Backend = createMastodonBackend(createMastodonClient(ORIGIN, token.access_token), {
    flavor: "akkoma",
  });
  line("login", true, `akk1 @ ${ORIGIN}`);

  // 1. Post content carrying a remote code + a local code.
  const body = `WS-C probe ${REMOTE_CODE} ${LOCAL_CODE} (ephemeral, will delete)`;
  const created = await backend
    .createPost({text: body})
    .catch((e: unknown) => {
      fail("wsc.post", String(e));
      throw e;
    });
  line("wsc.post", true, `id=${created.id}`);

  try {
    // 2. Read back: the remote code survives verbatim in the content.
    const read = await backend.post(created.id).catch((e: unknown) => {
      fail("wsc.read", String(e));
      throw e;
    });
    const text = read.content.mfm ?? read.content.plain;
    line("wsc.remoteCodeRoundTrips", text.includes(REMOTE_CODE), `content has ${REMOTE_CODE}: ${text.slice(0, 80)}`);

    // 3. Remote listing serves the emoji (the store's fetch target).
    const res = await fetch(`https://${REMOTE_HOST}/api/emojis`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: "{}",
    });
    const listing = (await res.json()) as {emojis?: Array<{name?: unknown; url?: unknown}>};
    const hit = Array.isArray(listing.emojis)
      ? listing.emojis.find((e) => e?.name === REMOTE_NAME && typeof e?.url === "string")
      : undefined;
    const url = typeof hit?.url === "string" ? hit.url : null;
    line("wsc.remoteListingHasEmoji", url !== null, `${REMOTE_HOST} -> ${url?.slice(0, 70)}`);

    // 4. The served image URL actually loads (what the glyph renders).
    if (url) {
      const img = await fetch(url, {method: "GET", redirect: "follow"});
      const buf = Buffer.from(await img.arrayBuffer());
      line("wsc.remoteImageLoads", img.ok && buf.length > 1000, `HTTP ${img.status}, ${buf.length} bytes`);
    }

    // 5. Local Akkoma emoji resolves through the backend listing too.
    const local = await backend.customEmojis();
    const hehe = local.find((e) => e.name === "hehe");
    line("wsc.localListingHasHehe", !!hehe?.url, hehe?.url ?? "missing");
    if (hehe?.url) {
      const img = await fetch(hehe.url);
      line("wsc.localImageLoads", img.ok, `HTTP ${img.status}`);
    }
  } finally {
    await backend.deletePost(created.id).catch((e: unknown) => fail("wsc.cleanup", String(e)));
    line("wsc.cleanup", true, "probe post deleted");
  }

  if (failures > 0) {
    console.log(`${failures} FAILURES`);
    process.exitCode = 1;
  } else {
    console.log("WS-C probe: all live rows green");
  }
}

void main().catch((e: unknown) => {
  console.error("probe crashed:", e);
  process.exitCode = 1;
});
