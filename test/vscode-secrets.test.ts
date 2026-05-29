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
  it("quotes a repo-controlled template path to block injection", () => {
    const cmd = secretsCommand({ name: "1Password", cli: "op", template: "apps/$(touch pwned)/.env.example" });
    // The metacharacters must be single-quoted, not left to expand.
    expect(cmd).not.toContain("$(touch pwned)/.env.example -o");
    expect(cmd).toContain("'apps/$(touch pwned)/.env.example'");
  });
  it("downloads Doppler to a temp file then moves it (never truncates .env on failure)", () => {
    const cmd = secretsCommand({ name: "Doppler", cli: "doppler" });
    expect(cmd).toContain("doppler secrets download");
    expect(cmd).toMatch(/> \.env\.devhelp\.tmp && mv \.env\.devhelp\.tmp \.env/);
    expect(cmd).not.toMatch(/>\s*\.env(?![.\w])/); // must not redirect straight onto .env
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
