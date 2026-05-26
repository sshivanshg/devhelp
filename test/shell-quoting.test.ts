import { describe, it, expect } from "vitest";
import { wrapForRuntime } from "../src/offline.js";
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
