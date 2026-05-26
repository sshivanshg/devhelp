/**
 * .vscode/launch.json generation.
 *
 * Once the runtime is set up, the next friction point is "how do I actually run
 * this under the debugger." We generate a minimal launch config from the
 * detected framework / dev command. We never overwrite an existing launch.json
 * — the user's own config always wins.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Detected } from "./detect.js";

interface LaunchConfig {
  version: "0.2.0";
  configurations: Record<string, unknown>[];
}

/**
 * Build a launch config for the detected stack, or null if there's nothing
 * sensible to launch. Pure — unit-testable.
 */
export function buildLaunchConfig(d: Detected): LaunchConfig | null {
  const configs: Record<string, unknown>[] = [];

  // Python web frameworks → debugpy.
  if (d.framework?.name === "Django") {
    configs.push({
      name: "devhelp: Django",
      type: "debugpy",
      request: "launch",
      program: "${workspaceFolder}/manage.py",
      args: ["runserver"],
      django: true,
    });
  } else if (d.framework?.name === "FastAPI" || d.framework?.name === "Flask") {
    configs.push({
      name: `devhelp: ${d.framework.name}`,
      type: "debugpy",
      request: "launch",
      module: d.framework.name === "FastAPI" ? "uvicorn" : "flask",
      args: d.framework.name === "FastAPI" ? ["main:app", "--reload"] : ["run"],
      jinja: true,
    });
  }

  // Anything with a dev command → a node-terminal launch that just runs it.
  // node-terminal works for any shell command and gives a JS debug terminal.
  if (d.devCommand) {
    configs.push({
      name: "devhelp: dev",
      type: "node-terminal",
      request: "launch",
      command: d.devCommand,
      cwd: "${workspaceFolder}",
    });
  } else if (d.testCommand) {
    configs.push({
      name: "devhelp: test",
      type: "node-terminal",
      request: "launch",
      command: d.testCommand,
      cwd: "${workspaceFolder}",
    });
  }

  if (configs.length === 0) return null;
  return { version: "0.2.0", configurations: configs };
}

/**
 * Write .vscode/launch.json, unless one already exists. Returns the path
 * written, "exists" if left alone, or null if there was nothing to generate.
 */
export async function writeVscodeLaunch(
  projectDir: string,
  d: Detected,
): Promise<string | "exists" | null> {
  const config = buildLaunchConfig(d);
  if (!config) return null;
  const file = path.join(projectDir, ".vscode", "launch.json");
  try {
    await fs.access(file);
    return "exists"; // never clobber the user's own config
  } catch {
    /* doesn't exist — write it */
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(config, null, 2) + "\n");
  return file;
}
