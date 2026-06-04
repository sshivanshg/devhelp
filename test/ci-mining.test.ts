import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  extractRunCommands,
  classify,
  isReproducible,
  mineCI,
  fillFromCI,
} from "../src/ci-mining.js";
import type { Detected } from "../src/detect.js";

describe("extractRunCommands", () => {
  it("extracts inline run: commands", () => {
    const wf = ["jobs:", "  test:", "    steps:", "      - run: pnpm test"].join("\n");
    expect(extractRunCommands(wf)).toEqual(["pnpm test"]);
  });

  it("extracts every command in a block scalar", () => {
    const wf = [
      "      - name: build and test",
      "        run: |",
      "          pnpm install --frozen-lockfile",
      "          pnpm build",
      "          pnpm test",
      "      - run: echo done",
    ].join("\n");
    expect(extractRunCommands(wf)).toEqual([
      "pnpm install --frozen-lockfile",
      "pnpm build",
      "pnpm test",
      "echo done",
    ]);
  });

  it("ignores comments and continuation noise inside a block", () => {
    const wf = ["      - run: |", "          # a comment", "          set -e", "          make test"].join(
      "\n",
    );
    expect(extractRunCommands(wf)).toEqual(["make test"]);
  });

  it("strips wrapping quotes on inline form", () => {
    expect(extractRunCommands('    - run: "go test ./..."')).toEqual(["go test ./..."]);
  });
});

describe("classify", () => {
  it("recognizes test commands across ecosystems", () => {
    for (const c of ["pnpm test", "npm run test", "pytest", "go test ./...", "cargo test", "make test", "mix test"]) {
      expect(classify(c), c).toBe("test");
    }
  });
  it("recognizes bare test-runner binaries (common in CI)", () => {
    for (const c of ["vitest run", "jest --ci", "mocha", "cypress run", "playwright test"]) {
      expect(classify(c), c).toBe("test");
    }
  });
  it("recognizes build commands", () => {
    for (const c of ["pnpm build", "npm run build", "cargo build", "go build ./...", "tsc"]) {
      expect(classify(c), c).toBe("build");
    }
  });
  it("recognizes install commands", () => {
    for (const c of ["npm ci", "pnpm install", "pip install -r requirements.txt", "bundle install"]) {
      expect(classify(c), c).toBe("install");
    }
  });
  it("leaves unrelated commands as other", () => {
    expect(classify("echo hello")).toBe("other");
    expect(classify("aws s3 cp x y")).toBe("other");
  });
});

describe("isReproducible", () => {
  it("rejects matrix/secret interpolation, chains, and CI uploaders", () => {
    expect(isReproducible("pnpm test --shard ${{ matrix.shard }}")).toBe(false);
    expect(isReproducible("pnpm install && pnpm test")).toBe(false);
    expect(isReproducible("bash <(curl -s https://codecov.io/bash)")).toBe(false);
  });
  it("accepts a clean standalone command", () => {
    expect(isReproducible("pnpm test")).toBe(true);
    expect(isReproducible("go test ./...")).toBe(true);
  });
});

describe("fillFromCI", () => {
  function base(): Detected {
    return {
      projectDir: "/x",
      envTemplates: [],
      prismaSchemas: [],
      prismaSeedConfigured: false,
      hasPlaywright: false,
      hasHusky: false,
      hasSubmodules: false,
      installCommands: [],
      nodeIsToolingOnly: false,
      isLibrary: false,
      migrationCommands: [],
      rustIsOptional: false,
      goNeedsManualInstall: false,
      dockerComposeFiles: [],
      serviceComposeFiles: [],
      envHasLocalDb: false,
      unrecognizedManifests: [],
    };
  }

  it("fills only empty test/build fields, never overrides", () => {
    const d = base();
    d.testCommand = "vitest"; // already known — must be preserved
    const filled = fillFromCI(d, { test: "make test", build: "make build", commands: [] });
    expect(d.testCommand).toBe("vitest");
    expect(d.buildCommand).toBe("make build");
    expect(filled).toEqual(["build"]);
  });
});

describe("mineCI (fixture)", () => {
  it("mines test/build from a workflow file, skipping CI-only noise", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "devhelp-ci-"));
    try {
      await fs.mkdir(path.join(dir, ".github/workflows"), { recursive: true });
      await fs.writeFile(
        path.join(dir, ".github/workflows/ci.yml"),
        [
          "name: CI",
          "jobs:",
          "  test:",
          "    steps:",
          "      - run: pnpm install --frozen-lockfile",
          "      - run: pnpm build",
          "      - run: pnpm test --shard ${{ matrix.shard }}", // skipped: matrix
          "      - run: go test ./...", // clean test → chosen
        ].join("\n"),
      );
      const ci = await mineCI(dir);
      expect(ci).not.toBeNull();
      expect(ci!.build).toBe("pnpm build");
      expect(ci!.test).toBe("go test ./...");
      expect(ci!.commands).toContain("pnpm install --frozen-lockfile");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null when there are no workflows", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "devhelp-ci-"));
    try {
      expect(await mineCI(dir)).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
