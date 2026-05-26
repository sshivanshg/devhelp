/**
 * Reproducible-setup lockfile.
 *
 * Detection resolves concrete runtime versions (Node 20.11.1, Python 3.13, …)
 * and the package manager, then throws them away after the run. Writing them to
 * .devhelp.lock turns a one-shot setup into a shareable, reproducible artifact:
 * a teammate (or CI) can see exactly what devhelp resolved, and a future run can
 * be checked against it.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Detected } from "./detect.js";
import { pkgVersion } from "./versions.js";

export const LOCK_FILENAME = ".devhelp.lock";

export interface DevhelpLock {
  lockfileVersion: 1;
  generatedBy: string;
  generatedAt: string;
  runtimes: Record<string, string>;
  packageManager?: string;
  installCommands: string[];
}

// Maps a Detected field to the runtime name written in the lock. Order here is
// the order they appear in the file. Erlang rides along with Elixir below.
const RUNTIME_FIELDS: [keyof Detected, string][] = [
  ["nodeVersion", "node"],
  ["bunVersion", "bun"],
  ["pythonVersion", "python"],
  ["rustToolchain", "rust"],
  ["goVersion", "go"],
  ["rubyVersion", "ruby"],
  ["phpVersion", "php"],
  ["elixirVersion", "elixir"],
  ["erlangVersion", "erlang"],
  ["javaVersion", "java"],
  ["dotnetVersion", "dotnet"],
  ["dartSdkVersion", "dart"],
  ["denoVersion", "deno"],
  ["swiftVersion", "swift"],
  ["ghcVersion", "ghc"],
  ["scalaVersion", "scala"],
  ["clojureVersion", "clojure"],
  ["rVersion", "r"],
  ["juliaVersion", "julia"],
  ["zigVersion", "zig"],
  ["ocamlVersion", "ocaml"],
  ["bazelVersion", "bazel"],
];

/** Build the lock object from a detection result. Pure — easy to unit test. */
export function buildLock(d: Detected, version: string, now = new Date()): DevhelpLock {
  const runtimes: Record<string, string> = {};
  for (const [field, name] of RUNTIME_FIELDS) {
    // Node that's only present for tooling, or shadowed by a Bun runtime, isn't
    // a runtime the project actually runs on — don't pin it.
    if (field === "nodeVersion" && (d.nodeIsToolingOnly || d.bunIsRuntime)) continue;
    if (field === "bunVersion" && !d.bunIsRuntime) continue;
    const v = d[field];
    if (typeof v === "string" && v) runtimes[name] = v;
  }
  return {
    lockfileVersion: 1,
    generatedBy: `devhelp ${version}`,
    generatedAt: now.toISOString(),
    runtimes,
    packageManager: d.pkgManager,
    installCommands: [...d.installCommands],
  };
}

/** Describe how an existing lock differs from a freshly-detected one. Pure. */
export function diffLocks(existing: DevhelpLock, current: DevhelpLock): string[] {
  const out: string[] = [];
  const keys = [...new Set([...Object.keys(existing.runtimes), ...Object.keys(current.runtimes)])].sort();
  for (const k of keys) {
    const e = existing.runtimes[k];
    const c = current.runtimes[k];
    if (e && c && e !== c) out.push(`${k}: lock ${e} → detected ${c}`);
    else if (e && !c) out.push(`${k}: in lock (${e}) but no longer detected`);
    else if (!e && c) out.push(`${k}: newly detected (${c}), not in lock`);
  }
  if (
    existing.packageManager &&
    current.packageManager &&
    existing.packageManager !== current.packageManager
  ) {
    out.push(`packageManager: lock ${existing.packageManager} → detected ${current.packageManager}`);
  }
  return out;
}

/** Read an existing .devhelp.lock, or null if absent/unparseable. */
export async function readLock(dir: string): Promise<DevhelpLock | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, LOCK_FILENAME), "utf8")) as DevhelpLock;
  } catch {
    return null;
  }
}

/** Drift between a present .devhelp.lock and current detection. [] if no lock. */
export async function checkLockDrift(dir: string, d: Detected): Promise<string[]> {
  const existing = await readLock(dir);
  if (!existing) return [];
  return diffLocks(existing, buildLock(d, pkgVersion()));
}

/**
 * Write .devhelp.lock into the project directory. Returns the path written, or
 * null if there was nothing worth pinning. Overwrites freely — the file is a
 * generated, deterministic artifact.
 */
export async function writeDevhelpLock(projectDir: string, d: Detected): Promise<string | null> {
  const lock = buildLock(d, pkgVersion());
  if (Object.keys(lock.runtimes).length === 0 && lock.installCommands.length === 0) {
    return null;
  }
  const file = path.join(projectDir, LOCK_FILENAME);
  await fs.writeFile(file, JSON.stringify(lock, null, 2) + "\n");
  return file;
}
