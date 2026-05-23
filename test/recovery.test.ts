import { describe, it, expect } from "vitest";
import { findRecovery, listRules } from "../src/recovery.js";

describe("recovery rules", () => {
  it("matches missing Xcode CLT (macOS)", () => {
    const err = "xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools)";
    const r = findRecovery(err);
    expect(r?.ruleId).toBe("xcode-clt-missing");
    expect(r?.remediation).toMatch(/xcode-select|build tools/i);
  });

  it("matches node-gyp Python missing", () => {
    const err = "gyp ERR! find Python\ngyp ERR! find Python Python is not set from environment variable PYTHON";
    const r = findRecovery(err);
    expect(r?.ruleId).toBe("node-gyp-python");
    expect(r?.remediation.toLowerCase()).toContain("python");
  });

  it("matches openssl header missing", () => {
    const err = "src/native.c:5:10: fatal error: openssl/ssl.h: No such file or directory";
    const r = findRecovery(err);
    expect(r?.ruleId).toBe("openssl-headers-missing");
  });

  it("matches pkg-config missing (same rule as openssl)", () => {
    const err = "configure: error: pkg-config: command not found";
    const r = findRecovery(err);
    expect(r?.ruleId).toBe("openssl-headers-missing");
  });

  it("does NOT match unrelated errors", () => {
    expect(findRecovery("ENOENT: no such file or directory")).toBeNull();
    expect(findRecovery("npm ERR! 404 Not Found")).toBeNull();
    expect(findRecovery("")).toBeNull();
  });

  it("exposes exactly three rules", () => {
    expect(listRules()).toHaveLength(3);
  });

  it("every rule has a non-empty remediation", () => {
    for (const r of listRules()) {
      expect(r.remediation.length).toBeGreaterThan(0);
      expect(r.id).toMatch(/^[a-z][a-z0-9-]+$/);
    }
  });
});
