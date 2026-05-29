import { describe, it, expect } from "vitest";
import { wrapForRuntime } from "../src/setup.js";
import type { Detected } from "../src/detect.js";

// Regression guard: version tokens like "lts/*" must be quoted so zsh (the
// macOS default shell) doesn't glob-expand them and fail with "no matches found"
// before nvm ever sees the argument.
describe("wrapForRuntime — zsh glob safety", () => {
  it('quotes the node version in the nvm-use prelude', () => {
    const d = { nodeVersion: "lts/*" } as Detected;
    const wrapped = wrapForRuntime("npm install", d);
    expect(wrapped).toContain('nvm use "lts/*"');
    expect(wrapped).not.toContain("nvm use lts/*"); // unquoted form is the bug
  });

  it("only wraps node package-manager commands", () => {
    const d = { nodeVersion: "20" } as Detected;
    expect(wrapForRuntime("cargo build", d)).toBe("cargo build");
    expect(wrapForRuntime("pnpm install", d)).toContain('nvm use "20"');
  });
});

describe("wrapForRuntime — package-manager availability", () => {
  it("installs pnpm globally when absent, before running it", () => {
    const w = wrapForRuntime("pnpm install", { nodeVersion: "20" } as Detected);
    // Guarded: only install if pnpm isn't already on PATH (don't clobber a global).
    expect(w).toContain("command -v pnpm");
    expect(w).toContain("npm install -g pnpm");
    // The real command still runs after the bootstrap.
    expect(w).toMatch(/npm install -g pnpm[^;]*;\s*pnpm install/);
  });

  it("bootstraps yarn the same way", () => {
    const w = wrapForRuntime("yarn install", { nodeVersion: "20" } as Detected);
    expect(w).toContain("npm install -g yarn");
  });

  it("does not bootstrap npm/npx/bun (npm ships with Node; bun self-installs)", () => {
    const npm = wrapForRuntime("npm ci", { nodeVersion: "20" } as Detected);
    expect(npm).not.toContain("install -g");
    const bun = wrapForRuntime("bun install", { nodeVersion: "20" } as Detected);
    expect(bun).not.toContain("install -g");
  });
});

describe("wrapForRuntime — python interpreter availability", () => {
  it("loads pyenv for the venv-bootstrap path so python3 resolves", () => {
    const d = { pythonVersion: "3.11" } as Detected;
    const wrapped = wrapForRuntime("python3 -m venv .venv && . .venv/bin/activate && pip install -e .", d);
    expect(wrapped).toContain("pyenv init -");
    expect(wrapped).toContain("python3 -m venv .venv"); // original command preserved
    // Pins the highest installed patch matching the detected minor (3.11 → 3.11.x).
    expect(wrapped).toContain("grep -E '^3\\.11(\\.|$)'");
  });

  it("bootstraps uv/poetry/pipenv when the CLI is missing", () => {
    const d = { pythonVersion: "3.12" } as Detected;
    const uv = wrapForRuntime("uv sync", d);
    const poetry = wrapForRuntime("poetry install", d);
    const pipenv = wrapForRuntime("pipenv install", d);
    expect(uv).toContain("python3 -m pip install --user uv");
    expect(uv).toContain("uv sync");
    expect(poetry).toContain("python3 -m pip install --user poetry");
    expect(poetry).toContain("poetry install");
    expect(pipenv).toContain("python3 -m pip install --user pipenv");
    expect(pipenv).toContain("pipenv install");
  });

  it("does not bootstrap package-manager CLIs for plain venv commands", () => {
    const d = { pythonVersion: "3.12" } as Detected;
    const wrapped = wrapForRuntime("python3 -m venv .venv", d);
    expect(wrapped).not.toContain("pip install --user uv");
    expect(wrapped).not.toContain("pip install --user poetry");
    expect(wrapped).not.toContain("pip install --user pipenv");
  });
});
