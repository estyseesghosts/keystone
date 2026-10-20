import {
  applyBlocked,
  applyFollowDesired,
  createMemoryStore,
  followButtonState,
  followDesiredOf,
  gateGraph,
  readSoftMutes,
  writeSoftMute,
  type Capabilities,
} from "../src";

const caps = (lists: "supported" | "unsupported"): Capabilities => ({ lists }) as unknown as Capabilities;

describe("graph (slice 4.4)", () => {
  it("follow on locked account becomes pending, unlocked becomes following", () => {
    expect(applyFollowDesired({ id: "a" }, "following", true)).toMatchObject({ isFollowing: false, hasPendingFollowRequestFromYou: true });
    expect(applyFollowDesired({ id: "a" }, "following", false)).toMatchObject({ isFollowing: true });
    expect(followDesiredOf({ id: "a", hasPendingFollowRequestFromYou: true })).toBe("following");
  });
  it("block clears follow", () => {
    expect(applyBlocked({ id: "a", isFollowing: true }, true)).toMatchObject({ isBlocking: true, isFollowing: false });
  });
  it("button states", () => {
    expect(followButtonState(null)).toBe("follow");
    expect(followButtonState({ id: "a", isFollowed: true })).toBe("follow_back");
    expect(followButtonState({ id: "a", hasPendingFollowRequestFromYou: true })).toBe("requested");
    expect(followButtonState({ id: "a", isBlocking: true })).toBe("unblock");
    expect(followButtonState({ id: "a", isBlocked: true })).toBe("blocked");
  });
  it("gates: no session, self, lists capability", () => {
    expect(gateGraph("mute", { capabilities: null, targetId: "a" })).toMatchObject({ enabled: false, reasonCode: "gate.noSession" });
    expect(gateGraph("block", { capabilities: caps("supported"), targetId: "a", selfId: "a" })).toMatchObject({ enabled: false });
    expect(gateGraph("list", { capabilities: caps("unsupported"), targetId: "a" })).toMatchObject({ enabled: false, reasonCode: "gate.noLists" });
    expect(gateGraph("list", { capabilities: caps("supported"), targetId: "a" })).toEqual({ enabled: true });
  });
  it("soft mutes are per session and tolerate garbage", () => {
    const store = createMemoryStore();
    writeSoftMute(store, "s1", "x", true);
    writeSoftMute(store, "s1", "x", true);
    expect(readSoftMutes(store, "s1")).toEqual(["x"]);
    expect(readSoftMutes(store, "s2")).toEqual([]);
    writeSoftMute(store, "s1", "x", false);
    expect(readSoftMutes(store, "s1")).toEqual([]);
    store.setItem("keystone.softmute.s3", "{nope");
    expect(readSoftMutes(store, "s3")).toEqual([]);
  });
});
