/**
 * Bundled recipe registry.
 *
 * Detection + lockfile reading get most repos right, but the popular repos a
 * newcomer actually picks (facebook/react, vercel/next.js, …) often have one
 * setup nuance no detector can infer — a codegen step, a non-obvious dev
 * command, a "Postgres must be running first" caveat. A committed .devhelp.yml
 * fixes that, but most repos don't ship one yet.
 *
 * So devhelp bundles a curated set of recipes keyed by `owner/repo`, shipped as
 * plain .devhelp.yml files under recipes/. When devhelp sets up a repo that has
 * no committed .devhelp.yml of its own, it falls back to the bundled recipe.
 * This is the reliability floor: the repos people pick most "just work".
 *
 * The bundled files are the exact same format a maintainer would commit, so a
 * registry entry doubles as a worked example — and `devhelp init` generates one.
 *
 * Trust: a bundled recipe carries the same trust as a committed one (its
 * postInstall commands run with the repo's own install scripts). We only ship
 * recipes for well-known repos with stable, verifiable setup steps, and a
 * repo's own committed .devhelp.yml always wins over the bundled one.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRecipe, recipeIsEmpty, type DevhelpRecipe } from "./recipe.js";

/**
 * A `/` can't appear in a filename, so `owner/repo` is stored as
 * `owner__repo.yml`. Lowercased so lookups are case-insensitive (GitHub slugs
 * are case-insensitive in practice).
 */
export function slugToFilename(owner: string, repo: string): string {
  return `${owner.toLowerCase()}__${repo.toLowerCase()}.yml`;
}

/**
 * Directory holding the bundled recipe files. Resolved relative to this module
 * so it works whether running from dist/ (published) or src/ (tsx/dev) — same
 * trick versions.ts uses to find package.json. recipes/ lives at the package
 * root and is included in the published `files` list.
 */
export function registryDir(): string {
  return fileURLToPath(new URL("../recipes/", import.meta.url));
}

/**
 * The bundled recipe for `owner/repo`, or null if none exists (or it parses to
 * nothing actionable). Never throws — a missing/unreadable registry must never
 * break a setup run.
 */
export async function lookupRegistryRecipe(
  owner: string | undefined,
  repo: string | undefined,
): Promise<DevhelpRecipe | null> {
  if (!owner || !repo) return null;
  const file = path.join(registryDir(), slugToFilename(owner, repo));
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null; // no bundled recipe for this repo
  }
  const recipe = parseRecipe(raw);
  return recipeIsEmpty(recipe) ? null : recipe;
}

/**
 * Parse an `owner/repo` slug out of a git remote URL (https or ssh form).
 * Returns null for anything that isn't a recognizable host/owner/repo URL, so
 * the registry lookup simply finds nothing rather than guessing.
 */
export function repoSlugFromRemote(
  url: string,
): { owner: string; repo: string } | null {
  if (!url) return null;
  // git@github.com:owner/repo.git  |  https://github.com/owner/repo(.git)
  const m = url
    .trim()
    .match(/(?:[/:])([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  if (!owner || !repo || owner.includes(".")) return null;
  return { owner, repo };
}

/** List the `owner/repo` slugs that have a bundled recipe. For docs/tests. */
export async function listRegistrySlugs(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(registryDir());
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith(".yml"))
    .map((e) => e.replace(/\.yml$/, "").replace("__", "/"))
    .sort();
}
