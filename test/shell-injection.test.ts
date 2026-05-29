import { describe, it, expect } from "vitest";
import { shellQuote } from "../src/platform.js";
import { composeUpCommand, coursierArch } from "../src/setup.js";

// Repo-derived file paths (Prisma schema paths, compose filenames, env
// templates) get interpolated into the `bash -lc` strings devhelp runs. A
// cloned repo controls its own directory names, so an attacker can name a dir
// `$(...)` / `;` / backticks. These guard that such paths can't break out.
describe("shellQuote", () => {
  it("passes clean filename/path tokens through unquoted (readable panels)", () => {
    expect(shellQuote("docker-compose.yml")).toBe("docker-compose.yml");
    expect(shellQuote("apps/web/prisma/schema.prisma")).toBe("apps/web/prisma/schema.prisma");
    expect(shellQuote("/Users/dev/repo/prisma/schema.prisma")).toBe(
      "/Users/dev/repo/prisma/schema.prisma",
    );
  });

  it("single-quotes command substitution so it cannot execute", () => {
    expect(shellQuote("apps/$(touch pwned)/schema.prisma")).toBe(
      "'apps/$(touch pwned)/schema.prisma'",
    );
    expect(shellQuote("a`id`b")).toBe("'a`id`b'");
  });

  it("quotes separators, spaces, and redirections", () => {
    expect(shellQuote("a; rm -rf ~")).toBe("'a; rm -rf ~'");
    expect(shellQuote("with space.yml")).toBe("'with space.yml'");
    expect(shellQuote("a > b")).toBe("'a > b'");
    expect(shellQuote("a && b")).toBe("'a && b'");
  });

  it("escapes embedded single quotes correctly", () => {
    // foo'bar  ->  'foo'\''bar'
    expect(shellQuote("foo'bar")).toBe(`'foo'\\''bar'`);
  });

  it("turns an empty value into a valid empty argument", () => {
    expect(shellQuote("")).toBe("''");
  });
});

describe("composeUpCommand — injection-safe", () => {
  it("leaves a normal compose filename unquoted", () => {
    expect(composeUpCommand("docker compose", "docker-compose.yml", true)).toBe(
      "docker compose -f docker-compose.yml up -d --wait",
    );
  });

  it("quotes a malicious monorepo compose path", () => {
    const cmd = composeUpCommand("docker compose", "apps/$(reboot)/compose.yml", false);
    expect(cmd).toBe("docker compose -f 'apps/$(reboot)/compose.yml' up -d");
  });
});

// Coursier (Scala) ships per-arch launchers; the x86_64 one crashes the ELF
// loader on arm64 — same class as the hardcoded-amd64 Go bug A fixed.
describe("coursierArch", () => {
  it("selects aarch64 on arm64", () => {
    expect(coursierArch("arm64")).toBe("aarch64");
  });
  it("falls back to x86_64 elsewhere", () => {
    expect(coursierArch("x64")).toBe("x86_64");
    expect(coursierArch("ia32")).toBe("x86_64");
  });
});
