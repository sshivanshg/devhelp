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
