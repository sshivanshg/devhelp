import { describe, it, expect } from "vitest";
import { isServerUp, pollUrl } from "../src/verify.js";

describe("isServerUp", () => {
  it("treats 2xx/3xx/4xx as up (server is answering)", () => {
    expect(isServerUp(200)).toBe(true);
    expect(isServerUp(301)).toBe(true);
    expect(isServerUp(404)).toBe(true);
  });
  it("treats 5xx as not-yet-up", () => {
    expect(isServerUp(500)).toBe(false);
    expect(isServerUp(503)).toBe(false);
  });
});

describe("pollUrl", () => {
  it("resolves true once the fetcher returns an up status", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { status: calls >= 2 ? 200 : 500 }; // up on the 2nd poll
    };
    const ok = await pollUrl("http://x", 5000, fetcher, 1);
    expect(ok).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("resolves false when the timeout elapses without an up status", async () => {
    const fetcher = async () => {
      throw new Error("ECONNREFUSED");
    };
    const ok = await pollUrl("http://x", 30, fetcher, 5);
    expect(ok).toBe(false);
  });
});
