// W8 authed probe (MD6–MD9 + filters/scheduled): password-grant login
// against the Akkoma rig (:4000, akk1/password123), then the W8 data rows
// live. Writes clean up after themselves (profile write reverts,
// scheduled/filter rows are created then deleted). Usage (mirrors smoke):
//   npx esbuild scripts/fedi-w8-probe.ts --bundle --platform=node --format=cjs \
//     --outfile=scripts/.fedi-w8-probe.bundle.cjs --log-level=warning \
//     && node scripts/.fedi-w8-probe.bundle.cjs

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
    appName: "keystone-w8-probe",
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

  const me = await backend.me().catch((e: unknown) => {
    fail("me", String(e));
    throw e;
  });

  // MD6: profile write round-trip (display_name + revert).
  try {
    const before = me.name ?? "";
    const updated = await backend.updateProfile({name: `${before}·w8`});
    const reverted = await backend.updateProfile({name: before});
    line("md6.updateProfile", updated.name?.endsWith("·w8") === true && reverted.name === before, `round-trip ok`);
  } catch (e) {
    fail("md6.updateProfile", String(e));
  }

  // MD6: unsupported family fields refuse honestly (never silent drop).
  try {
    await backend.updateProfile({location: "nowhere"}).then(
      () => fail("md6.profileField", "location write silently accepted"),
      (e: unknown) =>
        line("md6.profileField", String(e).includes("profile field"), `refused: ${String(e).slice(0, 80)}`),
    );
  } catch (e) {
    fail("md6.profileField", String(e));
  }

  // MD8: account lookup by handle (+ fallback path exercised live).
  try {
    const acct = await backend.account({username: "akk1"});
    line("md8.lookup", acct.id === me.id, `id=${acct.id}`);
  } catch (e) {
    fail("md8.lookup", String(e));
  }

  // MD7: follow requests list (honest empty on the rig).
  try {
    const reqs = await backend.followRequests({limit: 5});
    line("md7.followRequests", true, `rows=${reqs.length}`);
  } catch (e) {
    fail("md7.followRequests", String(e));
  }

  // Filters CRUD round-trip (created then deleted).
  try {
    const created = await backend.filters!.create("w8probe", ["home"]);
    const listed = await backend.filters!.list();
    const seen = listed.some(f => f.id === created.id);
    await backend.filters!.delete(created.id);
    line("filters.crud", seen, `created+listed+deleted id=${created.id}`);
  } catch (e) {
    fail("filters.crud", String(e));
  }

  // MD9: scheduled create/list/delete round-trip (far-future, then clean).
  try {
    const future = new Date(Date.now() + 86400000).toISOString();
    const created = await backend.scheduled!.create({text: "w8 probe (deleted)", scheduledAt: future});
    const listed = await backend.scheduled!.list({limit: 5});
    const row = listed.find(s => s.id === created.id) ?? null;
    const draftText = row?.draft != null ? String((row.draft as {text?: unknown}).text ?? "") : "";
    await backend.scheduled!.delete(created.id);
    line("md9.scheduled", true, `draft.text=${JSON.stringify(draftText)} (cleaned)`);
  } catch (e) {
    fail("md9.scheduled", String(e));
  }

  if (failures > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(`probe crashed: ${String(e)}`);
  process.exit(1);
});
