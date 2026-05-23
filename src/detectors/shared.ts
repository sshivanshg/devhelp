/**
 * Filesystem + manifest-reading primitives shared by every ecosystem detector.
 *
 * These are the building blocks. When a new detector is extracted into
 * src/detectors/<name>.ts, it imports from here. Currently src/detect.ts also
 * uses these; over time, detect.ts shrinks to just an orchestrator while each
 * ecosystem moves into its own file under src/detectors/.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

export async function tryRead(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function fileExistsAny(dir: string, files: string[]): Promise<string | null> {
  for (const f of files) {
    if (await exists(path.join(dir, f))) return f;
  }
  return null;
}

export async function listDirs(parent: string): Promise<string[]> {
  const entries = await fs.readdir(parent, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/**
 * Minimal JSONC stripper: removes // line and /* block *\/ comments outside strings.
 * Used by .devcontainer/devcontainer.json and deno.jsonc which both allow comments.
 */
export function stripJsonComments(s: string): string {
  let out = "";
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    const next = s[i + 1];
    if (c === '"') {
      out += c;
      i++;
      while (i < n) {
        out += s[i];
        if (s[i] === "\\") {
          out += s[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (s[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && s[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
