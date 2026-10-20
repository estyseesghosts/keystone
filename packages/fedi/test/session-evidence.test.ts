// S1 capability truth: detection evidence reaches sessions and backends.
//
// `detectServer` keeps its probe evidence on `ServerDetection`; the
// session store persists it; `backendForSession` / `activeBackend` forward
// it into `buildCapabilities`, so probed features (translation, quote
// posting, …) are honored instead of the flavor table's conservative
// "unknown". Absent evidence keeps the table-only defaults.
import {
  activeBackend,
  backendForSession,
  type HomeSpec,
} from "../src/api/client";
import {
  createMemoryStore,
  loadSessions,
  saveSession,
  sessionId,
  setActiveSessionId,
  type KeyValueStore,
  type Session,
} from "../src/core/sessions";
import { detectServer } from "../src/core/detect";

const ORIGIN = "https://evidence.example";
const HOME: HomeSpec = { origin: ORIGIN, family: "misskey", flavor: "misskey" };

let store: KeyValueStore;
beforeEach(() => {
  store = createMemoryStore();
});

function misskeySession(over: Partial<Session> = {}): Session {
  return {
    id: sessionId(ORIGIN, "acc1"),
    origin: ORIGIN,
    family: "misskey",
    flavor: "misskey",
    accountId: "acc1",
    token: "tok",
    grant: "password",
    hosting: "first-party",
    ...over,
  };
}

describe("detectServer keeps its evidence", () => {
  it("exposes the probe evidence that produced the capabilities", async () => {
    const d = await detectServer(ORIGIN, {
      prober: async () => ({ status: 0, body: null }),
    });
    expect(d.flavor).toBe("unknown");
    expect(d.evidence).toEqual(
      expect.objectContaining({
        nodeinfoName: null,
        misskeyBody: false,
        mastodonBody: false,
      }),
    );
  });
});

describe("session evidence round-trip", () => {
  it("persists evidence and loads it back", () => {
    saveSession(store, misskeySession({ evidence: { translatorAvailable: true } }));
    expect(loadSessions(store)[0]?.evidence).toEqual({ translatorAvailable: true });
  });

  it("drops non-object evidence instead of trusting it", () => {
    store.setItem(
      "keystone_sessions",
      JSON.stringify({
        version: 1,
        active: null,
        sessions: [{ ...misskeySession(), evidence: "sharkey-supports-everything" }],
      }),
    );
    expect(loadSessions(store)[0]?.evidence).toBeUndefined();
  });
});

describe("backendForSession forwards session evidence", () => {
  it("misskey: probed translatorAvailable raises translation", () => {
    const plain = backendForSession(misskeySession());
    expect(plain.capabilities.translation).toBe("unknown");
    const raised = backendForSession(
      misskeySession({ evidence: { translatorAvailable: true } }),
    );
    expect(raised.family).toBe("misskey");
    expect(raised.capabilities.translation).toBe("supported");
  });

  it("mastodon: probed quote_posting raises the quote capability", () => {
    const session: Session = {
      ...misskeySession(),
      family: "mastodon",
      flavor: "mastodon",
    };
    const plain = backendForSession(session);
    expect(plain.capabilities.quote_posting).toBe("unknown");
    const raised = backendForSession({
      ...session,
      evidence: { pleromaFeatures: ["quote_posting"] },
    });
    expect(raised.family).toBe("mastodon");
    expect(raised.capabilities.quote_posting).toBe("supported");
  });

  it("activeBackend uses the active session's evidence", () => {
    const s = misskeySession({ evidence: { translatorAvailable: true } });
    saveSession(store, s, ORIGIN);
    setActiveSessionId(store, s.id, ORIGIN);
    expect(activeBackend(store, HOME).capabilities.translation).toBe("supported");
  });
});
