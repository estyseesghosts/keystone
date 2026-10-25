// X5.6 — Misskey auth error branches (audit "Test and fixture gaps").
//
// Dedupe: `misskey-w8-modules.test.ts` already covers the signinFlow happy
// paths (pending/finished shapes), mintAppToken happy path (exchanges the
// native credential), and mintAppToken's `errors.auth.noKeystoneToken`
// branch — none of that is repeated here. Missing until now: transport
// failures must propagate unwrapped (never re-coded as "no token"), so a
// failing `gen-token` or `check` cannot masquerade as "server issued nothing".

import { FediError } from "../src/core/errors";
import type { WireCall } from "../src/misskey/client";
import { mintAppToken, signinFlow } from "../src/misskey/auth";

function stubCall(respond: (endpoint: string, params: Record<string, unknown>) => unknown): WireCall {
  return ((endpoint: string, params: Record<string, unknown> = {}) =>
    Promise.resolve().then(() => respond(endpoint, params))) as WireCall;
}

describe("misskey/auth error branches (X5.6)", () => {
  it("signinFlow propagates a transport failure unwrapped", async () => {
    const failure = new FediError("transport down", "errors.network.timeoutInstance");
    const call = stubCall(() => {
      throw failure;
    });
    await expect(signinFlow(call, "u", "p")).rejects.toBe(failure);
  });

  it("mintAppToken propagates a gen-token transport failure, not noKeystoneToken", async () => {
    const failure = new FediError("denied", "errors.network.apiError");
    const call = stubCall(() => {
      throw failure;
    });
    await expect(mintAppToken(call, "native-i")).rejects.toBe(failure);
  });

  it("mintAppToken propagates a check transport failure after gen-token succeeds", async () => {
    const failure = new FediError("check down", "errors.network.timeoutInstance");
    const call = stubCall((endpoint) => {
      if (endpoint === "miauth/gen-token") return { token: "gen" };
      throw failure;
    });
    await expect(mintAppToken(call, "native-i")).rejects.toBe(failure);
  });
});
