import { describe, it, expect } from "vitest";
import { summarizeFailure, formatFatalError, computeStatus, remedyFor } from "../src/setup.js";
import type { Detected } from "../src/detect.js";
// eslint-disable-next-line no-control-regex
const noAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// Mirrors runShell's thrown-error format: a banner, the `$ <command>` line, and
// the captured output tail. summarizeFailure must recover the real command (sans
// runtime wrapper) and the most informative cause line.
function fail(command: string, tail: string): string {
  return `Command failed (exit 1):\n$ ${command}\n${tail}`;
}

const NVM = 'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}" && [ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh" && nvm use "lts/*" >/dev/null 2>&1 || nvm use default >/dev/null 2>&1;';

describe("summarizeFailure", () => {
  it("unwraps the nvm runtime preamble from the command", () => {
    const { command } = summarizeFailure(fail(`${NVM} npm ci`, "npm error code E404"));
    expect(command).toBe("npm ci");
  });

  it("leaves an unwrapped command untouched", () => {
    const { command } = summarizeFailure(fail("yarn prisma generate", "boom"));
    expect(command).toBe("yarn prisma generate");
  });

  it("prefers a descriptive cause over a bare error code", () => {
    const tail = [
      "npm error code E404",
      "npm error 404 Not Found - GET https://registry.npmjs.org/nope - Not found",
    ].join("\n");
    const { cause } = summarizeFailure(fail(`${NVM} npm ci`, tail));
    expect(cause).toContain("Not found");
  });

  it("surfaces the Prisma P1001 line as the cause", () => {
    const { cause } = summarizeFailure(
      fail(`${NVM} yarn prisma migrate deploy`, "Error: P1001: Can't reach database server at `localhost:5450`"),
    );
    expect(cause).toMatch(/can't reach database server/i);
  });

  it("falls back to the last line when nothing looks like an error", () => {
    const { cause } = summarizeFailure(fail("some-cmd", "line one\nline two"));
    expect(cause).toBe("line two");
  });

  it("strips ANSI color codes from the cause", () => {
    const { cause } = summarizeFailure(fail("uv sync", "\x1b[31m\x1b[1mError: package not found\x1b[0m"));
    expect(cause).toBe("Error: package not found");
    expect(cause).not.toMatch(/\x1b/);
  });

  it("ignores download/progress noise when choosing the cause", () => {
    const tail = ["Downloading uv (20.3MiB)", "Downloaded ruff", "error: failed to build wheel for cryptography"].join(
      "\n",
    );
    const { cause } = summarizeFailure(fail("uv sync", tail));
    expect(cause).toMatch(/failed to build wheel/);
  });

  it("surfaces the runner's reason when output is all progress noise", () => {
    const raw = "Command failed (timed out after 10m):\n$ uv sync\nDownloading uv (20.3MiB)\nDownloaded ruff";
    const { cause } = summarizeFailure(raw);
    expect(cause).toBe("timed out after 10m");
  });
});

describe("formatFatalError", () => {
  it("diagnoses a transient git clone failure cleanly (no progress spam)", () => {
    const gitSpam = [
      "Cloning into '/tmp/fastapi'...",
      "remote: Counting objects: 100% (3207/3207), done.",
      "remote: Compressing objects: 100% (2717/2717), done.",
      "Receiving objects:   9% (315/3207), 3.89 MiB | 16.00 KiB/s",
      "error: RPC failed; curl 56 Recv failure: Connection reset by peer",
      "fatal: early EOF",
      "fatal: fetch-pack: invalid index-pack output",
    ].join("\n");
    const out = noAnsi(formatFatalError(new Error(gitSpam)));
    expect(out).toMatch(/couldn't finish/i);
    expect(out).toMatch(/network/i); // recovery rule cause
    expect(out).toMatch(/fix:/); // always actionable
    expect(out).not.toMatch(/Receiving objects|remote: Counting/); // no spam
  });

  it("always produces a fix line, even for an unknown error", () => {
    const out = noAnsi(formatFatalError(new Error("something weird happened")));
    expect(out).toMatch(/✗ something weird happened/);
  });
});

describe("computeStatus", () => {
  it("prioritizes a recorded critical failure over empty detection", () => {
    expect(computeStatus({ criticalStepFailed: true, nothingDetected: true } as any)).toBe("INCOMPLETE");
  });
});

describe("remedyFor — step-name hints don't misfire on substrings", () => {
  const d = { installCommands: ["cargo build"] } as Detected;

  it("does not suggest installing Go for a failed `cargo build` (carGO substring)", () => {
    const fixes = remedyFor({ name: "Installing deps · cargo build" } as any, d);
    expect(fixes.join(" ")).not.toContain("go.dev"); // the old bug
    // A deps failure means the runtime is fine — point at the install command.
    expect(fixes.join(" ")).toContain("cargo build");
  });

  it("still gives the right runtime hint for a real runtime-install failure", () => {
    expect(remedyFor({ name: "Installing Rust stable" } as any, undefined).join(" ")).toContain("rustup.rs");
    expect(remedyFor({ name: "Installing Go (latest ≥ 1.22)" } as any, undefined).join(" ")).toContain("go.dev");
    expect(remedyFor({ name: "Installing Node 20" } as any, undefined).join(" ")).toContain("nodejs.org");
  });

  it("prefers a matched recovery remediation when present", () => {
    const fixes = remedyFor({ name: "Installing deps · npm ci", recovery: "Free up disk space" } as any, d);
    expect(fixes[0]).toBe("Free up disk space");
  });
});
