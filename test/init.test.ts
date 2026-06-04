import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateRecipeYaml, adoptionSnippets, runInit } from "../src/init.js";
import { parseRecipe } from "../src/recipe.js";
import type { Detected } from "../src/detect.js";

function detected(over: Partial<Detected>): Detected {
  return {
    projectDir: "/x",
    envTemplates: [],
    prismaSchemas: [],
    prismaSeedConfigured: false,
    hasPlaywright: false,
    hasHusky: false,
    hasSubmodules: false,
    installCommands: [],
    nodeIsToolingOnly: false,
    isLibrary: false,
    migrationCommands: [],
    rustIsOptional: false,
    goNeedsManualInstall: false,
    dockerComposeFiles: [],
    serviceComposeFiles: [],
    envHasLocalDb: false,
    unrecognizedManifests: [],
    ...over,
  };
}

describe("generateRecipeYaml", () => {
  it("emits detected commands live and parses back to the same commands", () => {
    const yaml = generateRecipeYaml(
      detected({ devCommand: "pnpm dev", testCommand: "pnpm test", buildCommand: "pnpm build" }),
    );
    const r = parseRecipe(yaml);
    expect(r.dev).toBe("pnpm dev");
    expect(r.test).toBe("pnpm test");
    expect(r.build).toBe("pnpm build");
    // postInstall/notes are commented scaffolding, not active
    expect(r.postInstall).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it("comments out commands it couldn't detect (no empty keys)", () => {
    const yaml = generateRecipeYaml(detected({ testCommand: "pytest" }));
    const r = parseRecipe(yaml);
    expect(r.test).toBe("pytest");
    expect(r.dev).toBeUndefined();
    expect(r.build).toBeUndefined();
    expect(yaml).toContain("# dev:");
  });

  it("quotes a command containing a colon", () => {
    const yaml = generateRecipeYaml(detected({ devCommand: "run: thing" }));
    expect(parseRecipe(yaml).dev).toBe("run: thing");
  });
});

describe("adoptionSnippets", () => {
  it("uses the repo slug in the command example when known", () => {
    const { badge, contributing } = adoptionSnippets("vercel/next.js");
    expect(badge).toContain("img.shields.io");
    expect(contributing).toContain("npx devhelp-cli vercel/next.js");
  });
  it("falls back to a generic command when slug is unknown", () => {
    expect(adoptionSnippets("").contributing).toContain('npx devhelp-cli "set up this project"');
  });
});

describe("runInit (fixture)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "devhelp-init-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes a .devhelp.yml for a recognized stack", async () => {
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "x", scripts: { dev: "vite", test: "vitest" } }),
    );
    await fs.writeFile(path.join(dir, "package-lock.json"), "{}");

    const code = await runInit({ cwd: dir, json: true });
    expect(code).toBe(0);
    const written = await fs.readFile(path.join(dir, ".devhelp.yml"), "utf8");
    expect(parseRecipe(written).test).toBeTruthy();
  });

  it("refuses to overwrite an existing recipe without --force", async () => {
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { dev: "vite" } }));
    await fs.writeFile(path.join(dir, "package-lock.json"), "{}");
    await fs.writeFile(path.join(dir, ".devhelp.yml"), "dev: keep-me\n");

    const code = await runInit({ cwd: dir, json: true });
    expect(code).toBe(1);
    expect(await fs.readFile(path.join(dir, ".devhelp.yml"), "utf8")).toBe("dev: keep-me\n");

    const forced = await runInit({ cwd: dir, json: true, force: true });
    expect(forced).toBe(0);
    expect(await fs.readFile(path.join(dir, ".devhelp.yml"), "utf8")).not.toBe("dev: keep-me\n");
  });

  it("exits non-zero for an unrecognized stack", async () => {
    await fs.writeFile(path.join(dir, "notes.txt"), "no manifest here");
    expect(await runInit({ cwd: dir, json: true })).toBe(1);
  });
});
