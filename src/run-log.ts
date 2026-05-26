import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const MAX_RUNS = 100;

export interface RunLogPayload {
  timestamp: string;
  request: string;
  cwd: string;
  projectDir: string;
  dryRun: boolean;
  status: "READY" | "INCOMPLETE" | "UNSUPPORTED" | "INFORM";
  detected?: Record<string, unknown>;
  executedSteps: string[];
  failedSteps: { name: string; error: string; recovery?: string }[];
  warnings: string[];
  verify?: { name: string; ok: boolean; detail: string }[];
  env: {
    platform: NodeJS.Platform;
    arch: string;
    nodeVersion: string;
  };
}

/**
 * Persist a JSON run record at ~/.devhelp/runs/<ISO-timestamp>.json.
 * Returns the absolute path, or null on failure (logging must never block
 * the actual run from finishing).
 */
export async function writeRunLog(payload: RunLogPayload): Promise<string | null> {
  try {
    const dir = path.join(os.homedir(), ".devhelp", "runs");
    await fs.mkdir(dir, { recursive: true });
    const stamp = payload.timestamp.replace(/[:.]/g, "-");
    const file = path.join(dir, `${stamp}.json`);
    await fs.writeFile(file, JSON.stringify(payload, null, 2));
    await pruneOldRuns(dir);
    return file;
  } catch {
    return null;
  }
}

async function pruneOldRuns(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir);
    const runs = entries.filter((e) => e.endsWith(".json")).sort();
    const excess = runs.length - MAX_RUNS;
    if (excess <= 0) return;
    for (const old of runs.slice(0, excess)) {
      await fs.unlink(path.join(dir, old)).catch(() => {});
    }
  } catch {
    /* nothing to prune, ignore */
  }
}
