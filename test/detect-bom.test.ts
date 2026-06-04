import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detect, isDetectionEmpty } from "../src/detect.js";

// Regression: a UTF-8 BOM (U+FEFF), prepended by Visual Studio and some Windows
// editors, made JSON.parse throw and the catch silently bail — disabling Node /
// framework detection for an otherwise-normal manifest. parseJson strips it.

async function makeFixture(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "devhelp-bom-"));
}

const BOM = "﻿";

async function write(dir: string, file: string, content: string): Promise<void> {
  const full = path.join(dir, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

describe("detect — BOM-prefixed manifests (regression: silent no-detect)", () => {
  let dir: string;
  beforeEach(async () => { dir = await makeFixture(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("still detects Node + framework when package.json has a UTF-8 BOM", async () => {
    await write(dir, "package.json", BOM + JSON.stringify({
      name: "bomtest", dependencies: { next: "^14" }, scripts: { dev: "next dev" },
    }));
    await write(dir, "next.config.js", "module.exports = {}");
    await write(dir, ".nvmrc", "20.11.0\n");

    const d = await detect(dir);

    expect(isDetectionEmpty(d)).toBe(false);
    expect(d.nodeVersion).toBe("20.11.0");
    expect(d.framework?.name).toBe("Next.js");
  });

  it("reads packageManager from a BOM-prefixed package.json", async () => {
    await write(dir, "package.json", BOM + JSON.stringify({
      name: "x", packageManager: "pnpm@9.0.0", scripts: { dev: "vite" },
    }));
    await write(dir, "pnpm-lock.yaml", "");

    const d = await detect(dir);

    expect(d.pkgManager).toBe("pnpm");
  });
});
