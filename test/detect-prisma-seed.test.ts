import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detect } from "../src/detect.js";

async function makeFixture(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "devhelp-seed-"));
}
async function write(dir: string, file: string, content: string): Promise<void> {
  const full = path.join(dir, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

describe("prisma seed detection", () => {
  let dir: string;
  beforeEach(async () => { dir = await makeFixture(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("flags prismaSeedConfigured when package.json declares prisma.seed", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", scripts: { dev: "next dev" }, dependencies: { prisma: "^5" },
      prisma: { seed: "node prisma/seed.js" },
    }));
    await write(dir, "prisma/schema.prisma", 'datasource db { provider = "postgresql" }');
    const d = await detect(dir);
    expect(d.prismaSchemas.length).toBeGreaterThan(0);
    expect(d.prismaSeedConfigured).toBe(true);
  });

  it("leaves prismaSeedConfigured false when no seed is configured", async () => {
    await write(dir, "package.json", JSON.stringify({
      name: "x", scripts: { dev: "next dev" }, dependencies: { prisma: "^5" },
    }));
    await write(dir, "prisma/schema.prisma", 'datasource db { provider = "postgresql" }');
    const d = await detect(dir);
    expect(d.prismaSeedConfigured).toBe(false);
  });
});
