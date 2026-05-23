import { promises as fs } from "node:fs";
import * as path from "node:path";
import { normalizeNodeVersion } from "./versions.js";
import {
  tryRead,
  exists,
  fileExistsAny,
  listDirs,
  stripJsonComments,
} from "./detectors/shared.js";

export type PkgManager = "npm" | "pnpm" | "yarn" | "bun";

export interface ASDFVersions {
  nodejs?: string;
  python?: string;
  ruby?: string;
  java?: string;
  elixir?: string;
  erlang?: string;
  php?: string;
  golang?: string;
  rust?: string;
  deno?: string;
  flutter?: string;
  dart?: string;
  bun?: string;
  swift?: string;
  haskell?: string;
  scala?: string;
  ocaml?: string;
  julia?: string;
  zig?: string;
  r?: string;
}

export interface Detected {
  projectDir: string;

  // Runtimes
  nodeVersion?: string;
  pythonVersion?: string;
  rustToolchain?: string;
  goVersion?: string;

  // Node ecosystem
  pkgManager?: PkgManager;
  monorepo?:
    | "turbo"
    | "nx"
    | "lerna"
    | "pnpm-workspaces"
    | "npm-workspaces"
    | "yarn-workspaces";
  nodeIsToolingOnly: boolean; // root package.json exists but is just for tooling (no lockfile/deps/framework)
  isLibrary: boolean; // root package.json looks like a library, not an app

  // Frameworks (drives the final "Ready" hints)
  framework?: Framework;

  // Post-install work
  envTemplates: string[]; // relative paths to .env.example etc.
  prismaSchemas: string[]; // relative paths to prisma schemas
  hasPlaywright: boolean;
  hasHusky: boolean;
  hasSubmodules: boolean;

  // Python tooling
  pythonTool?: "poetry" | "uv" | "pipenv" | "pip-requirements" | "pip-pyproject";

  // Final install commands (in order)
  installCommands: string[];

  // Hints for the user
  devCommand?: string;
  buildCommand?: string;
  testCommand?: string;
  devUrl?: string;

  // Optional / suggestions
  rustIsOptional: boolean; // detected Cargo.toml but not the primary stack
  goNeedsManualInstall: boolean; // go.mod detected but installer skipped

  // Devcontainer hints
  devcontainerSetupCommand?: string;

  // Docker / service dependencies
  dockerComposeFiles: string[]; // relative paths to docker-compose*.yml
  envHasLocalDb: boolean; // .env.example references localhost:5432 / 6379 / 27017

  // "I don't know this stack" signals
  unrecognizedManifests: string[]; // CMakeLists.txt, Makefile, mix.exs, …

  // Shared: asdf/mise version pins
  asdfVersions?: ASDFVersions;

  // Ruby
  rubyVersion?: string;
  rubyFramework?: string;

  // PHP
  phpVersion?: string;
  phpFramework?: string;

  // Elixir
  elixirVersion?: string;
  erlangVersion?: string;
  elixirFramework?: string;
  elixirSetupCommands?: string[];

  // Java/Kotlin
  javaVersion?: string;
  javaIsKotlin?: boolean;
  javaBuildSystem?: "maven" | "gradle";
  javaFramework?: string;

  // .NET
  dotnetVersion?: string;
  dotnetFramework?: string;

  // Dart/Flutter
  dartSdkVersion?: string;
  dartIsFlutter?: boolean;

  // Deno
  denoVersion?: string;
  denoDevTask?: string;

  // Bun as runtime
  bunIsRuntime?: boolean;
  bunVersion?: string;

  // C/C++ (info-only)
  clikeBuildSystem?: "cmake" | "meson" | "autotools" | "make";
  clikeLanguage?: string;
  clikeBuildInstructions?: string[];

  // Nix (info-only)
  nixType?: "flake" | "shell" | "default";
  nixEnterCommand?: string;
  nixBuildCommand?: string;

  // Swift / iOS / macOS
  swiftVersion?: string;
  swiftBuildSystem?: "spm" | "cocoapods" | "carthage" | "xcode";
  swiftTargets?: string[];
  swiftRequiresXcode?: boolean;

  // Android (extends Java)
  isAndroid?: boolean;
  androidCompileSdk?: string;

  // React Native / Expo (extends Node)
  isReactNative?: boolean;
  isExpo?: boolean;
  rnTargets?: string[];
  rnPostInstall?: string[];

  // Haskell
  ghcVersion?: string;
  haskellBuildSystem?: "stack" | "cabal";

  // Scala
  scalaVersion?: string;
  scalaBuildSystem?: "sbt" | "mill" | "maven";
  scalaFramework?: string;

  // Clojure
  clojureVersion?: string;
  clojureBuildSystem?: "tools.deps" | "leiningen" | "shadow-cljs";
  clojureFramework?: string;

  // R
  rVersion?: string;
  rProjectType?: "renv" | "package" | "script";
  rIsShiny?: boolean;

  // Julia
  juliaVersion?: string;

  // Zig
  zigVersion?: string;

  // OCaml
  ocamlVersion?: string;
  ocamlHasDune?: boolean;

  // Bazel
  bazelVersion?: string;
  bazelLanguages?: string[];

  // Nx
  isNx?: boolean;
  nxApps?: string[];

  // Infrastructure (info-only)
  infraType?: "terraform" | "ansible" | "helm" | "pulumi";
  infraCommands?: { label: string; cmd: string }[];

  // Info-only panel (no auto-install): C/C++, Nix
  informOnly?: boolean;
  informTitle?: string;
  informBody?: string[];
}

export interface Framework {
  name: string;
  defaultUrl?: string;
}

const FRAMEWORK_TABLE: Array<{ deps: string[]; name: string; defaultUrl?: string }> = [
  { deps: ["next"], name: "Next.js", defaultUrl: "http://localhost:3000" },
  { deps: ["nuxt", "nuxt3"], name: "Nuxt", defaultUrl: "http://localhost:3000" },
  { deps: ["@remix-run/dev", "@remix-run/react"], name: "Remix", defaultUrl: "http://localhost:3000" },
  { deps: ["astro"], name: "Astro", defaultUrl: "http://localhost:4321" },
  { deps: ["@sveltejs/kit"], name: "SvelteKit", defaultUrl: "http://localhost:5173" },
  { deps: ["vite"], name: "Vite", defaultUrl: "http://localhost:5173" },
  { deps: ["@angular/core"], name: "Angular", defaultUrl: "http://localhost:4200" },
  { deps: ["expo"], name: "Expo" },
  { deps: ["react-native"], name: "React Native" },
  { deps: ["@nestjs/core"], name: "NestJS", defaultUrl: "http://localhost:3000" },
  { deps: ["express"], name: "Express", defaultUrl: "http://localhost:3000" },
  { deps: ["hono"], name: "Hono", defaultUrl: "http://localhost:3000" },
  { deps: ["fastify"], name: "Fastify", defaultUrl: "http://localhost:3000" },
];

export async function detect(dir: string): Promise<Detected> {
  const out: Detected = {
    projectDir: dir,
    envTemplates: [],
    prismaSchemas: [],
    hasPlaywright: false,
    hasHusky: false,
    hasSubmodules: false,
    installCommands: [],
    nodeIsToolingOnly: false,
    isLibrary: false,
    rustIsOptional: false,
    goNeedsManualInstall: false,
    dockerComposeFiles: [],
    envHasLocalDb: false,
    unrecognizedManifests: [],
  };

  out.asdfVersions = await readToolVersions(dir);

  await detectNode(dir, out);
  await detectPython(dir, out);
  await detectRust(dir, out);
  await detectGo(dir, out);
  await detectRuby(dir, out);
  await detectPHP(dir, out);
  await detectElixir(dir, out);
  await detectJava(dir, out);
  await detectDotnet(dir, out);
  await detectDart(dir, out);
  await detectDeno(dir, out);
  await detectSwift(dir, out);
  await detectHaskell(dir, out);
  await detectScala(dir, out);
  await detectClojure(dir, out);
  await detectR(dir, out);
  await detectJulia(dir, out);
  await detectZig(dir, out);
  await detectOCaml(dir, out);
  await detectBazel(dir, out);
  await detectPostInstall(dir, out);
  await detectDevcontainer(dir, out);
  await detectToolVersionsFallback(dir, out);
  await detectInfrastructure(dir, out);
  await detectCLike(dir, out);
  await detectNix(dir, out);
  await detectUnrecognized(dir, out);

  return out;
}

export function isDetectionEmpty(d: Detected): boolean {
  // Nothing to do AND nothing recognized — caller should refuse rather than print READY.
  if (d.installCommands.length > 0) return false;
  if (d.nodeVersion && !d.nodeIsToolingOnly) return false;
  if (d.pythonVersion || d.rustToolchain || d.goVersion) return false;
  if (d.framework) return false;
  if (d.envTemplates.length || d.prismaSchemas.length || d.hasSubmodules) return false;
  if (d.devcontainerSetupCommand) return false;
  if (d.rubyVersion || d.phpVersion || d.elixirVersion) return false;
  if (d.javaVersion || d.dotnetVersion) return false;
  if (d.dartSdkVersion || d.denoVersion) return false;
  if (d.bunIsRuntime) return false;
  if (d.swiftVersion || d.ghcVersion || d.scalaVersion) return false;
  if (d.clojureVersion || d.rVersion || d.juliaVersion) return false;
  if (d.zigVersion || d.ocamlVersion) return false;
  if (d.bazelVersion || d.infraType) return false;
  if (d.informOnly) return false;
  return true;
}

async function detectNode(dir: string, out: Detected): Promise<void> {
  const pkgRaw = await tryRead(path.join(dir, "package.json"));
  const nvmrc = await tryRead(path.join(dir, ".nvmrc"));
  const nodeVersionFile = await tryRead(path.join(dir, ".node-version"));

  if (!pkgRaw) {
    if (nvmrc || nodeVersionFile) out.nodeVersion = cleanNode(nvmrc) ?? cleanNode(nodeVersionFile);
    return;
  }

  let pkg: any;
  try {
    pkg = JSON.parse(pkgRaw);
  } catch {
    return;
  }

  const lockfile = await fileExistsAny(dir, [
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "package-lock.json",
  ]);
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  // Detect framework. Config files (next.config.*, etc.) beat dep matching.
  // For dep-only matches in monorepo fan-outs (turbo/nx dev script), suppress the
  // result — the matched dep is likely in a workspace, not the root, and the dev
  // URL would be misleading. Config-file hits aren't suppressed: they're strong evidence.
  const devScript: string = (pkg.scripts ?? {}).dev ?? "";
  const devIsFanout =
    /^\s*(turbo|nx)\b/.test(devScript) || /--filter/.test(devScript) || /run-many/.test(devScript);
  const fw = await detectFramework(dir, pkg, deps);
  // detectFramework returns config-detected frameworks first; if we got one via
  // config, keep it. If we got one only via dep matching AND the dev script is a
  // fan-out, drop it.
  const fwFromConfig = await detectFrameworkByConfig(dir);
  if (fwFromConfig) {
    out.framework = fwFromConfig;
  } else if (fw && !devIsFanout) {
    out.framework = fw;
  }

  // Library heuristic: looks like a publishable package, not an app
  const scripts = pkg.scripts ?? {};
  const looksLikeLibrary =
    pkg.private !== true &&
    (pkg.main || pkg.exports || pkg.module) &&
    !scripts.dev &&
    !scripts.start;
  out.isLibrary = looksLikeLibrary;

  // Is this a Node *project*, or just a tooling-only package.json?
  // Strong signals only — having "dependencies" alone isn't enough (mdBook ships eslint
  // in dependencies just for linting docs). Require: lockfile, explicit engines.node,
  // a framework, a publishable bin, or a real app script (dev/start/build).
  const hasAppScript = !!(scripts.dev || scripts.start || scripts.build);
  const isNodeProject =
    !!lockfile ||
    !!pkg.engines?.node ||
    !!out.framework ||
    !!pkg.bin ||
    hasAppScript;

  out.nodeVersion =
    cleanNode(pkg.volta?.node) ??
    cleanNode(nvmrc) ??
    cleanNode(nodeVersionFile) ??
    cleanNode(pkg.engines?.node) ??
    (isNodeProject ? "lts/*" : undefined);
  out.pkgManager = pickPackageManager(pkg, lockfile);
  out.nodeIsToolingOnly = !isNodeProject;

  // Monorepo
  if (await exists(path.join(dir, "turbo.json"))) out.monorepo = "turbo";
  else if (await exists(path.join(dir, "nx.json"))) out.monorepo = "nx";
  else if (await exists(path.join(dir, "lerna.json"))) out.monorepo = "lerna";
  else if (await exists(path.join(dir, "pnpm-workspace.yaml"))) out.monorepo = "pnpm-workspaces";
  else if (Array.isArray(pkg.workspaces) || pkg.workspaces?.packages) {
    out.monorepo = out.pkgManager === "yarn" ? "yarn-workspaces" : "npm-workspaces";
  }

  if (isNodeProject) {
    out.installCommands.push(installCommandFor(out.pkgManager, lockfile));
  }

  // Bun-as-runtime detection: bun is the actual JS runtime, not just the package
  // manager. When this is true, skip nvm/Node install entirely.
  const bunfigExists = await exists(path.join(dir, "bunfig.toml"));
  const startScript = (pkg.scripts ?? {}).start ?? "";
  const isBunRuntime = bunfigExists
    || /^\s*bun\s+(run|--)/.test(devScript)
    || /^\s*bun\s+(run|--)/.test(startScript);
  if (isBunRuntime) {
    out.bunIsRuntime = true;
    out.bunVersion = out.asdfVersions?.bun ?? pkg.engines?.bun ?? "latest";
    // Don't install Node — bun handles its own runtime.
    out.nodeVersion = undefined;
  }

  out.hasPlaywright = !!(deps["@playwright/test"] || deps["playwright"]);
  out.hasHusky = !!deps["husky"];

  if (scripts.dev) out.devCommand = `${out.pkgManager} run dev`;
  else if (scripts.start) out.devCommand = `${out.pkgManager} start`;
  if (scripts.build) out.buildCommand = `${out.pkgManager} run build`;
  if (scripts.test) out.testCommand = `${out.pkgManager} test`;
  if (out.framework?.defaultUrl && !out.isLibrary) out.devUrl = out.framework.defaultUrl;

  // React Native / Expo: hybrid Node + iOS/Android. Needs CocoaPods install
  // step after npm/yarn install when ios/Podfile exists.
  const isRN = !!deps["react-native"];
  let isExpoApp = !!deps["expo"];
  if (!isExpoApp) {
    const appJsonRaw = await tryRead(path.join(dir, "app.json"));
    if (appJsonRaw) {
      try {
        const aj = JSON.parse(appJsonRaw);
        if (aj?.expo) isExpoApp = true;
      } catch { /* ignore */ }
    }
  }
  if (isRN || isExpoApp) {
    const hasIos = await exists(path.join(dir, "ios"));
    const hasAndroid = await exists(path.join(dir, "android"));
    const hasIosPodfile = await exists(path.join(dir, "ios", "Podfile"));
    out.isReactNative = isRN;
    out.isExpo = isExpoApp;
    out.rnTargets = [
      ...(hasIos ? ["iOS"] : []),
      ...(hasAndroid ? ["Android"] : []),
      ...(isExpoApp ? ["web"] : []),
    ];
    out.rnPostInstall = hasIosPodfile ? ["cd ios && pod install && cd .."] : [];
    if (hasIosPodfile) out.installCommands.push("cd ios && pod install && cd ..");
    if (isExpoApp) {
      out.devCommand = "npx expo start";
      out.framework = out.framework ?? { name: "Expo" };
    } else {
      out.devCommand = "npx react-native start";
      out.framework = out.framework ?? { name: "React Native" };
    }
  }

  // Nx: detected above as monorepo. Surface preferred Nx commands when no
  // existing dev script ran the show.
  if (out.monorepo === "nx") {
    out.isNx = true;
    const apps = await listDirs(path.join(dir, "apps"));
    out.nxApps = apps;
    if (apps.length > 0 && !scripts.dev) {
      out.devCommand = `npx nx serve ${apps[0]}`;
    }
    if (!scripts.test) out.testCommand = "npx nx run-many --target=test --all";
  }
}

const CONFIG_FRAMEWORKS: Array<{ files: string[]; name: string; url?: string }> = [
  { files: ["next.config.js", "next.config.ts", "next.config.mjs", "next.config.cjs"], name: "Next.js", url: "http://localhost:3000" },
  { files: ["nuxt.config.js", "nuxt.config.ts", "nuxt.config.mjs"], name: "Nuxt", url: "http://localhost:3000" },
  { files: ["astro.config.mjs", "astro.config.ts", "astro.config.js"], name: "Astro", url: "http://localhost:4321" },
  { files: ["svelte.config.js", "svelte.config.ts"], name: "SvelteKit", url: "http://localhost:5173" },
  { files: ["remix.config.js", "remix.config.mjs"], name: "Remix", url: "http://localhost:3000" },
  { files: ["angular.json"], name: "Angular", url: "http://localhost:4200" },
  { files: ["nest-cli.json"], name: "NestJS", url: "http://localhost:3000" },
];

async function detectFrameworkByConfig(dir: string): Promise<Framework | undefined> {
  for (const row of CONFIG_FRAMEWORKS) {
    if ((await fileExistsAny(dir, row.files)) || (await configInApps(dir, row.files))) {
      return { name: row.name, defaultUrl: row.url };
    }
  }
  return undefined;
}

async function detectFramework(
  dir: string,
  pkg: any,
  deps: Record<string, unknown>,
): Promise<Framework | undefined> {
  // For "Vite as framework", require an actual vite.config to avoid library false positives.
  const viteConfigExists =
    (await fileExistsAny(dir, [
      "vite.config.ts",
      "vite.config.js",
      "vite.config.mjs",
      "vite.config.cjs",
    ])) !== null || (await viteConfigInApps(dir));

  for (const row of FRAMEWORK_TABLE) {
    if (!row.deps.some((d) => d in deps)) continue;
    if (row.name === "Vite" && !viteConfigExists) continue;
    return { name: row.name, defaultUrl: row.defaultUrl };
  }
  return undefined;
}

async function configInApps(dir: string, files: string[]): Promise<boolean> {
  for (const sub of ["apps", "packages"]) {
    const subDir = path.join(dir, sub);
    if (!(await exists(subDir))) continue;
    const entries = await fs.readdir(subDir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (await fileExistsAny(path.join(subDir, e.name), files)) return true;
    }
  }
  return false;
}

async function viteConfigInApps(dir: string): Promise<boolean> {
  for (const sub of ["apps", "packages"]) {
    const subDir = path.join(dir, sub);
    if (!(await exists(subDir))) continue;
    const entries = await fs.readdir(subDir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const f = await fileExistsAny(path.join(subDir, e.name), [
        "vite.config.ts",
        "vite.config.js",
        "vite.config.mjs",
        "vite.config.cjs",
      ]);
      if (f) return true;
    }
  }
  return false;
}

async function detectPython(dir: string, out: Detected): Promise<void> {
  const pyProject = await tryRead(path.join(dir, "pyproject.toml"));
  const reqTxt = await tryRead(path.join(dir, "requirements.txt"));
  const pipfile = await tryRead(path.join(dir, "Pipfile"));
  const pythonVersionFile = await tryRead(path.join(dir, ".python-version"));
  if (!pyProject && !reqTxt && !pipfile && !pythonVersionFile) return;

  const LATEST_PYTHON = "3.13";

  // Resolution order: explicit pin → tool-specific config → CI hint → latest stable.
  let resolved: string | undefined;
  if (pythonVersionFile) resolved = pythonVersionFile.trim();
  if (!resolved && pyProject) resolved = parseToolPython(pyProject);
  if (!resolved) resolved = await ciPythonHint(dir);
  if (!resolved && pyProject) {
    const constraint = parsePyProjectPython(pyProject);
    // For libraries, use the latest stable rather than the lower bound — the lower
    // bound is the *minimum* the library supports, not what to develop against.
    resolved = constraint && isExactPin(pyProject) ? constraint : LATEST_PYTHON;
  }
  if (!resolved) resolved = LATEST_PYTHON;
  out.pythonVersion = resolved;

  if (pyProject?.includes("[tool.poetry]")) {
    out.pythonTool = "poetry";
    out.installCommands.push("poetry install");
  } else if (pyProject?.includes("[tool.uv]")) {
    out.pythonTool = "uv";
    out.installCommands.push("uv sync");
  } else if (pipfile) {
    out.pythonTool = "pipenv";
    out.installCommands.push("pipenv install");
  } else if (reqTxt) {
    out.pythonTool = "pip-requirements";
    out.installCommands.push(
      "python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt",
    );
  } else if (pyProject) {
    out.pythonTool = "pip-pyproject";
    out.installCommands.push(
      "python -m venv .venv && . .venv/bin/activate && pip install -e .",
    );
  }
  out.testCommand = out.testCommand ?? "pytest";

  // Python framework hint
  if (!out.framework) {
    const blob = (pyProject ?? "") + "\n" + (reqTxt ?? "") + "\n" + (pipfile ?? "");
    if (/(^|[^a-z])django([^a-z]|$)/i.test(blob))
      out.framework = { name: "Django", defaultUrl: "http://localhost:8000" };
    else if (/fastapi/i.test(blob))
      out.framework = { name: "FastAPI", defaultUrl: "http://localhost:8000" };
    else if (/\bflask\b/i.test(blob))
      out.framework = { name: "Flask", defaultUrl: "http://localhost:5000" };
    if (out.framework && !out.devUrl) out.devUrl = out.framework.defaultUrl;
  }
}

async function detectRust(dir: string, out: Detected): Promise<void> {
  const rustToolchain = await tryRead(path.join(dir, "rust-toolchain"));
  const rustToolchainToml = await tryRead(path.join(dir, "rust-toolchain.toml"));
  const cargoToml = await tryRead(path.join(dir, "Cargo.toml"));
  if (!rustToolchain && !rustToolchainToml && !cargoToml) return;
  out.rustToolchain = (rustToolchain ?? "stable").trim() || "stable";

  // If Node has a real framework, treat Rust as optional (compiler / native modules).
  // Most contributors don't need to rebuild the native bits.
  const nodeFrameworkDriven =
    !!out.framework && !!out.nodeVersion && !out.nodeIsToolingOnly;
  if (nodeFrameworkDriven) {
    out.rustIsOptional = true;
    return;
  }
  out.installCommands.push("cargo build");
  out.testCommand = out.testCommand ?? "cargo test";
}

async function detectGo(dir: string, out: Detected): Promise<void> {
  const goMod = await tryRead(path.join(dir, "go.mod"));
  if (!goMod) return;
  const m = goMod.match(/^go\s+([\d.]+)/m);
  out.goVersion = m?.[1];
  out.installCommands.push("go mod download");
  out.testCommand = out.testCommand ?? "go test ./...";
  out.buildCommand = out.buildCommand ?? "go build ./...";
}

async function detectPostInstall(dir: string, out: Detected): Promise<void> {
  // Env templates at root + per-app/-package for monorepos.
  const envCandidates = [
    ".env.example",
    ".env.template",
    ".env.sample",
    ".env.dist",
    ".env.local.example",
    ".env.development.example",
  ];
  const envDirs: string[] = ["."];
  if (out.monorepo) {
    for (const sub of ["apps", "packages"]) {
      const subDir = path.join(dir, sub);
      if (!(await exists(subDir))) continue;
      const entries = await fs.readdir(subDir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (e.isDirectory()) envDirs.push(path.join(sub, e.name));
      }
    }
  }
  for (const rel of envDirs) {
    for (const cand of envCandidates) {
      const relPath = rel === "." ? cand : path.join(rel, cand);
      if (await exists(path.join(dir, relPath))) out.envTemplates.push(relPath);
    }
  }

  // Prisma — root, workspace-package-IS-prisma, and nested workspace/prisma/.
  const prismaCandidates = new Set<string>();
  if (await exists(path.join(dir, "prisma/schema.prisma"))) {
    prismaCandidates.add("prisma/schema.prisma");
  }
  if (await exists(path.join(dir, "schema.prisma"))) {
    prismaCandidates.add("schema.prisma");
  }
  if (out.monorepo) {
    for (const sub of ["apps", "packages"]) {
      const subDir = path.join(dir, sub);
      if (!(await exists(subDir))) continue;
      const entries = await fs.readdir(subDir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        // Both layouts: packages/<x>/prisma/schema.prisma AND packages/<x>/schema.prisma
        const nested = path.join(sub, e.name, "prisma/schema.prisma");
        const direct = path.join(sub, e.name, "schema.prisma");
        if (await exists(path.join(dir, nested))) prismaCandidates.add(nested);
        if (await exists(path.join(dir, direct))) prismaCandidates.add(direct);
      }
    }
  }
  out.prismaSchemas = [...prismaCandidates];

  out.hasSubmodules = await exists(path.join(dir, ".gitmodules"));

  // Docker Compose — root + workspace packages. Don't auto-run; surface as setup step.
  const composeCandidates = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "docker-compose.dev.yml",
    "docker-compose.dev.yaml",
    "compose.yml",
    "compose.yaml",
  ];
  const composeDirs: string[] = ["."];
  if (out.monorepo) {
    for (const sub of ["apps", "packages"]) {
      const subDir = path.join(dir, sub);
      if (!(await exists(subDir))) continue;
      const entries = await fs.readdir(subDir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (e.isDirectory()) composeDirs.push(path.join(sub, e.name));
      }
    }
  }
  for (const rel of composeDirs) {
    for (const cand of composeCandidates) {
      const relPath = rel === "." ? cand : path.join(rel, cand);
      if (await exists(path.join(dir, relPath))) out.dockerComposeFiles.push(relPath);
    }
  }

  // Local DB hint: scan collected env templates for localhost:5432 (postgres) / 6379 (redis) / 27017 (mongo).
  for (const template of out.envTemplates) {
    const raw = await tryRead(path.join(dir, template));
    if (!raw) continue;
    if (/localhost:(5432|6379|27017)/.test(raw)) {
      out.envHasLocalDb = true;
      break;
    }
  }
}

async function detectDevcontainer(dir: string, out: Detected): Promise<void> {
  const dcPath = path.join(dir, ".devcontainer", "devcontainer.json");
  const raw = await tryRead(dcPath);
  if (!raw) return;
  let dc: any;
  try {
    dc = JSON.parse(stripJsonComments(raw));
  } catch {
    return;
  }
  const image: string = dc.image ?? dc.build?.image ?? "";
  // mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm → Node 20
  // mcr.microsoft.com/devcontainers/python:3 / python:3.12 / python:1-3.12 → Python 3.12
  // mcr.microsoft.com/devcontainers/go:1.25 → Go 1.25
  if (image) {
    const nodeMatch = image.match(/javascript-node[:\-][\d\-]*?(\d{2,})(?:-|$)/);
    const pyMatch = image.match(/python[:\-](?:[\d\-]*?)?(\d+\.\d+)(?:-|$)/);
    const goMatch = image.match(/\bgo[:\-](?:[\d\-]*?)?(\d+\.\d+)(?:-|$)/);
    if (nodeMatch && !out.nodeVersion) out.nodeVersion = nodeMatch[1];
    if (pyMatch && !out.pythonVersion) out.pythonVersion = pyMatch[1];
    if (goMatch && !out.goVersion) out.goVersion = goMatch[1];
  }
  const pcc = dc.postCreateCommand ?? dc.onCreateCommand;
  if (pcc) {
    out.devcontainerSetupCommand = typeof pcc === "string" ? pcc : JSON.stringify(pcc);
  }
}

const UNRECOGNIZED_MANIFEST_FILES = [
  "CMakeLists.txt",
  "Makefile",
  "configure",
  "configure.ac",
  "rebar.config",
  "shard.yml",
];

async function detectUnrecognized(dir: string, out: Detected): Promise<void> {
  for (const f of UNRECOGNIZED_MANIFEST_FILES) {
    if (await exists(path.join(dir, f))) out.unrecognizedManifests.push(f);
  }
  // .gemspec is a glob
  const entries = await fs.readdir(dir).catch(() => []);
  for (const e of entries) {
    if (e.endsWith(".gemspec")) out.unrecognizedManifests.push(e);
  }
}

async function detectToolVersionsFallback(_dir: string, out: Detected): Promise<void> {
  if (out.nodeVersion) return;
  const v = out.asdfVersions?.nodejs;
  if (v) out.nodeVersion = cleanNode(v);
}

function cleanNode(v?: string | null): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return normalizeNodeVersion(t.replace(/^v/, ""));
}

function pickPackageManager(pkg: { packageManager?: string }, lockfile: string | null): PkgManager {
  if (lockfile === "pnpm-lock.yaml") return "pnpm";
  if (lockfile === "yarn.lock") return "yarn";
  if (lockfile === "bun.lockb") return "bun";
  if (lockfile === "package-lock.json") return "npm";
  const pm = pkg.packageManager;
  if (pm?.startsWith("pnpm")) return "pnpm";
  if (pm?.startsWith("yarn")) return "yarn";
  if (pm?.startsWith("bun")) return "bun";
  if (pm?.startsWith("npm")) return "npm";
  return "npm";
}

function installCommandFor(pm: PkgManager, lockfile: string | null): string {
  if (lockfile === "pnpm-lock.yaml") return "pnpm install";
  if (lockfile === "yarn.lock") return "yarn install";
  if (lockfile === "bun.lockb") return "bun install";
  if (lockfile === "package-lock.json") return "npm ci";
  return `${pm} install`;
}

function parsePyProjectPython(content: string | null): string | undefined {
  if (!content) return undefined;
  // poetry style: python = "^3.10" / ">=3.9"
  // PEP 621: requires-python = ">=3.9"
  const m =
    content.match(/requires-python\s*=\s*["']\^?~?>?=?\s*([\d.]+)["']/) ||
    content.match(/^python\s*=\s*["']\^?~?>?=?\s*([\d.]+)["']/m);
  return m?.[1];
}

function isExactPin(content: string): boolean {
  // True only if the python spec is "=3.x" or "3.x" without a range operator.
  const m = content.match(/(?:requires-python|^python)\s*=\s*["']([^"']+)["']/m);
  if (!m) return false;
  return /^[\d.]+$/.test(m[1].trim());
}

function parseToolPython(content: string): string | undefined {
  // hatch dev env (most authoritative — the version the maintainers dev against)
  const hatch = content.match(/\[tool\.hatch\.envs\.default\][\s\S]*?\bpython\s*=\s*["']([\d.]+)["']/);
  if (hatch) return hatch[1];
  // uv config (authoritative when present)
  const uv = content.match(/\[tool\.uv\][\s\S]*?\bpython\s*=\s*["']([\d.]+)["']/);
  if (uv) return uv[1];
  // Intentionally skip ruff target-version / mypy python_version: those describe
  // the *minimum supported*, not what the team develops against.
  return undefined;
}

async function ciPythonHint(root: string): Promise<string | undefined> {
  const wfDir = path.join(root, ".github", "workflows");
  if (!(await exists(wfDir))) return undefined;
  const files = await fs.readdir(wfDir).catch(() => []);
  const versions: string[] = [];
  for (const f of files) {
    if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
    const content = await fs.readFile(path.join(wfDir, f), "utf8").catch(() => "");
    // Match scalar python-version: 3.x  OR array members ["3.9", "3.10", ...]
    // Strategy: look for "3.\d+" in lines that mention python-version (incl. matrix arrays).
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/python-version/i.test(line)) continue;
      // Same line numbers
      for (const m of line.matchAll(/(?<!\d)(3\.\d+)(?!\d)/g)) versions.push(m[1]);
      // Look ahead a couple lines for array/list values
      for (let j = 1; j <= 3 && i + j < lines.length; j++) {
        const ahead = lines[i + j];
        if (/^\s*[-\[]/.test(ahead) || /^\s*\d/.test(ahead) || /^\s*["']\d/.test(ahead)) {
          for (const m of ahead.matchAll(/(?<!\d)(3\.\d+)(?!\d)/g)) versions.push(m[1]);
        }
      }
    }
  }
  if (!versions.length) return undefined;
  versions.sort((a, b) => {
    const [aM, am] = a.split(".").map(Number);
    const [bM, bm] = b.split(".").map(Number);
    return bM - aM || bm - am;
  });
  return versions[0];
}

/* -------------------------------------------------------------------------- */
/* Shared: asdf .tool-versions + mise .mise.toml                              */
/* -------------------------------------------------------------------------- */

async function readToolVersions(root: string): Promise<ASDFVersions> {
  const result: ASDFVersions = {};
  const toolVersionsContent = await tryRead(path.join(root, ".tool-versions"));
  if (toolVersionsContent) {
    for (const rawLine of toolVersionsContent.split("\n")) {
      const line = rawLine.split("#")[0].trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      const tool = parts[0];
      const version = parts[1];
      if (!tool || !version) continue;
      const key = mapToolName(tool);
      if (key) (result as any)[key] = version;
    }
  }
  const miseContent = await tryRead(path.join(root, ".mise.toml"));
  if (miseContent) {
    const toolsMatch = miseContent.match(/\[tools\]([\s\S]*?)(?:\n\[|$)/);
    if (toolsMatch) {
      const toolsSection = toolsMatch[1];
      const entries = toolsSection.matchAll(/^\s*(\w[\w-]*)\s*=\s*["']([^"']+)["']/gm);
      for (const m of entries) {
        const key = mapToolName(m[1]);
        if (key) (result as any)[key] = m[2];
      }
    }
  }
  return result;
}

function mapToolName(name: string): keyof ASDFVersions | null {
  const n = name.toLowerCase();
  if (n === "nodejs" || n === "node") return "nodejs";
  if (n === "python") return "python";
  if (n === "ruby") return "ruby";
  if (n === "java") return "java";
  if (n === "elixir") return "elixir";
  if (n === "erlang") return "erlang";
  if (n === "php") return "php";
  if (n === "golang" || n === "go") return "golang";
  if (n === "rust") return "rust";
  if (n === "deno") return "deno";
  if (n === "flutter") return "flutter";
  if (n === "dart") return "dart";
  if (n === "bun") return "bun";
  return null;
}

/* -------------------------------------------------------------------------- */
/* Ruby                                                                        */
/* -------------------------------------------------------------------------- */

async function detectRuby(root: string, out: Detected): Promise<void> {
  const gemfile = await tryRead(path.join(root, "Gemfile"));
  if (!gemfile) return;

  let rubyVersion: string | undefined = out.asdfVersions?.ruby;
  const rubyVersionFile = await tryRead(path.join(root, ".ruby-version"));
  if (rubyVersionFile) rubyVersion = rubyVersionFile.trim();
  if (!rubyVersion) {
    const gemfileRuby = gemfile.match(/^ruby\s+["']([^"']+)["']/m);
    if (gemfileRuby) rubyVersion = gemfileRuby[1];
  }
  rubyVersion ??= "3.3.0";

  const framework =
    /["']rails["']/.test(gemfile) ? "Rails"
    : /["']jekyll["']/.test(gemfile) ? "Jekyll"
    : /["']sinatra["']/.test(gemfile) ? "Sinatra"
    : /["']hanami["']/.test(gemfile) ? "Hanami"
    : /["']middleman["']/.test(gemfile) ? "Middleman"
    : undefined;

  out.rubyVersion = rubyVersion;
  out.rubyFramework = framework;
  out.installCommands.push("bundle install");

  if (framework === "Rails") {
    out.devCommand = out.devCommand ?? "bin/rails server";
    out.devUrl = out.devUrl ?? "http://localhost:3000";
    out.testCommand = out.testCommand ?? "bin/rails test";
    out.framework = out.framework ?? { name: "Rails", defaultUrl: "http://localhost:3000" };
  } else if (framework === "Jekyll") {
    out.devCommand = out.devCommand ?? "bundle exec jekyll serve";
    out.devUrl = out.devUrl ?? "http://localhost:4000";
    out.framework = out.framework ?? { name: "Jekyll", defaultUrl: "http://localhost:4000" };
  } else if (framework === "Sinatra") {
    out.devCommand = out.devCommand ?? "bundle exec ruby app.rb";
    out.framework = out.framework ?? { name: "Sinatra" };
  } else if (framework) {
    out.framework = out.framework ?? { name: framework };
  }
  if (!out.testCommand) out.testCommand = "bundle exec rspec";
}

/* -------------------------------------------------------------------------- */
/* PHP                                                                         */
/* -------------------------------------------------------------------------- */

async function detectPHP(root: string, out: Detected): Promise<void> {
  const composerRaw = await tryRead(path.join(root, "composer.json"));
  if (!composerRaw) return;
  let composer: any;
  try {
    composer = JSON.parse(composerRaw);
  } catch {
    return;
  }

  let phpVersion: string | undefined = out.asdfVersions?.php;
  if (!phpVersion && composer.require?.php) {
    const m = String(composer.require.php).match(/(\d+\.\d+)/);
    if (m) phpVersion = m[1];
  }
  phpVersion ??= "8.3";

  const deps = { ...(composer.require ?? {}), ...(composer["require-dev"] ?? {}) };
  const framework =
    deps["laravel/framework"] ? "Laravel"
    : deps["symfony/symfony"] || deps["symfony/framework-bundle"] ? "Symfony"
    : deps["johnpbloch/wordpress"] || deps["wordpress/wordpress"] ? "WordPress"
    : deps["slim/slim"] ? "Slim"
    : deps["codeigniter4/framework"] ? "CodeIgniter"
    : undefined;

  out.phpVersion = phpVersion;
  out.phpFramework = framework;
  out.installCommands.push("composer install");

  if (framework === "Laravel") {
    out.devCommand = out.devCommand ?? "php artisan serve";
    out.devUrl = out.devUrl ?? "http://localhost:8000";
    out.framework = out.framework ?? { name: "Laravel", defaultUrl: "http://localhost:8000" };
  } else if (framework === "Symfony") {
    out.devCommand = out.devCommand ?? "symfony server:start";
    out.devUrl = out.devUrl ?? "http://localhost:8000";
    out.framework = out.framework ?? { name: "Symfony", defaultUrl: "http://localhost:8000" };
  } else if (framework) {
    out.framework = out.framework ?? { name: framework };
  }
  if (!out.testCommand) {
    if (deps["phpunit/phpunit"]) out.testCommand = "vendor/bin/phpunit";
    else if (deps["pestphp/pest"]) out.testCommand = "vendor/bin/pest";
  }
}

/* -------------------------------------------------------------------------- */
/* Elixir                                                                      */
/* -------------------------------------------------------------------------- */

async function detectElixir(root: string, out: Detected): Promise<void> {
  const mix = await tryRead(path.join(root, "mix.exs"));
  if (!mix) return;

  let elixirVersion: string | undefined = out.asdfVersions?.elixir;
  if (!elixirVersion) {
    const m = mix.match(/elixir:\s*["']~>\s*(\d+\.\d+)/);
    if (m) elixirVersion = m[1];
  }
  elixirVersion ??= "1.16";
  if (elixirVersion.includes("-otp-")) elixirVersion = elixirVersion.split("-otp-")[0];

  let erlangVersion: string | undefined = out.asdfVersions?.erlang ?? "26";
  if (erlangVersion.includes(".")) erlangVersion = erlangVersion.split(".")[0];

  const framework =
    /:phoenix\b/.test(mix) ? "Phoenix"
    : /:nerves\b/.test(mix) ? "Nerves"
    : /:plug\b/.test(mix) ? "Plug"
    : undefined;

  out.elixirVersion = elixirVersion;
  out.erlangVersion = erlangVersion;
  out.elixirFramework = framework;

  const setup: string[] = ["mix deps.get"];
  if (framework === "Phoenix") setup.push("mix ecto.setup");
  out.elixirSetupCommands = setup;
  out.installCommands.push(...setup);

  if (framework === "Phoenix") {
    out.devCommand = out.devCommand ?? "mix phx.server";
    out.devUrl = out.devUrl ?? "http://localhost:4000";
    out.framework = out.framework ?? { name: "Phoenix", defaultUrl: "http://localhost:4000" };
  } else if (framework) {
    out.framework = out.framework ?? { name: framework };
  }
  if (!out.testCommand) out.testCommand = "mix test";
}

/* -------------------------------------------------------------------------- */
/* Java / Kotlin                                                               */
/* -------------------------------------------------------------------------- */

async function detectJava(root: string, out: Detected): Promise<void> {
  const hasPom = await exists(path.join(root, "pom.xml"));
  const hasGradleGroovy = await exists(path.join(root, "build.gradle"));
  const hasGradleKts = await exists(path.join(root, "build.gradle.kts"));
  if (!hasPom && !hasGradleGroovy && !hasGradleKts) return;

  // Android: AndroidManifest.xml is the definitive signal. Routed through a
  // separate code path because Android needs Gradle + SDK, not just a JDK.
  const hasAndroidManifest =
    (await exists(path.join(root, "app", "src", "main", "AndroidManifest.xml")))
    || (await exists(path.join(root, "src", "main", "AndroidManifest.xml")));
  const appGradle = await tryRead(path.join(root, "app", "build.gradle"));
  const isAndroid = hasAndroidManifest
    || (!!appGradle && /com\.android\.(application|library)/.test(appGradle));
  if (isAndroid) {
    const compileSdk = appGradle?.match(/compileSdk[^\d]*(\d+)/)?.[1] ?? "34";
    const hasGradlewA = await exists(path.join(root, "gradlew"));
    out.isAndroid = true;
    out.androidCompileSdk = compileSdk;
    out.javaBuildSystem = "gradle";
    out.javaVersion = out.javaVersion ?? "17";
    out.javaFramework = "Android";
    out.framework = out.framework ?? { name: "Android" };
    const buildCmd = hasGradlewA ? "./gradlew assembleDebug" : "gradle assembleDebug";
    out.buildCommand = out.buildCommand ?? buildCmd;
    out.testCommand = out.testCommand ?? (hasGradlewA ? "./gradlew test" : "gradle test");
    out.installCommands.push(buildCmd);
    return;
  }

  const buildSystem: "maven" | "gradle" = hasPom ? "maven" : "gradle";
  const isKotlin = hasGradleKts;

  let javaVersion: string | undefined = out.asdfVersions?.java;
  if (javaVersion) {
    const majorMatch = javaVersion.match(/(\d+)/);
    if (majorMatch) javaVersion = majorMatch[1];
  }

  if (!javaVersion && hasPom) {
    const pom = (await tryRead(path.join(root, "pom.xml"))) ?? "";
    const m = pom.match(/<java\.version>(\d+)<\/java\.version>/)
      || pom.match(/<maven\.compiler\.source>(\d+)<\/maven\.compiler\.source>/);
    if (m) javaVersion = m[1];
  }

  if (!javaVersion && (hasGradleGroovy || hasGradleKts)) {
    const gradleFile = hasGradleKts
      ? path.join(root, "build.gradle.kts")
      : path.join(root, "build.gradle");
    const gradle = (await tryRead(gradleFile)) ?? "";
    const m = gradle.match(/JavaVersion\.VERSION_(\d+)/)
      || gradle.match(/sourceCompatibility\s*=\s*["'](\d+)/);
    if (m) javaVersion = m[1];
  }

  javaVersion ??= "21";

  let framework: string | undefined;
  if (hasPom) {
    const pom = (await tryRead(path.join(root, "pom.xml"))) ?? "";
    framework = pom.includes("spring-boot") ? "Spring Boot"
      : pom.includes("quarkus") ? "Quarkus"
      : pom.includes("micronaut") ? "Micronaut"
      : undefined;
  } else {
    const gradleFile = hasGradleKts
      ? path.join(root, "build.gradle.kts")
      : path.join(root, "build.gradle");
    const gradle = (await tryRead(gradleFile)) ?? "";
    framework = gradle.includes("spring-boot") ? "Spring Boot"
      : gradle.includes("quarkus") ? "Quarkus"
      : gradle.includes("com.android.application") ? "Android"
      : undefined;
  }

  const hasMvnw = await exists(path.join(root, "mvnw"));
  const hasGradlew = await exists(path.join(root, "gradlew"));

  const buildCommand = buildSystem === "maven"
    ? (hasMvnw ? "./mvnw package -DskipTests" : "mvn package -DskipTests")
    : (hasGradlew ? "./gradlew build" : "gradle build");

  const devCommand = framework === "Spring Boot"
    ? (buildSystem === "maven"
        ? (hasMvnw ? "./mvnw spring-boot:run" : "mvn spring-boot:run")
        : (hasGradlew ? "./gradlew bootRun" : "gradle bootRun"))
    : undefined;

  const testCommand = buildSystem === "maven"
    ? (hasMvnw ? "./mvnw test" : "mvn test")
    : (hasGradlew ? "./gradlew test" : "gradle test");

  out.javaVersion = javaVersion;
  out.javaIsKotlin = isKotlin;
  out.javaBuildSystem = buildSystem;
  out.javaFramework = framework;
  out.installCommands.push(buildSystem === "maven"
    ? (hasMvnw ? "./mvnw install -DskipTests" : "mvn install -DskipTests")
    : (hasGradlew ? "./gradlew dependencies" : "gradle dependencies"));
  out.buildCommand = out.buildCommand ?? buildCommand;
  out.devCommand = out.devCommand ?? devCommand;
  out.testCommand = out.testCommand ?? testCommand;
  if (framework === "Spring Boot") {
    out.devUrl = out.devUrl ?? "http://localhost:8080";
    out.framework = out.framework ?? { name: "Spring Boot", defaultUrl: "http://localhost:8080" };
  } else if (framework) {
    out.framework = out.framework ?? { name: framework };
  }
}

/* -------------------------------------------------------------------------- */
/* .NET                                                                        */
/* -------------------------------------------------------------------------- */

async function detectDotnet(root: string, out: Detected): Promise<void> {
  const entries = await fs.readdir(root).catch(() => [] as string[]);
  const projectFiles = entries.filter((e) =>
    e.endsWith(".csproj") || e.endsWith(".fsproj") || e.endsWith(".vbproj")
  );
  const slnFiles = entries.filter((e) => e.endsWith(".sln"));
  if (projectFiles.length === 0 && slnFiles.length === 0) return;

  let dotnetVersion: string | undefined;
  const globalJsonRaw = await tryRead(path.join(root, "global.json"));
  if (globalJsonRaw) {
    try {
      const gj = JSON.parse(globalJsonRaw);
      const v: string | undefined = gj?.sdk?.version;
      if (v) dotnetVersion = v.split(".")[0];
    } catch {
      /* ignore */
    }
  }

  let projectContent = "";
  if (projectFiles.length > 0) {
    projectContent = (await tryRead(path.join(root, projectFiles[0]))) ?? "";
  }
  if (!dotnetVersion && projectContent) {
    const tfm = projectContent.match(/<TargetFramework>net(\d+)/);
    if (tfm) dotnetVersion = tfm[1];
  }
  dotnetVersion ??= "8";

  const isWeb = projectContent.includes("Microsoft.NET.Sdk.Web")
    || projectFiles.some((f) => /web/i.test(f));
  const isBlazor = projectContent.includes("Blazor");
  const isMAUI = projectContent.includes("MAUI") || projectContent.includes("net8.0-android");

  const framework = isBlazor ? "Blazor"
    : isMAUI ? "MAUI"
    : isWeb ? "ASP.NET Core"
    : ".NET";

  out.dotnetVersion = dotnetVersion;
  out.dotnetFramework = framework;
  out.installCommands.push("dotnet restore");
  out.buildCommand = out.buildCommand ?? "dotnet build";
  out.testCommand = out.testCommand ?? "dotnet test";
  if (isWeb || isBlazor) {
    out.devCommand = out.devCommand ?? "dotnet run";
    out.devUrl = out.devUrl ?? "http://localhost:5000";
    out.framework = out.framework ?? { name: framework, defaultUrl: "http://localhost:5000" };
  } else {
    out.framework = out.framework ?? { name: framework };
  }
}

/* -------------------------------------------------------------------------- */
/* Dart / Flutter                                                              */
/* -------------------------------------------------------------------------- */

async function detectDart(root: string, out: Detected): Promise<void> {
  const pubspec = await tryRead(path.join(root, "pubspec.yaml"));
  if (!pubspec) return;

  // Minimal YAML parsing — look for the markers we care about.
  const hasFlutterDep = /^\s+flutter:\s*\n\s+sdk:\s*flutter/m.test(pubspec);
  const envFlutter = pubspec.match(/^\s+flutter:\s*['"]?(?!sdk)([^'"\n]+)['"]?/m);
  const envSdk = pubspec.match(/^\s+sdk:\s*['"]?([^'"\n]+)['"]?/m);
  const isFlutter = hasFlutterDep
    || /^flutter:\s*$/m.test(pubspec)
    || (!!envFlutter && /\d/.test(envFlutter[1]));

  let sdkVersion: string | undefined = out.asdfVersions?.flutter;
  if (!sdkVersion) {
    const fvm = await tryRead(path.join(root, ".fvm", "fvm_config.json"));
    if (fvm) {
      try {
        const cfg = JSON.parse(fvm);
        sdkVersion = cfg.flutterSdkVersion ?? cfg.flutter;
      } catch {
        /* ignore */
      }
    }
  }
  if (!sdkVersion && envFlutter) {
    const m = envFlutter[1].match(/(\d+\.\d+(?:\.\d+)?)/);
    if (m) sdkVersion = m[1];
  }
  if (!sdkVersion && !isFlutter && envSdk) {
    const m = envSdk[1].match(/(\d+\.\d+(?:\.\d+)?)/);
    if (m) sdkVersion = m[1];
  }
  sdkVersion ??= isFlutter ? "3.16" : "3.2";

  const installCommand = isFlutter ? "flutter pub get" : "dart pub get";
  out.dartSdkVersion = sdkVersion;
  out.dartIsFlutter = isFlutter;
  out.installCommands.push(installCommand);

  const hasWeb = await exists(path.join(root, "web"));
  if (isFlutter) {
    out.devCommand = out.devCommand ?? (hasWeb ? "flutter run -d chrome" : "flutter run");
    out.testCommand = out.testCommand ?? "flutter test";
    out.framework = out.framework ?? { name: "Flutter" };
  } else {
    out.testCommand = out.testCommand ?? "dart test";
    out.framework = out.framework ?? { name: "Dart" };
  }
}

/* -------------------------------------------------------------------------- */
/* Deno                                                                        */
/* -------------------------------------------------------------------------- */

async function detectDeno(root: string, out: Detected): Promise<void> {
  const denoJson = await tryRead(path.join(root, "deno.json"));
  const denoJsonc = await tryRead(path.join(root, "deno.jsonc"));
  const hasImportMap = await exists(path.join(root, "import_map.json"));
  const hasPackageJson = await exists(path.join(root, "package.json"));

  if (!denoJson && !denoJsonc && !(hasImportMap && !hasPackageJson)) return;

  let config: any = {};
  if (denoJson) {
    try {
      config = JSON.parse(denoJson);
    } catch {
      /* ignore */
    }
  } else if (denoJsonc) {
    const stripped = denoJsonc.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    try {
      config = JSON.parse(stripped);
    } catch {
      /* ignore */
    }
  }

  const denoVersion: string = out.asdfVersions?.deno ?? "latest";
  const tasks = config.tasks ?? {};
  const devTask = tasks.dev ? "deno task dev"
    : tasks.start ? "deno task start"
    : undefined;

  let devUrl: string | undefined;
  const devTaskContent = String(tasks.dev ?? tasks.start ?? "");
  const portMatch = devTaskContent.match(/--port[=\s]+(\d+)/);
  if (portMatch) devUrl = `http://localhost:${portMatch[1]}`;
  else if (devTaskContent.includes("--allow-net")) devUrl = "http://localhost:8000";

  out.denoVersion = denoVersion;
  out.denoDevTask = devTask;
  // Deno needs no install step — surface a cache step so it shows up in the panel.
  out.installCommands.push("deno cache");
  out.devCommand = out.devCommand ?? devTask;
  out.devUrl = out.devUrl ?? devUrl;
  out.testCommand = out.testCommand ?? (tasks.test ? "deno task test" : "deno test");
  out.framework = out.framework ?? { name: "Deno", defaultUrl: devUrl };
}

/* -------------------------------------------------------------------------- */
/* C / C++ — INFORM only                                                       */
/* -------------------------------------------------------------------------- */

async function detectCLike(root: string, out: Detected): Promise<void> {
  // If another ecosystem already drove the playbook, don't take over.
  if (!isDetectionEmpty(out)) return;

  const hasCMake = await exists(path.join(root, "CMakeLists.txt"));
  const hasMakefile = await exists(path.join(root, "Makefile"));
  const hasConfigure = await exists(path.join(root, "configure"))
    || await exists(path.join(root, "configure.ac"));
  const hasMeson = await exists(path.join(root, "meson.build"));
  if (!hasCMake && !hasMakefile && !hasConfigure && !hasMeson) return;

  const buildSystem: "cmake" | "meson" | "autotools" | "make" =
    hasCMake ? "cmake"
    : hasMeson ? "meson"
    : hasConfigure ? "autotools"
    : "make";

  let language = "C/C++";
  const entries = await fs.readdir(root).catch(() => [] as string[]);
  const hasCpp = entries.some((e) => /\.(cpp|cxx|cc|hpp)$/.test(e));
  const hasC = entries.some((e) => /\.c$/.test(e));
  if (hasCpp) language = "C++";
  else if (hasC) language = "C";
  if (language === "C/C++") {
    for (const sub of ["src", "include", "lib"]) {
      const subDir = path.join(root, sub);
      if (!(await exists(subDir))) continue;
      const subEntries = await fs.readdir(subDir).catch(() => [] as string[]);
      if (subEntries.some((e) => /\.(cpp|cxx|cc|hpp)$/.test(e))) {
        language = "C++";
        break;
      }
      if (subEntries.some((e) => /\.c$/.test(e))) {
        language = "C";
      }
    }
  }

  const buildInstructions =
    buildSystem === "cmake"
      ? ["mkdir -p build", "cd build", "cmake ..", "make -j$(nproc)"]
      : buildSystem === "meson"
      ? ["meson setup builddir", "cd builddir", "ninja"]
      : buildSystem === "autotools"
      ? ["./configure", "make", "make install"]
      : ["make"];

  out.clikeBuildSystem = buildSystem;
  out.clikeLanguage = language;
  out.clikeBuildInstructions = buildInstructions;
  out.informOnly = true;
  out.informTitle = `${language} project`;
  out.informBody = [
    `Build system: ${prettyBuildSystem(buildSystem)}`,
    `Language: ${language}`,
    "",
    "devhelp doesn't install system compilers.",
    "You'll need:",
    "  macOS:  xcode-select --install",
    "  Ubuntu: sudo apt install build-essential cmake",
    "",
    "Then build:",
    ...buildInstructions.map((s) => `  ${s}`),
  ];
}

function prettyBuildSystem(bs: string): string {
  return bs === "cmake" ? "CMake"
    : bs === "meson" ? "Meson"
    : bs === "autotools" ? "Autotools"
    : "Make";
}

/* -------------------------------------------------------------------------- */
/* Nix — INFORM only                                                           */
/* -------------------------------------------------------------------------- */

async function detectNix(root: string, out: Detected): Promise<void> {
  const hasFlake = await exists(path.join(root, "flake.nix"));
  const hasShellNix = await exists(path.join(root, "shell.nix"));
  const hasDefaultNix = await exists(path.join(root, "default.nix"));
  if (!hasFlake && !hasShellNix && !hasDefaultNix) return;

  const nixType: "flake" | "shell" | "default" =
    hasFlake ? "flake" : hasShellNix ? "shell" : "default";
  out.nixType = nixType;
  out.nixEnterCommand = nixType === "flake" ? "nix develop" : "nix-shell";
  out.nixBuildCommand = nixType === "flake" ? "nix build" : "nix-build";

  // If another ecosystem already drove detection, just note Nix — don't take over.
  if (!isDetectionEmpty(out)) return;

  out.informOnly = true;
  out.informTitle = "Nix project";
  out.informBody = [
    "This project uses Nix for reproducible builds.",
    "",
    `Enter dev shell:  ${out.nixEnterCommand}`,
    `Build:            ${out.nixBuildCommand}`,
    "",
    "Requires Nix to be installed:",
    "  curl -L https://nixos.org/nix/install | sh",
  ];
}

/* -------------------------------------------------------------------------- */
/* Swift / iOS / macOS                                                         */
/* -------------------------------------------------------------------------- */

async function detectSwift(root: string, out: Detected): Promise<void> {
  const hasPackageSwift = await exists(path.join(root, "Package.swift"));
  const hasPodfile = await exists(path.join(root, "Podfile"));
  const hasCartfile = await exists(path.join(root, "Cartfile"));
  const entries = await fs.readdir(root).catch(() => [] as string[]);
  const xcodeProjects = entries.filter((e) => e.endsWith(".xcodeproj"));
  const xcodeWorkspaces = entries.filter((e) => e.endsWith(".xcworkspace"));

  if (!hasPackageSwift && !hasPodfile && !hasCartfile
      && xcodeProjects.length === 0 && xcodeWorkspaces.length === 0) return;

  const buildSystem: "spm" | "cocoapods" | "carthage" | "xcode" =
    hasPackageSwift ? "spm"
    : hasPodfile ? "cocoapods"
    : hasCartfile ? "carthage"
    : "xcode";

  let swiftVersion: string | undefined = out.asdfVersions?.swift;
  const swiftVersionFile = await tryRead(path.join(root, ".swift-version"));
  if (swiftVersionFile) swiftVersion = swiftVersionFile.trim();
  if (!swiftVersion && hasPackageSwift) {
    const pkg = await tryRead(path.join(root, "Package.swift"));
    const m = pkg?.match(/swift-tools-version:(\d+\.\d+)/);
    if (m) swiftVersion = m[1];
  }
  swiftVersion ??= "5.9";

  const targets: string[] = [];
  if (hasPackageSwift) {
    const content = (await tryRead(path.join(root, "Package.swift"))) ?? "";
    if (content.includes(".macOS(")) targets.push("macOS");
    if (content.includes(".iOS(")) targets.push("iOS");
    if (content.includes(".tvOS(")) targets.push("tvOS");
    if (content.includes(".watchOS(")) targets.push("watchOS");
  }
  if (hasPodfile) {
    const pod = (await tryRead(path.join(root, "Podfile"))) ?? "";
    if (/platform :ios/i.test(pod)) targets.push("iOS");
    if (/platform :osx|platform :macos/i.test(pod)) targets.push("macOS");
  }

  const requiresXcode = buildSystem !== "spm" || targets.includes("iOS")
    || xcodeProjects.length > 0;

  out.swiftVersion = swiftVersion;
  out.swiftBuildSystem = buildSystem;
  out.swiftTargets = targets;
  out.swiftRequiresXcode = requiresXcode;

  if (buildSystem === "spm") {
    out.installCommands.push("swift package resolve");
    out.buildCommand = out.buildCommand ?? "swift build";
    out.testCommand = out.testCommand ?? "swift test";
    out.framework = out.framework ?? { name: "Swift Package" };
  } else if (buildSystem === "cocoapods") {
    out.installCommands.push("pod install");
    out.buildCommand = out.buildCommand ?? 'xcodebuild -workspace MyApp.xcworkspace -scheme MyApp -configuration Debug build';
    out.testCommand = out.testCommand ?? 'xcodebuild test -workspace MyApp.xcworkspace -scheme MyApp -destination "platform=iOS Simulator,name=iPhone 15"';
    out.framework = out.framework ?? { name: "iOS (CocoaPods)" };
  } else if (buildSystem === "carthage") {
    out.installCommands.push("carthage update --use-xcframeworks");
    out.framework = out.framework ?? { name: "iOS (Carthage)" };
  } else {
    out.buildCommand = out.buildCommand ?? "xcodebuild -scheme MyApp -configuration Debug build";
    out.framework = out.framework ?? { name: "Xcode project" };
  }
}

/* -------------------------------------------------------------------------- */
/* Haskell                                                                     */
/* -------------------------------------------------------------------------- */

async function detectHaskell(root: string, out: Detected): Promise<void> {
  const hasStackYaml = await exists(path.join(root, "stack.yaml"));
  const entries = await fs.readdir(root).catch(() => [] as string[]);
  const cabalFiles = entries.filter((e) => e.endsWith(".cabal"));
  if (!hasStackYaml && cabalFiles.length === 0) return;

  const buildSystem: "stack" | "cabal" = hasStackYaml ? "stack" : "cabal";

  let ghcVersion: string | undefined = out.asdfVersions?.haskell;
  if (!ghcVersion && hasStackYaml) {
    const stackContent = (await tryRead(path.join(root, "stack.yaml"))) ?? "";
    const ltsMatch = stackContent.match(/resolver:\s*lts-(\d+)\./);
    if (ltsMatch) {
      const lts = parseInt(ltsMatch[1], 10);
      ghcVersion = lts >= 22 ? "9.6" : lts >= 21 ? "9.4"
        : lts >= 20 ? "9.2" : lts >= 18 ? "9.0" : "8.10";
    }
    const resolverGhc = stackContent.match(/resolver:\s*ghc-(\d+\.\d+)/);
    if (resolverGhc) ghcVersion = resolverGhc[1];
  }
  ghcVersion ??= "9.6";

  out.ghcVersion = ghcVersion;
  out.haskellBuildSystem = buildSystem;
  out.installCommands.push(buildSystem === "stack" ? "stack build" : "cabal build");
  out.testCommand = out.testCommand ?? (buildSystem === "stack" ? "stack test" : "cabal test");
  out.buildCommand = out.buildCommand ?? (buildSystem === "stack" ? "stack build" : "cabal build");
  out.framework = out.framework ?? { name: "Haskell" };
}

/* -------------------------------------------------------------------------- */
/* Scala                                                                       */
/* -------------------------------------------------------------------------- */

async function detectScala(root: string, out: Detected): Promise<void> {
  const hasBuildSbt = await exists(path.join(root, "build.sbt"));
  const hasBuildSc = await exists(path.join(root, "build.sc"));
  let hasMavenScala = false;
  if (await exists(path.join(root, "pom.xml"))) {
    const pom = (await tryRead(path.join(root, "pom.xml"))) ?? "";
    hasMavenScala = pom.includes("scala-library") || pom.includes("scala-maven-plugin");
  }
  if (!hasBuildSbt && !hasBuildSc && !hasMavenScala) return;

  const buildSystem: "sbt" | "mill" | "maven" =
    hasBuildSbt ? "sbt" : hasBuildSc ? "mill" : "maven";

  let scalaVersion: string | undefined = out.asdfVersions?.scala;
  if (!scalaVersion && hasBuildSbt) {
    const sbt = (await tryRead(path.join(root, "build.sbt"))) ?? "";
    const m = sbt.match(/scalaVersion\s*:=\s*["']([^"']+)["']/);
    if (m) scalaVersion = m[1].split(".").slice(0, 2).join(".");
  }
  if (!scalaVersion && hasBuildSc) {
    const sc = (await tryRead(path.join(root, "build.sc"))) ?? "";
    const m = sc.match(/scalaVersion\s*=\s*["']([^"']+)["']/);
    if (m) scalaVersion = m[1].split(".").slice(0, 2).join(".");
  }
  scalaVersion ??= "3.3";

  let framework: string | undefined;
  if (hasBuildSbt) {
    const sbt = (await tryRead(path.join(root, "build.sbt"))) ?? "";
    framework = sbt.includes("play") ? "Play Framework"
      : sbt.includes("akka-http") ? "Akka HTTP"
      : sbt.includes("http4s") ? "http4s"
      : sbt.includes("spark") ? "Apache Spark"
      : sbt.includes("zio") ? "ZIO"
      : undefined;
  }

  const hasSbtWrapper = (await exists(path.join(root, "sbt")))
    || (await exists(path.join(root, "sbtx")));

  out.scalaVersion = scalaVersion;
  out.scalaBuildSystem = buildSystem;
  out.scalaFramework = framework;
  out.framework = out.framework ?? { name: framework ?? "Scala" };

  // Override Java install since Scala uses its own toolchain layer
  out.javaVersion = out.javaVersion ?? "17";
  out.javaBuildSystem = buildSystem === "maven" ? "maven" : "gradle";

  const compile = buildSystem === "sbt"
    ? (hasSbtWrapper ? "./sbt compile" : "sbt compile")
    : buildSystem === "mill"
    ? "./mill _.compile"
    : "mvn compile";
  const test = buildSystem === "sbt"
    ? (hasSbtWrapper ? "./sbt test" : "sbt test")
    : buildSystem === "mill"
    ? "./mill _.test"
    : "mvn test";

  // For Scala, we already pushed Java install commands above (gradle dependencies / mvn install).
  // Replace with Scala-native compile.
  out.installCommands = out.installCommands.filter(
    (c) => !/gradle dependencies|mvn install -DskipTests/.test(c)
  );
  out.installCommands.push(compile);
  out.buildCommand = compile;
  out.testCommand = test;
  if (framework === "Play Framework") {
    out.devCommand = hasSbtWrapper ? "./sbt run" : "sbt run";
    out.devUrl = "http://localhost:9000";
  }
}

/* -------------------------------------------------------------------------- */
/* Clojure                                                                     */
/* -------------------------------------------------------------------------- */

async function detectClojure(root: string, out: Detected): Promise<void> {
  const hasDepsEdn = await exists(path.join(root, "deps.edn"));
  const hasProjectClj = await exists(path.join(root, "project.clj"));
  const hasShadowCljs = await exists(path.join(root, "shadow-cljs.edn"));
  if (!hasDepsEdn && !hasProjectClj && !hasShadowCljs) return;

  const buildSystem: "tools.deps" | "leiningen" | "shadow-cljs" =
    hasDepsEdn ? "tools.deps" : hasProjectClj ? "leiningen" : "shadow-cljs";

  let clojureVersion: string | undefined;
  if (hasDepsEdn) {
    const deps = (await tryRead(path.join(root, "deps.edn"))) ?? "";
    const m = deps.match(/org\.clojure\/clojure\s*\{:mvn\/version\s*"([^"]+)"/);
    if (m) clojureVersion = m[1];
  } else if (hasProjectClj) {
    const proj = (await tryRead(path.join(root, "project.clj"))) ?? "";
    const m = proj.match(/\[org\.clojure\/clojure\s*"([^"]+)"\]/);
    if (m) clojureVersion = m[1];
  }
  clojureVersion ??= "1.11";

  const content = hasDepsEdn
    ? (await tryRead(path.join(root, "deps.edn"))) ?? ""
    : hasProjectClj
    ? (await tryRead(path.join(root, "project.clj"))) ?? ""
    : "";
  const framework: string | undefined = content.includes("luminus") ? "Luminus"
    : content.includes("pedestal") ? "Pedestal"
    : content.includes("compojure") ? "Compojure"
    : content.includes("ring") ? "Ring"
    : hasShadowCljs ? "ClojureScript"
    : undefined;

  out.clojureVersion = clojureVersion;
  out.clojureBuildSystem = buildSystem;
  out.clojureFramework = framework;
  out.framework = out.framework ?? { name: framework ?? "Clojure" };

  const installCmd = buildSystem === "tools.deps" ? "clojure -P"
    : buildSystem === "leiningen" ? "lein deps"
    : "npx shadow-cljs classpath";
  out.installCommands.push(installCmd);
  out.testCommand = out.testCommand ?? (buildSystem === "tools.deps" ? "clojure -M:test" : "lein test");
  if (framework === "Ring" || framework === "Compojure") {
    out.devCommand = buildSystem === "leiningen" ? "lein ring server" : "clojure -M:dev";
    out.devUrl = "http://localhost:3000";
  }
}

/* -------------------------------------------------------------------------- */
/* R                                                                           */
/* -------------------------------------------------------------------------- */

async function detectR(root: string, out: Detected): Promise<void> {
  const hasRenvLock = await exists(path.join(root, "renv.lock"));
  const hasDescription = await exists(path.join(root, "DESCRIPTION"));
  const hasRProfile = await exists(path.join(root, ".Rprofile"));

  if (!hasRenvLock && !hasRProfile) {
    if (!hasDescription) return;
    const desc = (await tryRead(path.join(root, "DESCRIPTION"))) ?? "";
    // R DESCRIPTION files have these R-specific fields; not just any DESCRIPTION
    if (!/^(Package|Depends|Imports|Suggests):/m.test(desc)) return;
  }

  const projectType: "renv" | "package" | "script" =
    hasRenvLock ? "renv" : hasDescription ? "package" : "script";

  let rVersion: string | undefined;
  if (hasRenvLock) {
    try {
      const lock = JSON.parse((await tryRead(path.join(root, "renv.lock"))) ?? "{}");
      rVersion = lock?.R?.Version?.split(".").slice(0, 2).join(".");
    } catch { /* ignore */ }
  }
  rVersion ??= "4.3";

  let isShiny = false;
  if (hasRenvLock) {
    const lock = (await tryRead(path.join(root, "renv.lock"))) ?? "";
    if (lock.includes('"shiny"')) isShiny = true;
  }
  if (!isShiny) {
    if ((await exists(path.join(root, "app.R")))
        || (await exists(path.join(root, "server.R")))) isShiny = true;
  }

  out.rVersion = rVersion;
  out.rProjectType = projectType;
  out.rIsShiny = isShiny;
  out.framework = out.framework ?? { name: isShiny ? "R (Shiny)" : "R" };

  if (projectType === "renv") {
    out.installCommands.push('Rscript -e "renv::restore()"');
  } else if (projectType === "package") {
    out.installCommands.push('Rscript -e "devtools::install_deps()"');
  }
  if (isShiny) {
    out.devCommand = 'Rscript -e "shiny::runApp()"';
    out.devUrl = "http://localhost:3838";
  }
  out.testCommand = out.testCommand
    ?? (projectType === "package"
      ? 'Rscript -e "devtools::test()"'
      : 'Rscript -e "testthat::test_dir(\'tests\')"');
}

/* -------------------------------------------------------------------------- */
/* Julia                                                                       */
/* -------------------------------------------------------------------------- */

async function detectJulia(root: string, out: Detected): Promise<void> {
  const hasProjectToml = await exists(path.join(root, "Project.toml"));
  if (!hasProjectToml) return;

  const content = (await tryRead(path.join(root, "Project.toml"))) ?? "";
  // Distinguish Julia from Rust workspace / generic TOML
  if (!content.includes("[deps]")
      && !/^\s*julia\s*=/m.test(content)
      && !/^\s*uuid\s*=/m.test(content)) {
    return;
  }

  let juliaVersion: string | undefined = out.asdfVersions?.julia;
  if (!juliaVersion) {
    const m = content.match(/julia\s*=\s*["']([^"']+)["']/);
    if (m) juliaVersion = m[1].replace(/[^0-9.]/g, "");
  }
  if (!juliaVersion) {
    const manifest = await tryRead(path.join(root, "Manifest.toml"));
    if (manifest) {
      const m = manifest.match(/julia_version\s*=\s*["']([^"']+)["']/);
      if (m) juliaVersion = m[1].split(".").slice(0, 2).join(".");
    }
  }
  juliaVersion ??= "1.10";

  out.juliaVersion = juliaVersion;
  out.framework = out.framework ?? { name: "Julia" };
  out.installCommands.push('julia --project=. -e "using Pkg; Pkg.instantiate()"');
  out.testCommand = out.testCommand ?? 'julia --project=. -e "using Pkg; Pkg.test()"';

  const isWebApp = content.includes("Genie") || content.includes("Oxygen")
    || content.includes("HTTP");
  if (isWebApp) {
    out.devCommand = "julia --project=. src/main.jl";
    out.devUrl = "http://localhost:8080";
  }
}

/* -------------------------------------------------------------------------- */
/* Zig                                                                         */
/* -------------------------------------------------------------------------- */

async function detectZig(root: string, out: Detected): Promise<void> {
  const hasBuildZig = await exists(path.join(root, "build.zig"));
  if (!hasBuildZig) return;

  let zigVersion: string | undefined = out.asdfVersions?.zig;
  const hasBuildZon = await exists(path.join(root, "build.zig.zon"));
  if (!zigVersion && hasBuildZon) {
    const zon = (await tryRead(path.join(root, "build.zig.zon"))) ?? "";
    const m = zon.match(/minimum_zig_version\s*=\s*["']([^"']+)["']/);
    if (m) zigVersion = m[1];
  }
  zigVersion ??= "0.12";

  const buildContent = (await tryRead(path.join(root, "build.zig"))) ?? "";
  const hasRunStep = /"run"/.test(buildContent);
  const hasTestStep = /"test"/.test(buildContent);

  out.zigVersion = zigVersion;
  out.framework = out.framework ?? { name: "Zig" };
  out.installCommands.push("zig build");
  out.buildCommand = "zig build";
  if (hasRunStep) out.devCommand = "zig build run";
  out.testCommand = hasTestStep ? "zig build test" : "zig test src/main.zig";
}

/* -------------------------------------------------------------------------- */
/* OCaml                                                                       */
/* -------------------------------------------------------------------------- */

async function detectOCaml(root: string, out: Detected): Promise<void> {
  const entries = await fs.readdir(root).catch(() => [] as string[]);
  const opamFiles = entries.filter((e) => e.endsWith(".opam"));
  const hasDuneProject = await exists(path.join(root, "dune-project"));
  if (opamFiles.length === 0 && !hasDuneProject) return;

  let ocamlVersion: string | undefined = out.asdfVersions?.ocaml;
  const ocamlVersionFile = await tryRead(path.join(root, ".ocamlversion"));
  if (!ocamlVersion && ocamlVersionFile) ocamlVersion = ocamlVersionFile.trim();
  if (!ocamlVersion && opamFiles.length > 0) {
    const opam = (await tryRead(path.join(root, opamFiles[0]))) ?? "";
    const m = opam.match(/"ocaml"\s*\{>=\s*"([^"]+)"/);
    if (m) ocamlVersion = m[1];
  }
  if (!ocamlVersion && hasDuneProject) {
    const dune = (await tryRead(path.join(root, "dune-project"))) ?? "";
    const m = dune.match(/\(ocaml\s*\(>=\s*([^)\s]+)/);
    if (m) ocamlVersion = m[1].trim();
  }
  ocamlVersion ??= "5.1";

  out.ocamlVersion = ocamlVersion;
  out.ocamlHasDune = hasDuneProject;
  out.framework = out.framework ?? { name: "OCaml" };
  out.installCommands.push("opam install . --deps-only");
  if (hasDuneProject) out.installCommands.push("dune build");
  out.buildCommand = hasDuneProject ? "dune build" : "make";
  out.testCommand = hasDuneProject ? "dune test" : "make test";
}

/* -------------------------------------------------------------------------- */
/* Bazel — adds as build layer; INFORM if it's the only signal                 */
/* -------------------------------------------------------------------------- */

async function detectBazel(root: string, out: Detected): Promise<void> {
  const hasWorkspace = (await exists(path.join(root, "WORKSPACE")))
    || (await exists(path.join(root, "WORKSPACE.bazel")));
  if (!hasWorkspace) return;

  let bazelVersion: string | undefined;
  const bv = await tryRead(path.join(root, ".bazelversion"));
  if (bv) bazelVersion = bv.trim();
  bazelVersion ??= "latest";

  const wsPath = (await exists(path.join(root, "WORKSPACE")))
    ? path.join(root, "WORKSPACE")
    : path.join(root, "WORKSPACE.bazel");
  const wsContent = (await tryRead(wsPath)) ?? "";
  const languages: string[] = [];
  if (/rules_python|py_(binary|library|test)/.test(wsContent)
    || (await exists(path.join(root, "BUILD")))) languages.push("Python");
  if (/rules_java|java_(binary|library|test)/.test(wsContent)) languages.push("Java");
  if (/rules_go|go_repository/.test(wsContent)) languages.push("Go");
  if (/rules_rust|rust_(binary|library)/.test(wsContent)) languages.push("Rust");
  if (/rules_nodejs|nodejs_/.test(wsContent)) languages.push("Node");

  out.bazelVersion = bazelVersion;
  out.bazelLanguages = languages;

  // If Bazel is the only signal so far, push build commands as install
  if (out.installCommands.length === 0) {
    out.installCommands.push("bazel build //...");
    out.testCommand = out.testCommand ?? "bazel test //...";
    out.buildCommand = out.buildCommand ?? "bazel build //...";
    out.framework = out.framework ?? { name: "Bazel monorepo" };
  }
}

/* -------------------------------------------------------------------------- */
/* Infrastructure (INFORM only): Terraform, Ansible, Helm, Pulumi             */
/* -------------------------------------------------------------------------- */

async function detectInfrastructure(root: string, out: Detected): Promise<void> {
  // Only fire if no real ecosystem was detected
  if (!isDetectionEmpty(out)) return;

  const entries = await fs.readdir(root).catch(() => [] as string[]);

  // Terraform
  const tfFiles = entries.filter((e) => e.endsWith(".tf"));
  if (tfFiles.length > 0) {
    let tfVersion: string | undefined;
    const tv = await tryRead(path.join(root, ".terraform-version"));
    if (tv) tfVersion = tv.trim();
    if (!tfVersion) {
      const main = await tryRead(path.join(root, "main.tf"));
      const m = main?.match(/required_version\s*=\s*">= ([^"]+)"/);
      if (m) tfVersion = m[1];
    }
    out.infraType = "terraform";
    out.infraCommands = [
      { label: "Initialize", cmd: "terraform init" },
      { label: "Plan", cmd: "terraform plan" },
      { label: "Apply", cmd: "terraform apply" },
      { label: "Validate", cmd: "terraform validate" },
    ];
    out.informOnly = true;
    out.informTitle = `Terraform project${tfVersion ? ` (>= ${tfVersion})` : ""}`;
    out.informBody = [
      "Infrastructure as code.",
      "",
      "  terraform init",
      "  terraform plan      # preview",
      "  terraform apply     # deploy",
      "  terraform validate  # check syntax",
      "",
      "Install Terraform:",
      "  brew install hashicorp/tap/terraform",
      "  or: https://developer.hashicorp.com/terraform/install",
    ];
    return;
  }

  // Helm — Chart.yaml + templates/ or values.yaml
  const hasChartYaml = await exists(path.join(root, "Chart.yaml"));
  if (hasChartYaml) {
    out.infraType = "helm";
    out.infraCommands = [
      { label: "Update deps", cmd: "helm dependency update" },
      { label: "Lint", cmd: "helm lint ." },
      { label: "Render", cmd: "helm template . --debug" },
      { label: "Install (dry run)", cmd: "helm install my-release . --dry-run" },
    ];
    out.informOnly = true;
    out.informTitle = "Helm chart";
    out.informBody = [
      "Kubernetes Helm chart.",
      "",
      "  helm dependency update",
      "  helm lint .",
      "  helm template . --debug",
      "  helm install my-release . --dry-run",
      "",
      "Install Helm:",
      "  brew install helm",
      "  or: https://helm.sh/docs/intro/install/",
    ];
    return;
  }

  // Ansible
  const ymls = entries.filter((e) => e.endsWith(".yml") || e.endsWith(".yaml"));
  const hasPlaybook = ymls.some((f) => /playbook|site\.ya?ml/i.test(f));
  const hasRolesDir = await exists(path.join(root, "roles"));
  const hasReqYml = await exists(path.join(root, "requirements.yml"));
  if (hasPlaybook || (hasRolesDir && hasReqYml)) {
    out.infraType = "ansible";
    out.infraCommands = [
      { label: "Install roles", cmd: "ansible-galaxy install -r requirements.yml" },
      { label: "Run playbook", cmd: "ansible-playbook playbook.yml -i inventory" },
      { label: "Syntax check", cmd: "ansible-playbook playbook.yml --syntax-check" },
      { label: "Dry run", cmd: "ansible-playbook playbook.yml --check" },
    ];
    out.informOnly = true;
    out.informTitle = "Ansible project";
    out.informBody = [
      "Configuration management with Ansible.",
      "",
      "  ansible-galaxy install -r requirements.yml",
      "  ansible-playbook playbook.yml -i inventory",
      "  ansible-playbook playbook.yml --syntax-check",
      "  ansible-playbook playbook.yml --check",
      "",
      "Install Ansible:",
      "  pip install ansible",
      "  or: brew install ansible",
    ];
    return;
  }

  // Pulumi
  if (await exists(path.join(root, "Pulumi.yaml"))) {
    out.infraType = "pulumi";
    out.infraCommands = [
      { label: "Preview", cmd: "pulumi preview" },
      { label: "Deploy", cmd: "pulumi up" },
      { label: "Destroy", cmd: "pulumi destroy" },
    ];
    out.informOnly = true;
    out.informTitle = "Pulumi project";
    out.informBody = [
      "Infrastructure as code with Pulumi.",
      "",
      "  pulumi preview",
      "  pulumi up",
      "  pulumi destroy",
      "",
      "Install Pulumi:",
      "  brew install pulumi/tap/pulumi",
      "  or: https://www.pulumi.com/docs/install/",
    ];
  }
}
