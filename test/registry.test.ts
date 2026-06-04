import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  slugToFilename,
  repoSlugFromRemote,
  lookupRegistryRecipe,
  listRegistrySlugs,
  registryDir,
} from "../src/registry.js";
import { parseRecipe, recipeIsEmpty } from "../src/recipe.js";

describe("slugToFilename", () => {
  it("joins owner/repo with __ and lowercases", () => {
    expect(slugToFilename("Vercel", "Next.js")).toBe("vercel__next.js.yml");
  });
});

describe("repoSlugFromRemote", () => {
  it("parses https remotes (with and without .git)", () => {
    expect(repoSlugFromRemote("https://github.com/vercel/next.js.git")).toEqual({
      owner: "vercel",
      repo: "next.js",
    });
    expect(repoSlugFromRemote("https://github.com/denoland/deno")).toEqual({
      owner: "denoland",
      repo: "deno",
    });
  });

  it("parses ssh remotes", () => {
    expect(repoSlugFromRemote("git@github.com:facebook/react.git")).toEqual({
      owner: "facebook",
      repo: "react",
    });
  });

  it("tolerates a trailing slash", () => {
    expect(repoSlugFromRemote("https://gitlab.com/group/proj/")).toEqual({
      owner: "group",
      repo: "proj",
    });
  });

  it("returns null for non-URLs / empty", () => {
    expect(repoSlugFromRemote("")).toBeNull();
    expect(repoSlugFromRemote("not a url")).toBeNull();
  });
});

describe("lookupRegistryRecipe", () => {
  it("returns null when owner/repo missing", async () => {
    expect(await lookupRegistryRecipe(undefined, undefined)).toBeNull();
    expect(await lookupRegistryRecipe("nope", "does-not-exist-xyz")).toBeNull();
  });

  it("resolves a bundled recipe case-insensitively", async () => {
    const r = await lookupRegistryRecipe("DenoLand", "Deno");
    expect(r).not.toBeNull();
    expect(r!.notes.length).toBeGreaterThan(0);
  });
});

describe("shipped registry integrity", () => {
  it("every bundled .yml parses to a non-empty recipe", async () => {
    const dir = registryDir();
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".yml"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const raw = await fs.readFile(path.join(dir, f), "utf8");
      const recipe = parseRecipe(raw);
      expect(recipeIsEmpty(recipe), `${f} parses to nothing actionable`).toBe(false);
      // Filename must carry the <owner>__<repo> separator the loader keys on.
      expect(f, `${f} must use the owner__repo.yml shape`).toMatch(/__.+\.yml$/);
    }
  });

  it("listRegistrySlugs reports the seed repos as owner/repo", async () => {
    const slugs = await listRegistrySlugs();
    expect(slugs).toContain("denoland/deno");
    expect(slugs).toContain("vercel/next.js");
  });
});
