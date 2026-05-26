import { describe, it, expect } from "vitest";
import { buildLock } from "../src/lockfile.js";
import type { Detected } from "../src/detect.js";

function base(overrides: Partial<Detected>): Detected {
  return {
    projectDir: "/x",
    envTemplates: [],
    prismaSchemas: [],
    prismaSeedConfigured: false,
    hasPlaywright: false,
    hasHusky: false,
    hasSubmodules: false,
    installCommands: [],
    migrationCommands: [],
    nodeIsToolingOnly: false,
    isLibrary: false,
    rustIsOptional: false,
    goNeedsManualInstall: false,
    dockerComposeFiles: [],
    envHasLocalDb: false,
    unrecognizedManifests: [],
    ...overrides,
  };
}

describe("buildLock", () => {
  it("pins resolved runtime versions and the package manager", () => {
    const d = base({ nodeVersion: "20.11.1", pkgManager: "pnpm", installCommands: ["pnpm install"] });
    const lock = buildLock(d, "0.4.0", new Date("2026-01-01T00:00:00Z"));
    expect(lock.runtimes.node).toBe("20.11.1");
    expect(lock.packageManager).toBe("pnpm");
    expect(lock.installCommands).toEqual(["pnpm install"]);
    expect(lock.generatedBy).toBe("devhelp 0.4.0");
    expect(lock.lockfileVersion).toBe(1);
  });

  it("does not pin Node when it is tooling-only", () => {
    const d = base({ nodeVersion: "lts/*", nodeIsToolingOnly: true });
    expect(buildLock(d, "0.4.0").runtimes.node).toBeUndefined();
  });

  it("pins bun (not node) when bun is the runtime", () => {
    const d = base({ nodeVersion: "20", bunIsRuntime: true, bunVersion: "1.1.0" });
    const lock = buildLock(d, "0.4.0");
    expect(lock.runtimes.node).toBeUndefined();
    expect(lock.runtimes.bun).toBe("1.1.0");
  });

  it("captures polyglot stacks including erlang alongside elixir", () => {
    const d = base({ pythonVersion: "3.13", rustToolchain: "stable", elixirVersion: "1.16", erlangVersion: "26" });
    const lock = buildLock(d, "0.4.0");
    expect(lock.runtimes).toMatchObject({ python: "3.13", rust: "stable", elixir: "1.16", erlang: "26" });
  });
});
