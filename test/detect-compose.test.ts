import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detect } from "../src/detect.js";

async function makeFixture(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "devhelp-compose-"));
}
async function write(dir: string, file: string, content: string): Promise<void> {
  const full = path.join(dir, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

const APP_STACK = `services:
  web:
    build:
      context: .
    ports:
      - 3000:3000
  database:
    image: postgres
`;

const PG_SERVICE = `services:
  postgres:
    image: postgres:18
    ports:
      - "5450:5432"
`;

describe("service compose selection", () => {
  let dir: string;
  beforeEach(async () => { dir = await makeFixture(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("excludes app-stack composes (build:) and keeps pure service deps", async () => {
    await write(dir, "package.json", JSON.stringify({ name: "x", workspaces: ["packages/*"] }));
    await write(dir, "docker-compose.yml", APP_STACK);
    await write(dir, "packages/prisma/docker-compose.yml", PG_SERVICE);
    const d = await detect(dir);
    expect(d.dockerComposeFiles).toContain("docker-compose.yml");
    expect(d.serviceComposeFiles).toEqual(["packages/prisma/docker-compose.yml"]);
  });

  it("falls back to all composes when every one builds the app", async () => {
    await write(dir, "package.json", JSON.stringify({ name: "x" }));
    await write(dir, "docker-compose.yml", APP_STACK);
    const d = await detect(dir);
    expect(d.serviceComposeFiles).toEqual(["docker-compose.yml"]);
  });

  it("flags a local DB from a custom-port connection URL", async () => {
    await write(dir, "package.json", JSON.stringify({ name: "x" }));
    await write(dir, ".env.example", 'DATABASE_URL="postgresql://postgres:@localhost:5450/app"\n');
    const d = await detect(dir);
    expect(d.envHasLocalDb).toBe(true);
  });
});
