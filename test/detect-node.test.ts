import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detect, isDetectionEmpty } from "../src/detect.js";

async function makeFixture(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "devhelp-test-"));
}

async function write(dir: string, file: string, content: string): Promise<void> {
  const full = path.join(dir, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

describe("detectNode — package manager from lockfile (ground truth)", () => {
  let dir: string;
  beforeEach(async () => { dir = await makeFixture(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("picks pnpm from pnpm-lock.yaml even if packageManager says npm", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", packageManager: "npm@10", scripts: { dev: "vite" },
    }));
    await write(dir, "pnpm-lock.yaml", "");
    const d = await detect(dir);
    expect(d.pkgManager).toBe("pnpm");
    expect(d.installCommands).toContain("pnpm install");
  });

  it("picks yarn from yarn.lock", async () => {
    await write(dir, "package.json", JSON.stringify({ name: "x", scripts: { dev: "x" } }));
    await write(dir, "yarn.lock", "");
    const d = await detect(dir);
    expect(d.pkgManager).toBe("yarn");
    expect(d.installCommands).toContain("yarn install");
  });

  it("picks bun from bun.lockb", async () => {
    await write(dir, "package.json", JSON.stringify({ name: "x", scripts: { dev: "x" } }));
    await write(dir, "bun.lockb", "");
    const d = await detect(dir);
    expect(d.pkgManager).toBe("bun");
  });

  it("uses npm ci when package-lock.json present", async () => {
    await write(dir, "package.json", JSON.stringify({ name: "x", scripts: { dev: "x" } }));
    await write(dir, "package-lock.json", "{}");
    const d = await detect(dir);
    expect(d.pkgManager).toBe("npm");
    expect(d.installCommands).toContain("npm ci");
  });
});

describe("detectNode — nodeVersionIsFloor (doctor floor semantics)", () => {
  let dir: string;
  beforeEach(async () => { dir = await makeFixture(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("marks engines '>=18' as a floor", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", engines: { node: ">=18" }, scripts: { dev: "x" },
    }));
    const d = await detect(dir);
    expect(d.nodeVersion).toBe("18");
    expect(d.nodeVersionIsFloor).toBe(true);
  });

  it("does not mark a caret engines range as a floor", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", engines: { node: "^18.0.0" }, scripts: { dev: "x" },
    }));
    const d = await detect(dir);
    expect(d.nodeVersion).toBe("18");
    expect(d.nodeVersionIsFloor).toBe(false);
  });

  it("does not mark an exact .nvmrc pin as a floor", async () => {
    await write(dir, "package.json", JSON.stringify({ name: "x", scripts: { dev: "x" } }));
    await write(dir, ".nvmrc", "18.17.0\n");
    const d = await detect(dir);
    expect(d.nodeVersion).toBe("18.17.0");
    expect(d.nodeVersionIsFloor).toBe(false);
  });
});

describe("detectNode — tooling-only package.json (regression: django/mdBook)", () => {
  let dir: string;
  beforeEach(async () => { dir = await makeFixture(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("flags pkg with only devDeps and no lockfile as tooling-only", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x",
      devDependencies: { eslint: "^8" },
    }));
    const d = await detect(dir);
    expect(d.nodeIsToolingOnly).toBe(true);
    expect(d.installCommands).not.toContain("npm install");
  });

  it("does NOT flag as tooling-only when lockfile present", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", devDependencies: { eslint: "^8" },
    }));
    await write(dir, "package-lock.json", "{}");
    const d = await detect(dir);
    expect(d.nodeIsToolingOnly).toBe(false);
  });

  it("does NOT flag as tooling-only when engines.node is set", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", engines: { node: ">=20" }, devDependencies: { eslint: "^8" },
    }));
    const d = await detect(dir);
    expect(d.nodeIsToolingOnly).toBe(false);
  });

  it("does NOT flag as tooling-only when scripts.dev exists", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", scripts: { dev: "vite" }, devDependencies: { vite: "^5" },
    }));
    await write(dir, "vite.config.ts", "");
    const d = await detect(dir);
    expect(d.nodeIsToolingOnly).toBe(false);
  });
});

describe("detectNode — framework false-positive guards (regression: trpc)", () => {
  let dir: string;
  beforeEach(async () => { dir = await makeFixture(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("does NOT flag Vite as framework without vite.config.*", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", scripts: { dev: "x" }, devDependencies: { vite: "^5" },
    }));
    await write(dir, "package-lock.json", "{}");
    const d = await detect(dir);
    expect(d.framework?.name).not.toBe("Vite");
  });

  it("DOES flag Vite when vite.config.ts exists", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", scripts: { dev: "vite" }, devDependencies: { vite: "^5" },
    }));
    await write(dir, "vite.config.ts", "export default {}");
    await write(dir, "package-lock.json", "{}");
    const d = await detect(dir);
    expect(d.framework?.name).toBe("Vite");
  });

  it("Next.js wins over Vite when both signals present", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", scripts: { dev: "next dev" },
      dependencies: { next: "^14" },
      devDependencies: { vite: "^5" },
    }));
    await write(dir, "next.config.js", "module.exports = {}");
    const d = await detect(dir);
    expect(d.framework?.name).toBe("Next.js");
  });
});

describe("detectRust — optional on Node-primary repos (regression: next.js)", () => {
  let dir: string;
  beforeEach(async () => { dir = await makeFixture(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("marks Rust optional when a Node framework is the primary stack", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", scripts: { dev: "next dev" }, dependencies: { next: "^14" },
    }));
    await write(dir, "next.config.js", "module.exports = {}");
    await write(dir, "package-lock.json", "{}");
    await write(dir, "Cargo.toml", "[package]\nname=\"x\"\nversion=\"0.1.0\"");
    const d = await detect(dir);
    expect(d.rustToolchain).toBeDefined();
    expect(d.rustIsOptional).toBe(true);
    expect(d.installCommands).not.toContain("cargo build");
  });
});

describe("isDetectionEmpty", () => {
  let dir: string;
  beforeEach(async () => { dir = await makeFixture(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("returns true on a truly empty directory", async () => {
    const d = await detect(dir);
    expect(isDetectionEmpty(d)).toBe(true);
  });

  it("returns false when a manifest produces detection", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", scripts: { dev: "x" },
    }));
    await write(dir, "package-lock.json", "{}");
    const d = await detect(dir);
    expect(isDetectionEmpty(d)).toBe(false);
  });
});
