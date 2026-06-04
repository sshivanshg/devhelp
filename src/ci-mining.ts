/**
 * CI-workflow mining.
 *
 * The single most reliable record of how to build and test a repo is its own
 * CI: the `run:` steps in .github/workflows/*.yml are commands that *must* pass
 * on every PR, so they're known-good by construction — more trustworthy than any
 * heuristic we could invent. We mine them for the canonical build/test commands
 * and use them to fill gaps detection left (e.g. a Makefile-based project whose
 * real test command is `make test`, which no package.json could tell us).
 *
 * Deliberately conservative: mining can only *fill an empty* devCommand /
 * testCommand / buildCommand — never override one a recipe or detection already
 * produced. CI is full of things that won't reproduce locally (matrix vars,
 * coverage uploaders, secrets), so we adopt only clean, recognizable commands
 * and skip the rest. We never touch the install command (lockfile reading is
 * already ground truth there) and never auto-run a mined command.
 *
 * Parsing is a hand-rolled scan of the small YAML subset GitHub Actions uses —
 * matching the project's no-extra-deps style. It must never throw: a malformed
 * or exotic workflow simply yields nothing.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Detected } from "./detect.js";

export interface CIMined {
  test?: string;
  build?: string;
  /** Every `run:` command we extracted, deduped — recorded in the run-log. */
  commands: string[];
}

const WORKFLOW_DIRS = [".github/workflows"];

/**
 * Extract the canonical build/test commands from a repo's CI workflows, or null
 * when there are no workflows / nothing useful. Never throws.
 */
export async function mineCI(dir: string): Promise<CIMined | null> {
  const files = await workflowFiles(dir);
  if (!files.length) return null;

  const commands: string[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const cmd of extractRunCommands(text)) {
      if (!commands.includes(cmd)) commands.push(cmd);
    }
  }
  if (!commands.length) return null;

  const usable = commands.filter(isReproducible);
  const test = usable.find((c) => classify(c) === "test");
  const build = usable.find((c) => classify(c) === "build");
  if (!test && !build && !commands.length) return null;
  return { test, build, commands };
}

/**
 * Fill devhelp's empty devCommand/testCommand/buildCommand from mined CI
 * commands. Returns the names of the fields it filled (for the run-log / a
 * progress line); empty when CI added nothing detection didn't already have.
 */
export function fillFromCI(d: Detected, ci: CIMined): string[] {
  const filled: string[] = [];
  if (!d.testCommand && ci.test) {
    d.testCommand = ci.test;
    filled.push("test");
  }
  if (!d.buildCommand && ci.build) {
    d.buildCommand = ci.build;
    filled.push("build");
  }
  return filled;
}

async function workflowFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const rel of WORKFLOW_DIRS) {
    const wfDir = path.join(dir, rel);
    let entries: string[];
    try {
      entries = await fs.readdir(wfDir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.endsWith(".yml") || e.endsWith(".yaml")) out.push(path.join(wfDir, e));
    }
  }
  return out.sort();
}

/**
 * Pull `run:` commands out of a workflow file. Handles both the inline form
 * (`run: cmd`) and block scalars (`run: |` / `run: >` followed by an indented
 * block). A block can hold several commands (one per line); we keep each line
 * that looks like a command, dropping comments and shell continuations.
 */
export function extractRunCommands(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!m) continue;
    const keyIndent = m[1].length;
    const rest = m[2].trim();

    if (rest === "|" || rest === ">" || /^[|>][+-]?$/.test(rest)) {
      // Block scalar: consume the more-indented lines that follow.
      let blockIndent: number | null = null;
      for (let j = i + 1; j < lines.length; j++) {
        const bl = lines[j];
        if (bl.trim() === "") continue;
        const indent = bl.length - bl.trimStart().length;
        if (indent <= keyIndent) break; // dedented out of the block
        if (blockIndent === null) blockIndent = indent;
        const content = bl.slice(Math.min(indent, blockIndent)).replace(/\s+$/, "");
        i = j;
        addCommand(out, content);
      }
    } else if (rest) {
      addCommand(out, stripWrappingQuotes(rest));
    }
  }
  return out;
}

function addCommand(out: string[], raw: string): void {
  const cmd = raw.trim();
  if (!cmd) return;
  if (cmd.startsWith("#")) return; // comment line inside a block
  // Continuation/heredoc noise — not a standalone command we can classify.
  if (cmd === "\\" || cmd.startsWith("set -") || cmd.startsWith("export ")) return;
  out.push(cmd);
}

function stripWrappingQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Whether a CI command stands a chance of reproducing on a contributor's
 * machine. Rejects the things CI does that local setup can't: matrix/secret
 * interpolation, coverage uploaders, GitHub-Action shims, and multi-concern
 * `&&` chains we can't safely re-run as a single "test"/"build" command.
 */
export function isReproducible(cmd: string): boolean {
  if (/\$\{\{/.test(cmd)) return false; // ${{ matrix.* }} / secrets
  if (/&&|\|\||;|\|/.test(cmd)) return false; // chained/pipelined — ambiguous intent
  if (/\b(codecov|coveralls|actions\/|softprops\/|uses:)\b/i.test(cmd)) return false;
  if (cmd.length > 120) return false;
  return true;
}

/** Classify a single command by what it does. Keyword-based, conservative. */
export function classify(cmd: string): "test" | "build" | "install" | "other" {
  const c = cmd.trim();
  // Test: the common runners across ecosystems.
  if (
    /^(npm|pnpm|yarn|bun)\s+(run\s+)?test\b/.test(c) ||
    /^(npx|pnpm dlx|bunx)\s+(jest|vitest|mocha|ava|playwright test|cypress)\b/.test(c) ||
    // Bare test-runner binaries (common in CI once deps are on PATH).
    /^(jest|vitest|mocha|ava|cypress|playwright)\b/.test(c) ||
    /^(pytest|tox|nox)\b/.test(c) ||
    /^python3?\s+-m\s+(pytest|unittest|tox)\b/.test(c) ||
    /^go\s+test\b/.test(c) ||
    /^cargo\s+test\b/.test(c) ||
    /^(bundle\s+exec\s+)?(rspec|rake\s+test)\b/.test(c) ||
    /^mix\s+test\b/.test(c) ||
    /^(\.\/)?(gradlew|mvnw)\s+.*\b(test|verify)\b/.test(c) ||
    /^(gradle|mvn)\s+.*\b(test|verify)\b/.test(c) ||
    /^make\s+(test|check)\b/.test(c) ||
    /^ctest\b/.test(c)
  ) {
    return "test";
  }
  // Build / compile.
  if (
    /^(npm|pnpm|yarn|bun)\s+(run\s+)?build\b/.test(c) ||
    /^(npx|pnpm dlx|bunx)\s+tsc\b/.test(c) ||
    /^tsc\b/.test(c) ||
    /^cargo\s+build\b/.test(c) ||
    /^go\s+build\b/.test(c) ||
    /^(\.\/)?(gradlew|mvnw)\s+.*\b(build|package|assemble)\b/.test(c) ||
    /^(gradle|mvn)\s+.*\b(build|package|assemble)\b/.test(c) ||
    /^make\s+(build|all)?\b/.test(c) ||
    /^mix\s+compile\b/.test(c)
  ) {
    return "build";
  }
  if (
    /^(npm\s+(ci|install)|pnpm\s+install|yarn\s+(install)?|bun\s+install)\b/.test(c) ||
    /^pip3?\s+install\b/.test(c) ||
    /^(poetry|uv|pipenv)\s+(install|sync)\b/.test(c) ||
    /^bundle\s+install\b/.test(c)
  ) {
    return "install";
  }
  return "other";
}
