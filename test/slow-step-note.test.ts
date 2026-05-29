import { describe, it, expect } from "vitest";
import { slowStepNote } from "../src/setup.js";

// The note exists to stop a first-time user Ctrl-Cing a long, quiet step
// (pyenv compile, big install). It must be honest — no fabricated ETAs — and
// stay quiet when a step isn't actually slow.
describe("slowStepNote", () => {
  it("warns that Node is downloading", () => {
    expect(slowStepNote("node")).toMatch(/download/i);
  });

  it("warns that Python compiles from source and takes minutes", () => {
    const note = slowStepNote("python");
    expect(note).toMatch(/compil/i);
    expect(note).toMatch(/minute/i);
  });

  it("warns about install time only for monorepos", () => {
    expect(slowStepNote("deps", "turbo")).toMatch(/monorepo/i);
    expect(slowStepNote("deps", "pnpm-workspaces")).toMatch(/minute/i);
    expect(slowStepNote("deps", undefined)).toBe("");
  });

  it("never fabricates a specific ETA", () => {
    for (const note of [slowStepNote("node"), slowStepNote("python"), slowStepNote("deps", "nx")]) {
      expect(note).not.toMatch(/\b\d+\s*(s|sec|second|min|minute)s?\b/i);
    }
  });
});
