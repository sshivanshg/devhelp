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

// Real-install regression: a runtime installed in one step lands in a location
// the next fresh `bash -lc` doesn't have on PATH. These were only ever dry-run
// tested, so the command-not-found failures never surfaced.
describe("wrapForRuntime — runtime PATH for go/rust/ruby", () => {
  it("puts /usr/local/go/bin on PATH for go commands (Linux clean-machine)", () => {
    const d = { goVersion: "1.22" } as Detected;
    const wrapped = wrapForRuntime("go mod download", d);
    expect(wrapped).toContain("/usr/local/go/bin");
    expect(wrapped).toContain("go mod download"); // original command preserved
    // Guarded so it's a no-op when go is already on PATH (brew/macOS).
    expect(wrapped).toContain("[ -d /usr/local/go/bin ]");
  });

  it("sources ~/.cargo/env for cargo commands", () => {
    const d = { rustToolchain: "stable" } as Detected;
    const wrapped = wrapForRuntime("cargo build", d);
    expect(wrapped).toContain(".cargo/env");
    expect(wrapped).toContain("cargo build");
  });

  it("initializes rbenv for ruby package-manager commands", () => {
    const d = { rubyVersion: "3.3.0" } as Detected;
    for (const cmd of ["bundle install", "gem install rails", "rake db:migrate"]) {
      const wrapped = wrapForRuntime(cmd, d);
      expect(wrapped).toContain("rbenv init -");
      expect(wrapped).toContain(cmd);
    }
  });

  it("puts ~/.bun/bin on PATH for bun commands (clean-machine, no Node)", () => {
    // A bun-runtime project has no nodeVersion, so it never hit the nvm branch.
    const wrapped = wrapForRuntime("bun install", { bunIsRuntime: true } as Detected);
    expect(wrapped).toContain(".bun/bin");
    expect(wrapped).toContain("bun install");
    expect(wrapped).not.toContain("nvm use"); // bun is self-contained, no Node
  });

  it("puts ~/.deno/bin on PATH for deno commands", () => {
    const wrapped = wrapForRuntime("deno cache", { denoVersion: "latest" } as Detected);
    expect(wrapped).toContain(".deno/bin");
    expect(wrapped).toContain("deno cache");
  });

  it("leaves commands untouched when the runtime isn't detected", () => {
    expect(wrapForRuntime("go mod download", {} as Detected)).toBe("go mod download");
    expect(wrapForRuntime("cargo build", {} as Detected)).toBe("cargo build");
    expect(wrapForRuntime("bundle install", {} as Detected)).toBe("bundle install");
    expect(wrapForRuntime("deno cache", {} as Detected)).toBe("deno cache");
  });
});

// Same clean-machine PATH class for the best-effort ecosystems installed via
// asdf / SDKMAN / Coursier / GHCup / dotnet-install / juliaup / opam, and Zig's
// ~/.local/share unpack. Each was previously only dry-run swept, so a runtime
// installed in one step but absent from the next fresh `bash -lc`'s PATH would
// die with command-not-found. Each preamble is self-guarded — a no-op when the
// tool is already on PATH (brew/macOS) or its manager isn't installed.
describe("wrapForRuntime — PATH for best-effort ecosystems", () => {
  it("exposes asdf shims for elixir mix commands", () => {
    const d = { elixirVersion: "1.16" } as Detected;
    for (const cmd of ["mix deps.get", "mix ecto.setup"]) {
      const w = wrapForRuntime(cmd, d);
      expect(w).toContain(".asdf/shims");
      expect(w).toContain(cmd);
    }
  });

  it("sources SDKMAN for maven/gradle (incl. ./ wrappers)", () => {
    const d = { javaVersion: "21" } as Detected;
    for (const cmd of ["mvn install -DskipTests", "./gradlew build", "./mvnw test", "gradle dependencies"]) {
      const w = wrapForRuntime(cmd, d);
      expect(w).toContain("sdkman-init.sh");
      expect(w).toContain(cmd);
    }
  });

  it("exposes coursier + a JVM for scala build tools", () => {
    const d = { scalaVersion: "3.3" } as Detected;
    const w = wrapForRuntime("./sbt compile", d);
    expect(w).toContain("coursier/bin");
    expect(w).toContain("sdkman-init.sh");
    expect(w).toContain("./sbt compile");
    expect(wrapForRuntime("mill _.compile", d)).toContain("coursier/bin");
  });

  it("sources ~/.ghcup/env for haskell stack/cabal", () => {
    const d = { ghcVersion: "9.6" } as Detected;
    for (const cmd of ["stack build", "cabal build"]) {
      const w = wrapForRuntime(cmd, d);
      expect(w).toContain(".ghcup/env");
      expect(w).toContain(cmd);
    }
  });

  it("puts ~/.dotnet on PATH (and sets DOTNET_ROOT) for dotnet", () => {
    const w = wrapForRuntime("dotnet restore", { dotnetVersion: "8" } as Detected);
    expect(w).toContain(".dotnet");
    expect(w).toContain("DOTNET_ROOT");
    expect(w).toContain("dotnet restore");
  });

  it("puts ~/.juliaup/bin on PATH for julia", () => {
    const w = wrapForRuntime('julia --project=. -e "using Pkg; Pkg.instantiate()"', {
      juliaVersion: "1.10",
    } as Detected);
    expect(w).toContain(".juliaup/bin");
    expect(w).toContain("Pkg.instantiate");
  });

  it("runs opam env for ocaml dune/opam commands", () => {
    const d = { ocamlVersion: "5.1" } as Detected;
    for (const cmd of ["dune build", "opam install . --deps-only"]) {
      const w = wrapForRuntime(cmd, d);
      expect(w).toContain("opam env");
      expect(w).toContain(cmd);
    }
  });

  it("globs the zig install dir onto PATH for zig build", () => {
    const w = wrapForRuntime("zig build", { zigVersion: "0.12" } as Detected);
    expect(w).toContain(".local/share/zig-");
    expect(w).toContain("zig build");
  });

  it("does not wrap these commands when the ecosystem isn't detected", () => {
    expect(wrapForRuntime("mix deps.get", {} as Detected)).toBe("mix deps.get");
    expect(wrapForRuntime("./gradlew build", {} as Detected)).toBe("./gradlew build");
    expect(wrapForRuntime("stack build", {} as Detected)).toBe("stack build");
    expect(wrapForRuntime("dotnet restore", {} as Detected)).toBe("dotnet restore");
    expect(wrapForRuntime("zig build", {} as Detected)).toBe("zig build");
  });
});
