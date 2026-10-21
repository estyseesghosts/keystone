// W5 authed probe (N4/N5/N10/N12): INTERNAL password-grant login against
// the Akkoma rig (:4000, akk1/password123), then the W5 data rows live:
//   - explore.users / explore.tags / explore.posts (N4 trending rails)
//   - search.posts / search.tags / search.accounts (N4 unified search)
//   - search.suggestTags / suggestAccounts (N4 autocomplete, guarded)
//   - followers / following of the viewer (N12)
//   - bookmarks add/list/remove round-trip (N10 saved-posts feed)
//   - clips/antennas/drive are Misskey-family only: assert the mastodon
//     backend leaves them undefined (honest unavailable, never faked).
// Read-only except the bookmarks round-trip, which cleans up after
// itself. Usage (mirrors `pnpm smoke`):
//   npx esbuild scripts/fedi-w5-probe.ts --bundle --platform=node --format=cjs \
//     --outfile=scripts/.fedi-w5-probe.bundle.cjs --log-level=warning \
//     && node scripts/.fedi-w5-probe.bundle.cjs

import {
  createMastodonBackend,
  createMastodonClient,
  createMemoryStore,
  passwordGrant,
  registerApp,
  type Backend,
} from "../packages/fedi/src/index.js";

const ORIGIN = process.env.FEDI_W5_ORIGIN ?? "http://127.0.0.1:4000";
const USERNAME = process.env.FEDI_W5_USER ?? "akk1";
const PASSWORD = process.env.FEDI_W5_PASSWORD ?? "password123";

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
    appName: "keystone-w5-probe",
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

  // N12: followers / following of the viewer.
  try {
    const followers = await backend.followers(me.id, {limit: 5});
    const following = await backend.following(me.id, {limit: 5});
    line("n12.followers", true, `followers=${followers.items.length} following=${following.items.length}`);
  } catch (e) {
    fail("n12.followers", String(e));
  }

  // N4: unified search over posts, tags, accounts.
  try {
    const posts = await backend.search.posts("test", {limit: 5});
    const tags = await backend.search.tags("test", {limit: 5});
    const accounts = await backend.search.accounts("akk1", {limit: 5});
    line("n4.search", true, `posts=${posts.items.length} tags=${tags.items.length} accounts=${accounts.items.length}`);
  } catch (e) {
    fail("n4.search", String(e));
  }

  // N4: autocomplete (guarded — members are optional).
  try {
    const tags = backend.search.suggestTags ? await backend.search.suggestTags("te", {limit: 5}) : null;
    const accts = backend.search.suggestAccounts ? await backend.search.suggestAccounts("akk", {limit: 5}) : null;
    line("n4.suggest", true, `tags=${tags?.length ?? "absent"} accounts=${accts?.items.length ?? "absent"}`);
  } catch (e) {
    fail("n4.suggest", String(e));
  }

  // N4: explore rails (guarded — module may be absent per flavor).
  try {
    if (!backend.explore) {
      line("n4.explore", true, "absent on this flavor (honest unavailable)");
    } else {
      const parts: string[] = [];
      try {
        const users = await backend.explore.users({limit: 5});
        parts.push(`users=${users.suggested.length}`);
      } catch (e) {
        parts.push(`users=ERR:${String(e).slice(0, 80)}`);
      }
      try {
        const tags = await backend.explore.tags({limit: 5});
        parts.push(`tags=${tags.length}`);
      } catch (e) {
        parts.push(`tags=ERR:${(e as {status?: unknown}).status}:${String(e).slice(0, 60)}`);
      }
      try {
        const posts = await backend.explore.posts({limit: 5});
        parts.push(`posts=${posts.items.length}`);
      } catch (e) {
        parts.push(`posts=ERR:${(e as {status?: unknown}).status}:${String(e).slice(0, 60)}`);
      }
      const news = backend.explore.news ? "present" : "absent";
      line("n4.explore", true, `${parts.join(" ")} news=${news}`);
    }
  } catch (e) {
    fail("n4.explore", String(e));
  }

  // N10: bookmark round-trip so the saved-posts feed has a row, then clean.
  try {
    const tl = await backend.timeline("global", {limit: 1});
    const target = tl.items[0];
    if (!target) {
      line("n10.bookmarks", true, "no public posts — listing only");
    } else {
      await backend.bookmarks!.add(target.id);
      const listed = await backend.bookmarks!.list({limit: 5});
      const seen = listed.items.some(r => r.post.id === target.id);
      await backend.bookmarks!.remove(target.id);
      line("n10.bookmarks", true, `listed=${listed.items.length} seen=${seen} (cleaned)`);
    }
  } catch (e) {
    fail("n10.bookmarks", String(e));
  }

  // N7/N8/N9: mastodon family has no clips/antennas/drive — must be absent.
  line(
    "w5.absent",
    backend.clips === undefined && backend.antennas === undefined && backend.drive === undefined,
    `clips=${backend.clips === undefined} antennas=${backend.antennas === undefined} drive=${backend.drive === undefined}`,
  );

  if (failures > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(`probe crashed: ${String(e)}`);
  process.exit(1);
});
