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

  it("matches Docker daemon down", () => {
    const r = findRecovery(
      "unable to get image 'x': Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
    );
    expect(r?.ruleId).toBe("docker-daemon-down");
    expect(r?.cause).toMatch(/docker/i);
  });

  it("matches an unreachable database (Prisma P1001)", () => {
    const r = findRecovery("Error: P1001: Can't reach database server at `localhost:5450`");
    expect(r?.ruleId).toBe("db-unreachable");
    expect(r?.remediation).toMatch(/--with-services|docker compose/i);
  });

  it("matches a missing Prisma schema", () => {
    const r = findRecovery(
      "Error: Could not load `--schema` from provided path `packages/prisma/schema.prisma`: file or directory not found",
    );
    expect(r?.ruleId).toBe("prisma-schema-missing");
  });

  it("matches conflicting env vars", () => {
    const r = findRecovery("Error: There is a conflict between env vars in .env and packages/prisma/.env");
    expect(r?.ruleId).toBe("env-var-conflict");
  });

  it("matches a port already in use", () => {
    expect(findRecovery("Error: listen EADDRINUSE: address already in use :::3000")?.ruleId).toBe(
      "port-in-use",
    );
  });

  it("matches a network/clone failure", () => {
    expect(findRecovery("fatal: fetch-pack: invalid index-pack output")?.ruleId).toBe(
      "network-unreachable",
    );
    expect(findRecovery("getaddrinfo ENOTFOUND registry.npmjs.org")?.ruleId).toBe(
      "network-unreachable",
    );
  });

  it("matches a missing/private repo (the common typo) and not as a network blip", () => {
    expect(findRecovery("remote: Repository not found.\nfatal: repository 'https://github.com/x/y.git/' not found")?.ruleId).toBe(
      "repo-not-found",
    );
    expect(findRecovery("fatal: Authentication failed for 'https://github.com/x/private.git/'")?.ruleId).toBe(
      "repo-not-found",
    );
    // A bad repo must NOT be treated as a transient network error (no wasted retry).
    expect(findRecovery("remote: Repository not found.")?.ruleId).not.toBe("network-unreachable");
  });

  it("every rule has a non-empty remediation and cause", () => {
    for (const r of listRules()) {
      expect(r.remediation.length).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
      expect(r.id).toMatch(/^[a-z][a-z0-9-]+$/);
    }
  });

  it("returns the rule's human cause on a match", () => {
    expect(findRecovery("Cannot connect to the Docker daemon")?.cause).toBeTruthy();
  });

  it("auto-fixable rules surface their system deps", () => {
    const gyp = findRecovery("gyp ERR! find Python");
    expect(gyp?.systemDeps).toContain("python3");
    const ssl = findRecovery("openssl/ssl.h: No such file or directory");
    expect(ssl?.systemDeps).toEqual(expect.arrayContaining(["openssl-dev", "pkg-config"]));
  });

  it("hint-only rules (xcode CLT) have no system deps", () => {
    const xc = findRecovery("xcrun: error: invalid active developer path");
    expect(xc?.systemDeps).toBeUndefined();
  });
});
