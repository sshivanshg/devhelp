/**
 * Project-specific recipes: .devhelp.yml
 *
 * Detection covers the common case, but some repos have a setup step no
 * detector can infer (a `make seed`, a codegen script). A maintainer can drop a
 * .devhelp.yml in the repo to declare those steps and override the surfaced
 * dev/test/build commands. devhelp merges it into the playbook.
 *
 * Trust note: postInstall commands run with the same trust as the repo's own
 * install scripts (npm install already runs arbitrary postinstall hooks). They
 * are surfaced as individual, named steps so they're never hidden, and --dry-run
 * prints them without executing.
 *
 * We parse a deliberately small YAML subset (scalars + string lists) by hand,
 * matching the project's no-extra-deps style — no YAML library is pulled in.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const RECIPE_FILENAMES = [".devhelp.yml", ".devhelp.yaml"];

export interface DevhelpRecipe {
  postInstall: string[];
  dev?: string;
  test?: string;
  build?: string;
  /**
   * Free-text reminders surfaced in the final panel — e.g. "Postgres must be
   * running: docker compose up -d db". The thing a maintainer would tell a
   * first-time contributor that no detector can infer.
   */
  notes: string[];
}

const SCALAR_KEYS = new Set(["dev", "test", "build"]);
// Maps a lowercased YAML list key to the recipe field it fills.
const LIST_KEYS: Record<string, "postInstall" | "notes"> = {
  postinstall: "postInstall",
  notes: "notes",
};

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Strip a trailing ` # comment`, but not a `#` inside a quoted value. */
function stripComment(line: string): string {
  if (/['"]/.test(line)) return line; // be conservative when quotes are present
  const i = line.indexOf(" #");
  return i >= 0 ? line.slice(0, i) : line;
}

/** Parse the supported subset. Unknown keys are ignored, not an error. */
export function parseRecipe(text: string): DevhelpRecipe {
  const recipe: DevhelpRecipe = { postInstall: [], notes: [] };
  let currentList: "postInstall" | "notes" | null = null;

  for (const raw of text.split("\n")) {
    const line = stripComment(raw).replace(/\s+$/, "");
    if (!line.trim()) continue;

    // List item: indented "- value"
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && currentList) {
      const v = unquote(listItem[1]);
      if (v) recipe[currentList].push(v);
      continue;
    }

    // key: value  (top-level only — no nested maps in this subset)
    const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2];

    const listField = LIST_KEYS[key];
    if (listField) {
      currentList = listField;
      // Inline list form: "postInstall: [a, b]" — support the simple case too.
      const inline = value.match(/^\[(.*)\]$/);
      if (inline) {
        for (const part of inline[1].split(",")) {
          const v = unquote(part);
          if (v) recipe[listField].push(v);
        }
        currentList = null;
      }
      continue;
    }

    currentList = null;
    if (SCALAR_KEYS.has(key) && value) {
      (recipe as unknown as Record<string, unknown>)[key] = unquote(value);
    }
  }
  return recipe;
}

/** True when the recipe actually declares anything actionable. */
export function recipeIsEmpty(r: DevhelpRecipe): boolean {
  return r.postInstall.length === 0 && r.notes.length === 0 && !r.dev && !r.test && !r.build;
}

/** Load and parse the repo's recipe file, or null if none / unparseable. */
export async function loadRecipe(dir: string): Promise<DevhelpRecipe | null> {
  for (const name of RECIPE_FILENAMES) {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(dir, name), "utf8");
    } catch {
      continue;
    }
    const recipe = parseRecipe(raw);
    return recipeIsEmpty(recipe) ? null : recipe;
  }
  return null;
}
