import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildLaunchConfig } from "../src/vscode.js";
import { detectSecretsProvider, secretsCommand } from "../src/secrets.js";
import type { Detected } from "../src/detect.js";

function base(overrides: Partial<Detected>): Detected {
  return {
    projectDir: "/x", envTemplates: [], prismaSchemas: [], prismaSeedConfigured: false,
    hasPlaywright: false, hasHusky: false, hasSubmodules: false, installCommands: [],
    migrationCommands: [], nodeIsToolingOnly: false, isLibrary: false, rustIsOptional: false,
    goNeedsManualInstall: false, dockerComposeFiles: [], envHasLocalDb: false, unrecognizedManifests: [],
    ...overrides,
  };
}

describe("buildLaunchConfig", () => {
  it("creates a node-terminal config from the dev command", () => {
    const c = buildLaunchConfig(base({ devCommand: "pnpm run dev" }))!;
    expect(c.version).toBe("0.2.0");
    expect(c.configurations[0]).toMatchObject({ type: "node-terminal", command: "pnpm run dev" });
  });

  it("creates a debugpy config for Django", () => {
    const c = buildLaunchConfig(base({ framework: { name: "Django" }, devCommand: "python manage.py runserver" }))!;
    expect(c.configurations.some((x) => x.type === "debugpy")).toBe(true);
  });

  it("returns null when there is nothing to launch", () => {
    expect(buildLaunchConfig(base({}))).toBeNull();
  });
});

describe("secretsCommand", () => {
  it("uses op inject for 1Password", () => {
    expect(secretsCommand({ name: "1Password", cli: "op", template: ".env.example" }))
      .toBe("op inject -i .env.example -o .env");
  });
  it("uses doppler download for Doppler", () => {
    expect(secretsCommand({ name: "Doppler", cli: "doppler" })).toContain("doppler secrets download");
  });
});

describe("detectSecretsProvider", () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "devhelp-sec-")); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("detects 1Password from op:// refs in a template", async () => {
    await fs.writeFile(path.join(dir, ".env.example"), "API_KEY=op://vault/item/key\n");
    const p = await detectSecretsProvider(dir, [".env.example"]);
    expect(p?.name).toBe("1Password");
    expect(p?.template).toBe(".env.example");
  });

  it("detects Doppler from doppler.yaml", async () => {
    await fs.writeFile(path.join(dir, ".env.example"), "API_KEY=changeme\n");
    await fs.writeFile(path.join(dir, "doppler.yaml"), "setup:\n  project: x\n");
    const p = await detectSecretsProvider(dir, [".env.example"]);
    expect(p?.name).toBe("Doppler");
  });

  it("returns null when no provider is present", async () => {
    await fs.writeFile(path.join(dir, ".env.example"), "API_KEY=changeme\n");
    expect(await detectSecretsProvider(dir, [".env.example"])).toBeNull();
  });
});
