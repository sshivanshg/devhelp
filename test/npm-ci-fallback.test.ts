import { describe, it, expect } from "vitest";
import { npmCiFallback } from "../src/setup.js";

// `npm ci` aborts on an out-of-sync/absent lockfile; for onboarding we'd rather
// fall back to `npm install` once than dead-end. But the fallback must be narrow:
// only npm ci, only on a lockfile problem — never mask an unrelated failure.
describe("npmCiFallback", () => {
  it("falls back to npm install on EUSAGE", () => {
    expect(npmCiFallback("npm ci", "npm ERR! code EUSAGE\nnpm ERR! ...")).toBe("npm install");
  });

  it("falls back on the lockfile-out-of-sync message", () => {
    const msg = "npm ci can only install packages when your package.json and package-lock.json are in sync";
    expect(npmCiFallback("npm ci", msg)).toBe("npm install");
  });

  it("falls back on a missing-from-lock-file error", () => {
    expect(npmCiFallback("npm ci", "npm ERR! Missing: foo@1.2.3 from lock file")).toBe("npm install");
  });

  it("does NOT fall back on unrelated npm ci failures", () => {
    expect(npmCiFallback("npm ci", "npm ERR! network ETIMEDOUT")).toBeNull();
    expect(npmCiFallback("npm ci", "Error: build script failed (exit 1)")).toBeNull();
  });

  it("only applies to npm ci — never pnpm/yarn/bun/npm install", () => {
    expect(npmCiFallback("pnpm install", "EUSAGE")).toBeNull();
    expect(npmCiFallback("yarn install", "out of sync")).toBeNull();
    expect(npmCiFallback("npm install", "EUSAGE")).toBeNull();
  });
});
