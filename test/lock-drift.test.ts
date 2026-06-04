import { describe, it, expect } from "vitest";
import { diffLocks, type DevhelpLock } from "../src/lockfile.js";

function lock(runtimes: Record<string, string>, pm?: string): DevhelpLock {
  return {
    lockfileVersion: 1,
    generatedBy: "devhelp test",
    generatedAt: "2026-01-01T00:00:00Z",
    runtimes,
    packageManager: pm,
    installCommands: [],
  };
}

describe("diffLocks", () => {
  it("reports a changed runtime version", () => {
    const d = diffLocks(lock({ node: "20.11.1" }), lock({ node: "20.12.0" }));
    expect(d).toEqual(["node: lock 20.11.1 → detected 20.12.0"]);
  });

  it("reports a runtime that vanished and one that appeared", () => {
    const d = diffLocks(lock({ node: "20", python: "3.12" }), lock({ node: "20", rust: "stable" }));
    expect(d).toContain("python: in lock (3.12) but no longer detected");
    expect(d).toContain("rust: newly detected (stable), not in lock");
  });

  it("reports a package-manager change", () => {
    const d = diffLocks(lock({ node: "20" }, "npm"), lock({ node: "20" }, "pnpm"));
    expect(d).toEqual(["packageManager: lock npm → detected pnpm"]);
  });

  it("is empty when nothing drifted", () => {
    expect(diffLocks(lock({ node: "20" }, "pnpm"), lock({ node: "20" }, "pnpm"))).toEqual([]);
  });
});
