import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cleanupDryRunTempClone, runSetup } from "../src/setup.js";

// End-to-end regression guard for the orchestration layer (setup.ts).
// We drive runSetup with a request that has no extractable repo, so it
// inspects --cwd directly with no network clone, and with dryRun so it plans
// without installing anything. This mirrors the CI smoke tests as a unit-level
// guard against the main flow silently changing its exit-code contract.

async function makeFixture(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "devhelp-runsetup-"));
}

async function write(dir: string, file: string, content: string): Promise<void> {
  const full = path.join(dir, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

const REQUEST = "set up this project"; // no owner/repo → no clone

describe("runSetup (dry-run, no network)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeFixture();
    // Silence the JSON payload the run prints; we only assert on the exit code.
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("exits 0 on a recognized stack and does not mutate the project dir", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "fixture", packageManager: "pnpm@9.0.0", scripts: { dev: "vite", test: "vitest" },
    }));
    await write(dir, "pnpm-lock.yaml", "");
    await write(dir, ".nvmrc", "20.11.1");

    const before = (await fs.readdir(dir)).sort();
    const code = await runSetup({ request: REQUEST, cwd: dir, dryRun: true, json: true });
    const after = (await fs.readdir(dir)).sort();

    expect(code).toBe(0);
    expect(after).toEqual(before); // dry-run installed nothing
    expect(after).not.toContain("node_modules");
  });

  it("exits non-zero on an unrecognized stack", async () => {
    await write(dir, "README.md", "just prose, no manifest devhelp understands");

    const code = await runSetup({ request: REQUEST, cwd: dir, dryRun: true, json: true });

    expect(code).toBe(1);
  });
});

describe("runSetup — non-critical step honesty (regression: fake-green)", () => {
  // These run for real (not dry-run) so the failing step actually executes. The
  // fixtures are tooling-only (only devDeps, no dev script, no lockfile) so no
  // deps-install runs, and there are no version files so no runtime install runs
  // — the only step that executes is the one under test, made to fail offline by
  // a stub bin in node_modules/.bin that exits 1.
  let dir: string;
  let home: string;
  let origHome: string | undefined;
  let logs: string[];

  async function stubBin(d: string, name: string): Promise<void> {
    const bin = path.join(d, "node_modules", ".bin", name);
    await fs.mkdir(path.dirname(bin), { recursive: true });
    await fs.writeFile(bin, "#!/bin/sh\nexit 1\n");
    await fs.chmod(bin, 0o755);
  }

  function lastPayload(): any {
    for (let i = logs.length - 1; i >= 0; i--) {
      try {
        const v = JSON.parse(logs[i]);
        if (v && typeof v === "object" && "status" in v) return v;
      } catch {
        /* not the JSON line */
      }
    }
    return undefined;
  }

  beforeEach(async () => {
    dir = await makeFixture();
    home = await makeFixture(); // isolate the run-log out of the real ~/.devhelp
    origHome = process.env.HOME;
    process.env.HOME = home;
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...a: any[]) => {
      if (typeof a[0] === "string") logs.push(a[0]);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    process.env.HOME = origHome;
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it("a failed `prisma generate` yields INCOMPLETE + exit 1, not a green READY", async () => {
    await write(dir, "package.json", JSON.stringify({ name: "x", devDependencies: { prisma: "^5" } }));
    await write(dir, "prisma/schema.prisma", 'generator client { provider = "prisma-client-js" }\n');
    await stubBin(dir, "prisma");

    const code = await runSetup({ request: REQUEST, cwd: dir, dryRun: false, json: true });

    expect(code).toBe(1);
    const payload = lastPayload();
    expect(payload?.status).toBe("INCOMPLETE");
    expect(payload?.failedSteps.some((s: any) => /prisma/i.test(s.name))).toBe(true);
  });

  it("a failed Playwright install stays READY but surfaces a warning (not silent)", async () => {
    // .env.example makes detection a recognized stack (so the run can reach READY)
    // and adds a succeeding fs-only env-copy step; Playwright is the only failure.
    await write(dir, "package.json", JSON.stringify({ name: "x", devDependencies: { playwright: "^1" } }));
    await write(dir, ".env.example", "FOO=bar\n");
    await stubBin(dir, "playwright");

    const code = await runSetup({ request: REQUEST, cwd: dir, dryRun: false, json: true });

    expect(code).toBe(0);
    const payload = lastPayload();
    expect(payload?.status).toBe("READY");
    expect(payload?.warnings.some((w: string) => /playwright/i.test(w))).toBe(true);
  });
});

describe("cleanupDryRunTempClone", () => {
  it("removes the temp clone path and clears it so cleanup is idempotent", async () => {
    const dir = await makeFixture();
    await write(dir, "README.md", "temp clone");

    const ctx = { dryRunTempClone: dir } as any;
    await cleanupDryRunTempClone(ctx);
    await cleanupDryRunTempClone(ctx);

    expect(ctx.dryRunTempClone).toBeUndefined();
    await expect(fs.stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
