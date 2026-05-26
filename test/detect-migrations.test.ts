import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detect } from "../src/detect.js";

async function makeFixture(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "devhelp-mig-"));
}
async function write(dir: string, file: string, content: string): Promise<void> {
  const full = path.join(dir, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

describe("migration command detection", () => {
  let dir: string;
  beforeEach(async () => { dir = await makeFixture(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("detects Drizzle migrate when drizzle.config is present", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", scripts: { dev: "vite" }, dependencies: { "drizzle-orm": "^0.3", "drizzle-kit": "^0.2" },
    }));
    await write(dir, "drizzle.config.ts", "export default {}");
    const d = await detect(dir);
    expect(d.migrationCommands).toContain("npx drizzle-kit migrate");
  });

  it("does NOT fire Drizzle without a config file", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", scripts: { dev: "vite" }, dependencies: { "drizzle-orm": "^0.3" },
    }));
    const d = await detect(dir);
    expect(d.migrationCommands).not.toContain("npx drizzle-kit migrate");
  });

  it("detects Django migrate with venv prefix (requirements.txt)", async () => {
    await write(dir, "requirements.txt", "django\n");
    await write(dir, "manage.py", "# django");
    const d = await detect(dir);
    expect(d.migrationCommands.some((c) => c.includes("manage.py migrate"))).toBe(true);
    expect(d.migrationCommands.some((c) => c.includes(".venv/bin/activate"))).toBe(true);
  });

  it("uses poetry run for a poetry Django project", async () => {
    await write(dir, "pyproject.toml", "[tool.poetry]\ndependencies = { django = '*' }\n");
    await write(dir, "manage.py", "# django");
    const d = await detect(dir);
    expect(d.migrationCommands.some((c) => c.startsWith("poetry run "))).toBe(true);
  });

  it("detects Rails db:prepare", async () => {
    await write(dir, "Gemfile", 'gem "rails"\n');
    const d = await detect(dir);
    expect(d.migrationCommands.some((c) => c.includes("db:prepare"))).toBe(true);
  });
});
