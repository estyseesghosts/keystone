// W4 authed probe (MD1/MD2/MD3): INTERNAL password-grant login against the
// Akkoma rig (:4000, akk1/password123), then the three W4 data rows live:
//   1. notifications — grouped:true (expect flat v1 fallback rows on Akkoma,
//      which has no grouped v2 envelope), type-filtered page, second page via
//      the returned cursor (MD1 paging + filters over the wire)
//   2. bookmarks — two pages via cursor (MD2 Link-header paging)
//   3. filters — list, create, update, delete (MD3 v1 fallback; Akkoma has
//      no /api/v2/filters, so the v1 path must serve all four)
// Nothing is faked: failures print and exit nonzero. Read-only except the
// single create/update/delete filter round-trip, which cleans up after
// itself. Usage (mirrors `pnpm smoke`):
//   npx esbuild scripts/fedi-w4-probe.ts --bundle --platform=node --format=cjs \
//     --outfile=scripts/.fedi-w4-probe.bundle.cjs --log-level=warning \
//     && node scripts/.fedi-w4-probe.bundle.cjs

import {
  createMastodonBackend,
  createMastodonClient,
  createMemoryStore,
  passwordGrant,
  registerApp,
  type Backend,
} from "../packages/fedi/src/index.js";

const ORIGIN = process.env.FEDI_W4_ORIGIN ?? "http://127.0.0.1:4000";
const USERNAME = process.env.FEDI_W4_USER ?? "akk1";
const PASSWORD = process.env.FEDI_W4_PASSWORD ?? "password123";

function line(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "ok" : "FAIL"}  ${name}  ${detail}`);
}

async function main(): Promise<void> {
  let failures = 0;
  const fail = (name: string, detail: string): void => {
    failures += 1;
    line(name, false, detail);
  };

  // Login: register an app, then the ROPC password grant.
  const app = await registerApp({
    store: createMemoryStore(),
    origin: ORIGIN,
    redirectUri: "urn:ietf:wg:oauth:2.0:oob",
    scopes: "read write follow",
    appName: "keystone-w4-probe",
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

  // MD1: grouped request falls back to flat v1 rows with a real cursor.
  try {
    const page1 = await backend.notifications({grouped: true, includeTypes: ["mention"], limit: 5});
    const page2 = page1.end || !page1.cursor ? null : await backend.notifications({grouped: true, cursor: page1.cursor, limit: 5});
    line("md1.notifications", true, `p1=${page1.items.length} end=${page1.end} p2=${page2?.items.length ?? "n/a"}`);
  } catch (e) {
    fail("md1.notifications", String(e));
  }

  // MD2: bookmarks paginate through a real cursor. Bookmark the newest
  // public post first so the listing has a row, then clean up.
  try {
    const tl = await backend.timeline("global", {limit: 1});
    const target = tl.items[0];
    if (!target) {
      line("md2.bookmarks", true, "no public posts — listing only");
    } else {
      await backend.bookmarks!.add(target.id);
      const b1 = await backend.bookmarks!.list({limit: 1});
      const b2 = b1.end || !b1.cursor ? null : await backend.bookmarks!.list({cursor: b1.cursor, limit: 1});
      await backend.bookmarks!.remove(target.id);
      line("md2.bookmarks", true, `p1=${b1.items.length} end=${b1.end} p2=${b2?.items.length ?? "n/a"}`);
    }
  } catch (e) {
    fail("md2.bookmarks", String(e));
  }

  // MD3: v1-fallback filter CRUD round-trip (Akkoma has no v2 filters).
  try {
    const before = await backend.filters!.list();
    const created = await backend.filters!.create("w4probe", ["home"], {wholeWord: true});
    const updated = await backend.filters!.update(created.id, "w4probe2", ["home", "notifications"], {});
    await backend.filters!.delete(created.id);
    const after = await backend.filters!.list();
    line("md3.filters", true, `before=${before.length} created=${created.id} updated=${updated.phrase} after=${after.length}`);
  } catch (e) {
    fail("md3.filters", String(e));
  }

  if (failures > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(`probe crashed: ${String(e)}`);
  process.exit(1);
});
