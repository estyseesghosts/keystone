// Core error helpers: status extraction + retry policy input.
import { ApiError, FediError, httpStatusOf, isNonRetryableStatus } from "../src/core/errors";
import { HttpError } from "../src/core/http";
import { MastoHttpError, retryAfterMs } from "../src/mastodon/client";

function apiError(status: number): ApiError {
  return new ApiError(`HTTP ${status}`, status, "errors.network.apiError");
}

describe("httpStatusOf", () => {
  it("reads .status from every error shape", () => {
    expect(httpStatusOf(apiError(429))).toBe(429);
    expect(
      httpStatusOf(
        new MastoHttpError({ message: "x", kind: "http", origin: "https://x.example", status: 503 }),
      ),
    ).toBe(503);
    expect(httpStatusOf(new FediError("x", "c", { status: 404 }))).toBe(404);
  });

  it("returns null for transport failures, junk, and non-objects", () => {
    expect(httpStatusOf(apiError(0))).toBeNull();
    expect(httpStatusOf(new Error("boom"))).toBeNull();
    expect(httpStatusOf(null)).toBeNull();
    expect(httpStatusOf("429")).toBeNull();
    expect(httpStatusOf(new FediError("x", "c", { status: "429" }))).toBeNull();
  });
});

describe("isNonRetryableStatus", () => {
  it.each([401, 403, 404, 410, 422, 429])("rejects %i", (status) => {
    expect(isNonRetryableStatus(apiError(status))).toBe(true);
  });

  it.each([0, 408, 500, 503])("allows %i", (status) => {
    expect(isNonRetryableStatus(apiError(status))).toBe(false);
  });

  it("allows errors with no status", () => {
    expect(isNonRetryableStatus(new Error("boom"))).toBe(false);
  });
});

describe("retryAfterMs", () => {
  it("parses delta-seconds", () => {
    expect(retryAfterMs("42")).toBe(42000);
    expect(retryAfterMs("0")).toBe(0);
  });

  it("parses HTTP-dates relative to now", () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    const ms = retryAfterMs(future);
    expect(ms).not.toBeNull();
    expect(ms as number).toBeGreaterThan(0);
    expect(ms as number).toBeLessThanOrEqual(60_000);
  });

  it("rejects junk", () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("")).toBeNull();
    expect(retryAfterMs("soon")).toBeNull();
  });
});
