import { describe, it, expect } from "vitest";
import { normalizeNodeVersion } from "../src/versions.js";

describe("normalizeNodeVersion", () => {
  it("passes through concrete versions", () => {
    expect(normalizeNodeVersion("20.11.1")).toBe("20.11.1");
    expect(normalizeNodeVersion("v18.0.0")).toBe("18.0.0");
    expect(normalizeNodeVersion("20.11")).toBe("20.11");
    expect(normalizeNodeVersion("20")).toBe("20");
  });

  it("normalizes ranges to a major version", () => {
    expect(normalizeNodeVersion("^20.0.0")).toBe("20");
    expect(normalizeNodeVersion(">=18")).toBe("18");
    expect(normalizeNodeVersion(">=20.11.1")).toBe("20.11.1");
  });

  it("normalizes tilde to major.minor", () => {
    expect(normalizeNodeVersion("~20.11")).toBe("20.11");
  });

  it("handles wildcard forms", () => {
    expect(normalizeNodeVersion("20.x")).toBe("20");
    expect(normalizeNodeVersion("20.x.x")).toBe("20");
  });

  it("preserves lts/* alias", () => {
    expect(normalizeNodeVersion("lts/*")).toBe("lts/*");
    expect(normalizeNodeVersion("lts/iron")).toBe("lts/iron");
  });

  it("maps * and x to lts/*", () => {
    expect(normalizeNodeVersion("*")).toBe("lts/*");
    expect(normalizeNodeVersion("x")).toBe("lts/*");
  });

  it("handles empty string", () => {
    expect(normalizeNodeVersion("")).toBe("lts/*");
    expect(normalizeNodeVersion("   ")).toBe("lts/*");
  });
});
