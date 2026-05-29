import chalk from "chalk";
import boxen from "boxen";
import { Listr } from "listr2";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execa } from "execa";
import { simpleGit } from "simple-git";
import ora from "ora";
import { detect, isDetectionEmpty, type Detected, type PkgManager } from "./detect.js";
import { findRecovery } from "./recovery.js";
import {
  detectSystemPackageManager,
  systemInstallCommand,
  commandExistsProbe,
  pickShell,
  WINDOWS_SHELL_HELP,
  type SystemDep,
} from "./platform.js";
import {
  detectAvailable,
  pickNodeManager,
  pickPythonManager,
  nodeInstallCommand,
  pythonInstallCommand,
} from "./version-managers.js";
import { writeRunLog, type RunLogPayload } from "./run-log.js";
import { findUnsafeVersionField } from "./versions.js";
import { writeDevhelpLock, checkLockDrift, LOCK_FILENAME } from "./lockfile.js";
import { loadRecipe, type DevhelpRecipe } from "./recipe.js";
import { verifyTests, verifyDevServer, type VerifyCheck } from "./verify.js";
import { writeVscodeLaunch } from "./vscode.js";
import { detectSecretsProvider, secretsCommand } from "./secrets.js";

export interface SetupOptions {
  request: string;
  cwd: string;
  dryRun: boolean;
  verbose?: boolean;
  json?: boolean;
  fix?: boolean;
  writeLock?: boolean;
  withServices?: boolean;
  verify?: boolean;
  vscode?: boolean;
  secrets?: boolean;
}

interface PlaybookCtx {
  request: string;
  cwd: string;
  dryRun: boolean;
  verbose: boolean;
  json: boolean;
  fix: boolean;
  writeLock: boolean;
  withServices: boolean;
  doVerify: boolean;
  vscode: boolean;
  secrets: boolean;
  verifyChecks?: VerifyCheck[];
  projectDir: string;
  cloned: boolean;
  cloneSkipped: boolean;
  // A throwaway clone made during a dry run so detection has a real repo to read;
  // removed before returning so a dry run leaves the working dir untouched.
  dryRunTempClone?: string;
  detected?: Detected;
  done: string[];
  warnings: string[];
  failedSteps: { name: string; error: string; cause?: string; command?: string; recovery?: string }[];
  criticalStepFailed: boolean;
  nothingDetected: boolean;
  // Whether <projectDir>/.env existed before the run started. Snapshotted up
  // front so --secrets can refuse to clobber a user's pre-existing .env while
  // still populating one that devhelp itself created from a template this run.
  envPreexisted: boolean;
}

export async function runSetup(opts: SetupOptions): Promise<number> {
  if (!opts.json) printBanner(opts);

  const ctx: PlaybookCtx = {
    request: opts.request,
    cwd: opts.cwd,
    dryRun: opts.dryRun,
    verbose: !!opts.verbose,
    json: !!opts.json,
    fix: !!opts.fix,
    writeLock: !!opts.writeLock,
    withServices: !!opts.withServices,
    doVerify: !!opts.verify,
    vscode: !!opts.vscode,
    secrets: !!opts.secrets,
    projectDir: opts.cwd,
    cloned: false,
    cloneSkipped: false,
    done: [],
    warnings: [],
    failedSteps: [],
    criticalStepFailed: false,
    nothingDetected: false,
    envPreexisted: false,
  };

  try {
  // Native-Windows guard: our install commands are bash syntax. Warn clearly
  // up front rather than letting each step fail cryptically.
  if (pickShell() === null) {
    ctx.warnings.push(WINDOWS_SHELL_HELP);
    say(ctx, chalk.yellow("  ⚠  " + WINDOWS_SHELL_HELP));
  }

  // Run clone+detect outside the listr task list so we can decide what to include.
  await runCloneStep(ctx);
  // Snapshot now, before setupEnv may create .env, so --secrets can tell a
  // user's pre-existing .env apart from one devhelp creates during this run.
  ctx.envPreexisted = await exists(path.join(ctx.projectDir, ".env"));
  ctx.detected = await detect(ctx.projectDir);

  // Security gate: version/toolchain values come from the cloned repo's
  // manifests and are interpolated into shell commands by the installers
  // below. Refuse to proceed if any carries shell metacharacters.
  const unsafe = findUnsafeVersionField(ctx.detected as unknown as Record<string, unknown>);
  if (unsafe) {
    throw new Error(
      `Refusing to run: the repo's manifest sets ${unsafe.field} to ${JSON.stringify(unsafe.value)}, ` +
        `which contains characters not allowed in a version string. This is a shell-injection risk, ` +
        `so devhelp will not install anything for this repo.`,
    );
  }

  // Project recipe: maintainer-declared overrides + extra steps. Applied to the
  // detection result so the rest of the flow (panel, lock, tasks) sees them.
  const recipe = await loadRecipe(ctx.projectDir);
  if (recipe) applyRecipe(ctx.detected, recipe);

  // If a .devhelp.lock is present, warn when detection has drifted from it.
  for (const drift of await checkLockDrift(ctx.projectDir, ctx.detected)) {
    ctx.warnings.push(`.devhelp.lock drift — ${drift}`);
  }

  if (isDetectionEmpty(ctx.detected)) ctx.nothingDetected = true;
  // Print a one-line detection summary before the listr UI starts.
  if (!ctx.json) {
    console.log(chalk.green("  ✔"), chalk.bold("Detected:"), describe(ctx.detected));
    console.log();
  }
  ctx.done.push(`detected ${describe(ctx.detected)}`);

  type T = { title: string; run: (c: PlaybookCtx, task: any) => Promise<void>; critical?: boolean };
  const d = ctx.detected;
  const candidates: T[] = [];
  if (d.hasSubmodules) {
    candidates.push({
      title: "Initializing git submodules",
      critical: true,
      run: (c, task) =>
        runShell("git submodule update --init --recursive", c.projectDir, c, task, "submodules"),
    });
  }
  if (d.nodeVersion && !d.nodeIsToolingOnly && !d.bunIsRuntime) {
    candidates.push({ title: `Installing Node ${d.nodeVersion}`, critical: true, run: (c, task) => installNode(d.nodeVersion!, c, task) });
  }
  if (d.bunIsRuntime) {
    candidates.push({ title: `Installing Bun ${d.bunVersion ?? "latest"}`, critical: true, run: (c, task) => installBun(d.bunVersion ?? "latest", c, task) });
  }
  if (d.pythonVersion) {
    candidates.push({ title: `Installing Python ${d.pythonVersion}`, critical: true, run: (c, task) => installPython(d.pythonVersion!, c, task) });
  }
  if (d.rustToolchain && !d.rustIsOptional) {
    candidates.push({ title: `Installing Rust ${d.rustToolchain}`, critical: true, run: (c, task) => installRust(d.rustToolchain!, c, task) });
  }
  if (d.goVersion) {
    candidates.push({ title: `Installing Go ${d.goVersion}`, critical: true, run: (c, task) => installGo(d.goVersion!, c, task) });
  }
  if (d.rubyVersion) {
    candidates.push({ title: `Installing Ruby ${d.rubyVersion}`, critical: true, run: (c, task) => installRuby(d.rubyVersion!, c, task) });
  }
  if (d.phpVersion) {
    candidates.push({ title: `Installing PHP ${d.phpVersion}`, critical: true, run: (c, task) => installPHP(d.phpVersion!, c, task) });
  }
  if (d.elixirVersion) {
    candidates.push({ title: `Installing Elixir ${d.elixirVersion}`, critical: true, run: (c, task) => installElixir(d.elixirVersion!, d.erlangVersion ?? "26", c, task) });
  }
  if (d.javaVersion) {
    candidates.push({ title: `Installing Java ${d.javaVersion}`, critical: true, run: (c, task) => installJava(d.javaVersion!, c, task) });
  }
  if (d.dotnetVersion) {
    candidates.push({ title: `Installing .NET ${d.dotnetVersion}`, critical: true, run: (c, task) => installDotnet(d.dotnetVersion!, c, task) });
  }
  if (d.dartSdkVersion) {
    candidates.push({ title: `Installing ${d.dartIsFlutter ? "Flutter" : "Dart"} ${d.dartSdkVersion}`, critical: true, run: (c, task) => installFlutter(d.dartSdkVersion!, !!d.dartIsFlutter, c, task) });
  }
  if (d.denoVersion) {
    candidates.push({ title: `Installing Deno ${d.denoVersion}`, critical: true, run: (c, task) => installDeno(d.denoVersion!, c, task) });
  }
  if (d.swiftVersion) {
    candidates.push({ title: `Installing Swift ${d.swiftVersion}`, critical: true, run: (c, task) => installSwift(d.swiftVersion!, !!d.swiftRequiresXcode, d.swiftBuildSystem === "cocoapods", c, task) });
  }
  if (d.ghcVersion) {
    candidates.push({ title: `Installing GHC ${d.ghcVersion}`, critical: true, run: (c, task) => installHaskell(d.ghcVersion!, d.haskellBuildSystem === "stack", c, task) });
  }
  if (d.scalaVersion) {
    candidates.push({ title: `Installing Scala ${d.scalaVersion}`, critical: true, run: (c, task) => installScala(d.scalaVersion!, d.scalaBuildSystem ?? "sbt", c, task) });
  }
  if (d.clojureVersion) {
    candidates.push({ title: `Installing Clojure ${d.clojureVersion}`, critical: true, run: (c, task) => installClojure(d.clojureBuildSystem ?? "tools.deps", c, task) });
  }
  if (d.rVersion) {
    candidates.push({ title: `Installing R ${d.rVersion}`, critical: true, run: (c, task) => installR(d.rVersion!, c, task) });
  }
  if (d.juliaVersion) {
    candidates.push({ title: `Installing Julia ${d.juliaVersion}`, critical: true, run: (c, task) => installJulia(d.juliaVersion!, c, task) });
  }
  if (d.zigVersion) {
    candidates.push({ title: `Installing Zig ${d.zigVersion}`, critical: true, run: (c, task) => installZig(d.zigVersion!, c, task) });
  }
  if (d.ocamlVersion) {
    candidates.push({ title: `Installing OCaml ${d.ocamlVersion}`, critical: true, run: (c, task) => installOCaml(d.ocamlVersion!, c, task) });
  }
  if (d.bazelVersion) {
    candidates.push({ title: `Installing Bazel`, critical: true, run: (c, task) => installBazel(c, task) });
  }
  if (d.isAndroid) {
    candidates.push({ title: `Android SDK check`, run: (c, task) => androidSdkCheck(c, task) });
  }
  for (const cmd of d.installCommands) {
    const note = slowStepNote("deps", d.monorepo);
    candidates.push({
      title: note ? `Installing deps · ${cmd} (${note})` : `Installing deps · ${cmd}`,
      critical: true,
      run: async (c, task) => {
        let ran = cmd;
        try {
          await runShell(wrapForRuntime(cmd, c.detected!), c.projectDir, c, task);
        } catch (e) {
          const alt = npmCiFallback(cmd, e instanceof Error ? e.message : String(e));
          if (!alt) throw e;
          c.warnings.push(`npm ci rejected the committed lockfile (out of sync); fell back to "${alt}"`);
          task.title = `Installing deps · ${alt} (npm ci rejected the lockfile — retrying)`;
          await runShell(wrapForRuntime(alt, c.detected!), c.projectDir, c, task);
          ran = alt;
        }
        task.title = `Installed · ${ran}`;
        c.done.push(ran);
      },
    });
  }
  if (d.envTemplates.length) {
    candidates.push({ title: "Setting up environment files", run: (c, task) => setupEnv(c, task) });
  }
  if (ctx.withServices && d.dockerComposeFiles.length) {
    candidates.push({ title: "Starting services (docker compose)", critical: true, run: (c, task) => startServices(c, task) });
  }
  if (d.prismaSchemas.length) {
    candidates.push({ title: "Generating Prisma client", run: (c, task) => prismaGenerate(c, task) });
  }
  if (ctx.withServices && (d.prismaSchemas.length || d.migrationCommands.length)) {
    candidates.push({ title: "Applying database migrations", critical: true, run: (c, task) => dbProvision(c, task) });
  }
  if (d.hasPlaywright) {
    candidates.push({ title: "Installing Playwright browsers", run: (c, task) => playwrightInstall(c, task) });
  }
  if (ctx.secrets && d.envTemplates.length) {
    candidates.push({ title: "Populating .env from secrets provider", run: (c, task) => populateSecrets(c, task) });
  }
  if (ctx.vscode && !ctx.nothingDetected) {
    candidates.push({ title: "Generating .vscode/launch.json", run: (c, task) => generateVscode(c, task) });
  }
  // Maintainer recipe steps run last — after deps, env, codegen are in place.
  for (const cmd of recipe?.postInstall ?? []) {
    candidates.push({
      title: `Recipe · ${truncate(cmd, 60)}`,
      critical: true,
      run: async (c, task) => {
        await runShell(wrapForRuntime(cmd, c.detected!), c.projectDir, c, task);
        task.title = `Recipe · ${cmd}`;
        c.done.push(`recipe: ${cmd}`);
      },
    });
  }

  const tasks = candidates.map((t) => ({
    title: t.title,
    task: t.critical ? critical(t.run) : t.run,
  }));
  const listr = new Listr<PlaybookCtx>(tasks, {
    concurrent: false,
    exitOnError: false,
    // Silent renderer in --json mode so nothing but the JSON reaches stdout.
    // Pinning only the Ctx generic narrows `renderer` to the default class, so
    // assert the (valid at runtime) "silent" value past the type.
    renderer: (ctx.json ? "silent" : "default") as "default",
  });

  try {
    await listr.run(ctx);
  } catch {
    /* errors already captured */
  }

  // Reproducibility artifact: pin the resolved versions, unless detection found
  // nothing worth pinning. In a dry run we only say what we'd write.
  if (ctx.writeLock && ctx.detected && !ctx.nothingDetected) {
    if (ctx.dryRun) {
      say(ctx, chalk.dim(`  ↪ [dry-run] would write ${LOCK_FILENAME}`));
    } else {
      const lockPath = await writeDevhelpLock(ctx.projectDir, ctx.detected);
      if (lockPath) {
        ctx.done.push(`wrote ${LOCK_FILENAME}`);
        say(ctx, chalk.green("  ✔"), `Wrote ${prettyPath(lockPath)}`);
      }
    }
  }

  const status = computeStatus(ctx);

  // Verification only makes sense on a setup that actually succeeded.
  if (ctx.doVerify && status === "READY" && !ctx.dryRun) {
    ctx.verifyChecks = await runVerification(ctx);
  }

  // A dry run leaves nothing behind: drop the throwaway clone we read from.
  await cleanupDryRunTempClone(ctx);

  const payload = buildRunLogPayload(ctx, status);
  if (ctx.verifyChecks) payload.verify = ctx.verifyChecks;
  const logPath = await writeRunLog(payload);

  const verifyFailed = (ctx.verifyChecks ?? []).some((c) => !c.ok);

  if (ctx.json) {
    console.log(JSON.stringify({ ...payload, logPath }, null, 2));
    if (status === "READY" || status === "INFORM") return verifyFailed ? 1 : 0;
    return 1;
  }

  const exitCode = printSummary(ctx);
  if (logPath) {
    console.log(chalk.dim(`  Full log: ${prettyPath(logPath)}`));
    console.log();
  }
  // A passed setup whose verification failed is still a non-zero outcome.
  return exitCode === 0 && verifyFailed ? 1 : exitCode;
  } finally {
    await cleanupDryRunTempClone(ctx);
  }
}

/* -------------------------------------------------------------------------- */
/* doctor — read-only diagnosis of an existing checkout                        */
/* -------------------------------------------------------------------------- */

export interface DoctorOptions {
  cwd: string;
  json?: boolean;
}

interface ToolCheck {
  tool: string;
  want?: string;
  have: string | null;
  status: "ok" | "missing" | "mismatch";
}

function parseVer(s: string): number[] | null {
  const m = s.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
}

/**
 * Compare what the repo wants against what's installed, at the granularity of
 * the wanted spec (want "20" → compare major; "3.13" → compare major.minor).
 * A leading `>=`/`>` marks a floor (engines ">=18"): any newer runtime satisfies
 * it, so only a strictly-lower installed version is a mismatch. Without an
 * operator the spec is an exact pin. Non-numeric specs (lts/*, stable, latest)
 * can't be compared, so "present" counts as ok — we don't cry wolf.
 */
export function versionStatus(
  want: string | undefined,
  have: string | null,
): "ok" | "missing" | "mismatch" {
  if (!have) return "missing";
  if (!want) return "ok";
  const floor = /^\s*>=?/.test(want);
  const spec = want.replace(/^\s*>=?\s*/, "").trim();
  if (!/^\d/.test(spec)) return "ok";
  const w = parseVer(spec);
  const h = parseVer(have);
  if (!w || !h) return "ok";
  for (let i = 0; i < w.length; i++) {
    if (h[i] === undefined) return "ok"; // have is coarser than want — can't disprove
    if (floor) {
      if (h[i] > w[i]) return "ok"; // strictly above the floor at this level
      if (h[i] < w[i]) return "mismatch";
      // equal → check the next, finer component
    } else if (h[i] !== w[i]) {
      return "mismatch";
    }
  }
  return "ok";
}

/** Probe table: which CLI proves a detected runtime is installed. */
function doctorProbes(d: Detected): { tool: string; want?: string; bin: string; args: string[] }[] {
  const p: { tool: string; want?: string; bin: string; args: string[] }[] = [];
  if (d.nodeVersion && !d.nodeIsToolingOnly && !d.bunIsRuntime)
    p.push({
      tool: "Node",
      want: d.nodeVersionIsFloor ? `>=${d.nodeVersion}` : d.nodeVersion,
      bin: "node",
      args: ["--version"],
    });
  if (d.bunIsRuntime) p.push({ tool: "Bun", want: d.bunVersion, bin: "bun", args: ["--version"] });
  if (d.pythonVersion) p.push({ tool: "Python", want: d.pythonVersion, bin: "python3", args: ["--version"] });
  if (d.rustToolchain && !d.rustIsOptional) p.push({ tool: "Rust", want: d.rustToolchain, bin: "rustc", args: ["--version"] });
  if (d.goVersion) p.push({ tool: "Go", want: d.goVersion, bin: "go", args: ["version"] });
  if (d.rubyVersion) p.push({ tool: "Ruby", want: d.rubyVersion, bin: "ruby", args: ["--version"] });
  if (d.phpVersion) p.push({ tool: "PHP", want: d.phpVersion, bin: "php", args: ["--version"] });
  if (d.javaVersion) p.push({ tool: "Java", want: d.javaVersion, bin: "java", args: ["-version"] });
  if (d.dotnetVersion) p.push({ tool: ".NET", want: d.dotnetVersion, bin: "dotnet", args: ["--version"] });
  if (d.denoVersion) p.push({ tool: "Deno", want: d.denoVersion, bin: "deno", args: ["--version"] });
  if (d.pkgManager && !d.nodeIsToolingOnly)
    p.push({ tool: d.pkgManager, bin: d.pkgManager, args: ["--version"] });
  return p;
}

async function diagnose(d: Detected): Promise<ToolCheck[]> {
  const checks = await Promise.all(
    doctorProbes(d).map(async (probe) => {
      const have = await tryVersion(probe.bin, probe.args);
      return { tool: probe.tool, want: probe.want, have, status: versionStatus(probe.want, have) };
    }),
  );
  return checks;
}

export interface DoctorReport {
  projectDir: string;
  summary: string;
  unsupported: boolean;
  checks: ToolCheck[];
  missing: string[];
  mismatched: string[];
  services: string[];
  envTemplates: string[];
  prismaSchemas: string[];
}

/** Pure diagnosis (no printing) — reused by `doctor` output and the MCP server. */
export async function diagnoseProject(cwd: string): Promise<DoctorReport> {
  const d = await detect(cwd);
  const empty = isDetectionEmpty(d);
  const checks = empty ? [] : await diagnose(d);
  return {
    projectDir: cwd,
    summary: describe(d),
    unsupported: empty,
    checks,
    missing: checks.filter((c) => c.status === "missing").map((c) => c.tool),
    mismatched: checks.filter((c) => c.status === "mismatch").map((c) => c.tool),
    services: d.dockerComposeFiles,
    envTemplates: d.envTemplates,
    prismaSchemas: d.prismaSchemas,
  };
}

export async function runDoctor(opts: DoctorOptions): Promise<number> {
  const report = await diagnoseProject(opts.cwd);
  const { unsupported: empty, checks, missing, mismatched } = report;
  const problems = missing.length + mismatched.length;
  // detect again only for the unrecognized-manifest hint in the empty case.
  const d = await detect(opts.cwd);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return empty || problems ? 1 : 0;
  }

  console.log();
  console.log(chalk.cyan.bold("  devhelp doctor"), chalk.dim(`· ${prettyPath(opts.cwd)}`));
  console.log();

  if (empty) {
    console.log(chalk.yellow("  No recognized stack here."));
    if (d.unrecognizedManifests.length)
      console.log(chalk.dim(`  Found: ${d.unrecognizedManifests.join(", ")}`));
    console.log();
    return 1;
  }

  console.log(chalk.bold("  Detected:"), describe(d));
  console.log();
  console.log(chalk.bold("  Toolchain:"));
  for (const c of checks) {
    const want = c.want ? chalk.dim(` (wants ${c.want})`) : "";
    if (c.status === "ok") console.log(chalk.green(`  ✔ ${c.tool}`) + want + chalk.dim(` — ${c.have}`));
    else if (c.status === "mismatch")
      console.log(chalk.yellow(`  ⚠ ${c.tool}`) + want + chalk.dim(` — found ${c.have}`));
    else console.log(chalk.red(`  ✗ ${c.tool}`) + want + chalk.dim(" — not on PATH"));
  }

  const notes: string[] = [];
  if (d.serviceComposeFiles.length)
    notes.push(`services: docker compose up -d  (${d.serviceComposeFiles.slice(0, 2).join(", ")})`);
  if (d.envTemplates.length) notes.push(`env: copy ${d.envTemplates.length} template(s) → .env`);
  if (d.prismaSchemas.length) notes.push(`prisma: ${d.prismaSchemas.length} schema(s) to generate`);
  if (notes.length) {
    console.log();
    console.log(chalk.bold("  Setup needs:"));
    for (const n of notes) console.log(chalk.dim(`  • ${n}`));
  }

  console.log();
  if (problems) {
    const bits: string[] = [];
    if (missing.length) bits.push(`${missing.length} missing`);
    if (mismatched.length) bits.push(`${mismatched.length} version mismatch`);
    console.log(chalk.yellow(`  ${bits.join(", ")} — run: `) + chalk.cyan("devhelp \"set up this project\""));
  } else {
    console.log(chalk.green("  Toolchain looks complete."));
  }
  console.log();
  return problems ? 1 : 0;
}

export function computeStatus(ctx: PlaybookCtx): RunLogPayload["status"] {
  if (ctx.criticalStepFailed) return "INCOMPLETE";
  if (ctx.detected?.informOnly) return "INFORM";
  if (ctx.nothingDetected) return "UNSUPPORTED";
  return "READY";
}

function buildRunLogPayload(ctx: PlaybookCtx, status: RunLogPayload["status"]): RunLogPayload {
  return {
    timestamp: new Date().toISOString(),
    request: ctx.request,
    cwd: ctx.cwd,
    projectDir: ctx.projectDir,
    dryRun: ctx.dryRun,
    status,
    detected: ctx.detected as unknown as Record<string, unknown> | undefined,
    executedSteps: [...ctx.done],
    failedSteps: [...ctx.failedSteps],
    warnings: [...ctx.warnings],
    env: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Critical-step wrapper                                                       */
/* -------------------------------------------------------------------------- */

function critical(
  fn: (c: PlaybookCtx, task: any) => Promise<void>,
): (c: PlaybookCtx, task: any) => Promise<void> {
  return async (c, task) => {
    const stepName = typeof task.title === "string" ? task.title : "step";
    try {
      await fn(c, task);
    } catch (e) {
      let lastError = e;
      const match = findRecovery(e instanceof Error ? e.message : String(e));

      // Auto-fix + retry once: only when --fix is on, we're not in a dry run,
      // and the matched rule maps to a known system-level dependency.
      if (c.fix && !c.dryRun && match?.systemDeps?.length) {
        const fixed = await attemptAutoFix(c, task, match.systemDeps);
        if (fixed) {
          try {
            await fn(c, task);
            return; // retry succeeded — step is done, no failure recorded
          } catch (e2) {
            lastError = e2;
          }
        }
      }

      const err = lastError instanceof Error ? lastError.message : String(lastError);
      c.criticalStepFailed = true;
      const finalMatch = findRecovery(err);
      const { command, cause } = summarizeFailure(err);
      c.failedSteps.push({
        name: stepName,
        error: cause,
        cause: finalMatch?.cause,
        command,
        recovery: finalMatch?.remediation,
      });
      throw lastError;
    }
  };
}

/**
 * Install the system deps a recovery rule points at, using the detected OS
 * package manager. Returns true only if the install command actually ran and
 * succeeded, so the caller knows whether a retry is worth attempting.
 */
async function attemptAutoFix(
  ctx: PlaybookCtx,
  task: any,
  deps: SystemDep[],
): Promise<boolean> {
  const mgr = await detectSystemPackageManager();
  if (!mgr) return false;
  const cmd = systemInstallCommand(mgr, deps);
  if (!cmd) return false;
  task.title = `Auto-fix: ${truncate(cmd, 70)}`;
  try {
    await runShell(cmd, ctx.projectDir, ctx, task);
    ctx.done.push(`auto-fix: ${cmd}`);
    return true;
  } catch {
    return false; // fix itself failed — fall back to the hint
  }
}

function firstLine(s: string): string {
  return s.split("\n").find((l) => l.trim().length > 0) ?? s;
}

/**
 * Pull the useful bits out of a thrown step error. runShell formats failures as
 *   Command failed (exit N):
 *   $ <command>
 *   <tail of stdout/stderr>
 * so the bare first line ("Command failed…") is noise. We recover the failing
 * command (to offer a re-run) and the most informative tail line (the actual
 * cause — an error/refused/not-found line, else the last non-empty line).
 */
export function summarizeFailure(raw: string): { command?: string; cause: string } {
  const lines = raw.split("\n").map(stripAnsi);
  const cmdLine = lines.find((l) => l.startsWith("$ "));
  const command = cmdLine ? unwrapRuntime(cmdLine.slice(2).trim()) : undefined;

  // The reason the runner recorded — "exit 1", "timed out after 10m", etc.
  const reason = lines.find((l) => /^Command failed \(/.test(l))?.match(/^Command failed \((.+)\):/)?.[1];

  const body = lines
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith("$ ") &&
        !/^Command failed \(/.test(l) &&
        // Drop progress/log noise — it's never the real cause and crowds out the error.
        !/^(Downloading|Downloaded|Fetching|Resolving|Building|Built|Compiling|Installing|Updating|Prepared|Audited|Progress|info |npm warn|warning|remote:|Receiving|Counting|Compressing|Unpacking|\d+%|[─-▟⠀-⣿])/i.test(
          l,
        ),
    );
  // Prefer a line that names a concrete cause over a bare error code/banner.
  const strong = body.find((l) =>
    /\b(cannot|can't|refused|not found|no such|denied|fatal|unreachable|conflict|already in use|timed out|P\d{4})\b/i.test(
      l,
    ),
  );
  const weak = body.find((l) => /\b(error|err!|failed|E[A-Z]{2,})\b/.test(l));
  // reason ("timed out after 10m", "exit 1") only as a last resort — when the
  // output carried no real content, just progress noise we filtered away.
  const cause = strong ?? weak ?? body[body.length - 1] ?? reason ?? firstLine(stripAnsi(raw));
  return { command, cause };
}

/** Remove ANSI SGR/color escapes so captured output is plain text. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Render a fatal error (one thrown outside the step framework — a failed clone,
 * the security gate) with the same what/why/fix discipline as the INCOMPLETE
 * panel, instead of dumping the raw multi-page error (e.g. git's progress spam)
 * to stderr. Always actionable. Used by the CLI's top-level catch.
 */
export function formatFatalError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const { cause, command } = summarizeFailure(raw);
  const match = findRecovery(raw);
  const lines = [
    chalk.red.bold("devhelp couldn't finish"),
    "",
    chalk.red(`  ✗ ${truncate(match?.cause ?? cause, 120)}`),
  ];
  if (match?.remediation) lines.push(chalk.yellow(`  fix:  ${match.remediation}`));
  else if (command) lines.push(chalk.yellow(`  fix:  Re-run to see the full error:  ${truncate(command, 100)}`));
  else lines.push(chalk.yellow(`  fix:  Double-check the repo name/URL and your network, then re-run`));
  return lines.join("\n");
}

/**
 * Strip the nvm/runtime preamble wrapForRuntime prepends, leaving the real
 * command a user would actually re-run (e.g. `npm ci`, not the `export NVM_DIR…
 * nvm use…;` shell dance). No-op for commands that weren't wrapped.
 */
function unwrapRuntime(command: string): string {
  const m = command.match(/nvm\.sh.*?;\s*(.+)$/s);
  return m ? m[1].trim() : command;
}

/**
 * A short, honest "this is meant to take a while" note for steps that run for
 * minutes with little or no output. Without it the silence reads as a hang and
 * a first-time user Ctrl-Cs mid-compile. We don't fabricate ETAs — just name
 * what's happening and that it's slow. Returns "" when there's nothing worth
 * warning about (e.g. a small single-package install finishes quickly).
 */
export function slowStepNote(kind: "node" | "python" | "deps", monorepo?: string): string {
  switch (kind) {
    case "node":
      return "downloading Node…";
    case "python":
      return "compiling from source — can take several minutes";
    case "deps":
      return monorepo ? "large monorepos can take a few minutes" : "";
  }
}

/**
 * `npm ci` is strict: it aborts (EUSAGE) when the committed package-lock.json is
 * out of sync with package.json, or absent. For onboarding, reaching a working
 * install matters more than lockfile purity, so fall back to `npm install` once.
 * Returns the fallback command, or null when the failure isn't a recoverable
 * `npm ci` lockfile problem (the caller then rethrows). Only `npm ci` qualifies —
 * pnpm/yarn/bun installs are left to fail honestly.
 */
export function npmCiFallback(cmd: string, errorMessage: string): string | null {
  if (!/^npm ci\b/.test(cmd)) return null;
  const lockfileTrouble =
    /EUSAGE|can only install|out of sync|Missing: .* from lock file|Invalid: .* lock file|lock file('s)? .* (?:does not|doesn't) (?:match|satisfy)/i;
  if (!lockfileTrouble.test(errorMessage)) return null;
  return cmd.replace(/^npm ci\b/, "npm install");
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                       */
/* -------------------------------------------------------------------------- */

/** console.log gated on non-JSON mode, so --json output stays clean. */
function say(ctx: PlaybookCtx, ...args: unknown[]): void {
  if (!ctx.json) console.log(...args);
}

/** Merge a maintainer recipe's command overrides into the detection result. */
function applyRecipe(d: Detected, recipe: DevhelpRecipe): void {
  if (recipe.dev) d.devCommand = recipe.dev;
  if (recipe.test) d.testCommand = recipe.test;
  if (recipe.build) d.buildCommand = recipe.build;
}

/** Run tests + dev-server probe to prove the setup actually works. */
async function runVerification(ctx: PlaybookCtx): Promise<VerifyCheck[]> {
  const d = ctx.detected!;
  const checks: VerifyCheck[] = [];
  say(ctx, chalk.dim("  ↪ Verifying setup…"));

  if (d.testCommand) {
    const c = await verifyTests(
      wrapForRuntime(d.testCommand, d),
      ctx.projectDir,
      `tests · ${d.testCommand}`,
    );
    say(ctx, verifyLine(c));
    checks.push(c);
  }
  if (!d.isLibrary && d.devCommand && d.devUrl) {
    const c = await verifyDevServer(
      wrapForRuntime(d.devCommand, d),
      ctx.projectDir,
      d.devUrl,
      `dev server · ${d.devUrl}`,
    );
    say(ctx, verifyLine(c));
    checks.push(c);
  }
  return checks;
}

function verifyLine(c: VerifyCheck): string {
  return c.ok
    ? chalk.green(`  ✔ ${c.name} — ${c.detail}`)
    : chalk.red(`  ✗ ${c.name} — ${c.detail}`);
}

async function runCloneStep(ctx: PlaybookCtx): Promise<void> {
  const repo = extractRepo(ctx.request);
  if (!repo) return;
  // Archive check — only for GitHub URLs and only when we have owner/name on hand.
  if (repo.owner && repo.repo) {
    const archived = await checkGitHubArchived(repo.owner, repo.repo);
    if (archived) {
      const msg = `${repo.owner}/${repo.repo} is archived on GitHub — read-only, no PRs accepted`;
      ctx.warnings.push(msg);
      say(ctx, chalk.yellow("  ⚠  Heads up: ") + msg);
    }
  }
  const dest = path.resolve(ctx.cwd, repo.name);
  if (await exists(dest)) {
    ctx.projectDir = dest;
    ctx.cloneSkipped = true;
    say(ctx, chalk.green("  ✔"), chalk.bold("Repo present:"), prettyPath(dest));
    return;
  }
  if (ctx.dryRun) {
    // Clone shallowly so detection sees the real manifests and the plan is
    // accurate; the clone is removed before runSetup returns. Cloning is the
    // only read-only-from-the-remote way to know what we'd do.
    try {
      await cloneWithProgress(ctx, repo.url, dest, chalk.dim(`[dry-run] cloning ${repo.url} to inspect`), ["--depth", "1"]);
      ctx.dryRunTempClone = dest;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const match = findRecovery(err);
      const { command, cause } = summarizeFailure(err);
      ctx.criticalStepFailed = true;
      ctx.failedSteps.push({
        name: "Clone repository",
        error: cause,
        cause: match?.cause,
        command,
        recovery: match?.remediation,
      });
      say(ctx, chalk.dim(`  ↪ [dry-run] clone failed — plan limited to what's knowable without cloning`));
    }
    ctx.projectDir = dest;
    return;
  }
  // Shallow clone: onboarding needs a working tree, not full history. This is
  // dramatically faster on large repos and avoids the HTTP/2 pack-transfer
  // disconnects (curl 92) that full clones of huge repos hit. Contributors can
  // `git fetch --unshallow` if they later need history.
  await cloneWithProgress(ctx, repo.url, dest, chalk.cyan(`Cloning ${repo.url}`), ["--depth", "1"]);
  ctx.projectDir = dest;
  ctx.cloned = true;
  ctx.done.push(`cloned ${repo.url}`);
  say(ctx, chalk.green("  ✔"), `Cloned to ${prettyPath(dest)}`);
}

export async function cleanupDryRunTempClone(ctx: PlaybookCtx): Promise<void> {
  if (!ctx.dryRunTempClone) return;
  const tempClone = ctx.dryRunTempClone;
  ctx.dryRunTempClone = undefined;
  await fs.rm(tempClone, { recursive: true, force: true });
}

/**
 * git clone with a live spinner driven by git's own progress output, so a long
 * clone isn't a frozen-looking pause. In --json mode or when stderr isn't a TTY
 * (CI, piped output) it falls back to a single log line so output stays clean
 * and scriptable. Resolves/rejects exactly like simpleGit().clone().
 */
async function cloneWithProgress(
  ctx: PlaybookCtx,
  url: string,
  dest: string,
  label: string,
  cloneArgs: string[] = [],
): Promise<void> {
  const spinner =
    !ctx.json && process.stderr.isTTY
      ? ora({ text: label, indent: 2, spinner: "dots" }).start()
      : null;
  if (!spinner) say(ctx, "  ↪ " + label);
  const git = simpleGit({
    baseDir: ctx.cwd,
    progress({ stage, progress }) {
      if (spinner) spinner.text = `${label} · ${stage} ${progress}%`;
    },
  });
  try {
    await git.clone(url, dest, cloneArgs);
  } catch (e) {
    // Transient mid-transfer disconnects (curl 56/92, early EOF, RPC failed) are
    // common on large repos and almost always succeed on a second try. Since the
    // clone is shallow, one automatic retry is cheap and saves the user a manual
    // re-run. Non-network failures (bad URL, auth, no such repo) are not retried.
    const msg = e instanceof Error ? e.message : String(e);
    if (findRecovery(msg)?.ruleId !== "network-unreachable") throw e;
    await fs.rm(dest, { recursive: true, force: true }); // drop the partial clone
    if (spinner) spinner.text = `${label} · network hiccup, retrying once`;
    else say(ctx, chalk.dim("  ↪ network hiccup, retrying clone once"));
    await git.clone(url, dest, cloneArgs);
  } finally {
    spinner?.stop();
  }
}

async function checkGitHubArchived(owner: string, repo: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { "User-Agent": "devhelp-cli", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { archived?: boolean };
    return data.archived === true;
  } catch {
    return false; // network failure: never block setup
  }
}

async function installNode(version: string, ctx: PlaybookCtx, task: any): Promise<void> {
  // Respect existing version managers before falling back to nvm.
  const av = await detectAvailable();
  const preferred = pickNodeManager(av);
  if (preferred) {
    task.title = `Installing Node ${version} via ${preferred}`;
    await runShell(nodeInstallCommand(preferred, version), ctx.projectDir, ctx, task);
    task.title = `Installed Node ${version} (${preferred})`;
    ctx.done.push(`node ${version} via ${preferred}`);
    return;
  }
  if (!(await nvmInstalled())) {
    task.output = "installing nvm";
    await runShell(
      'curl -fsSL -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash',
      ctx.projectDir,
      ctx,
      task,
    );
  }
  task.title = `Installing Node ${version} (${slowStepNote("node")})`;
  // Quote the version: tokens like "lts/*" are glob-expanded by zsh (the macOS
  // default), which errors with "no matches found" before nvm ever sees them.
  await runShell(
    nvmWrap(`nvm install "${version}" && nvm use "${version}"`),
    ctx.projectDir,
    ctx,
    task,
  );
  task.title = `Installed Node ${version}`;
  ctx.done.push(`node ${version}`);
}

async function installPython(version: string, ctx: PlaybookCtx, task: any): Promise<void> {
  // Respect existing version managers before falling back to pyenv.
  const av = await detectAvailable();
  const preferred = pickPythonManager(av);
  if (preferred) {
    task.title = `Installing Python ${version} via ${preferred}`;
    await runShell(pythonInstallCommand(preferred, version), ctx.projectDir, ctx, task);
    task.title = `Installed Python ${version} (${preferred})`;
    ctx.done.push(`python ${version} via ${preferred}`);
    return;
  }
  if (!(await which("pyenv"))) {
    task.output = "installing pyenv";
    const cmd =
      os.platform() === "darwin" && (await which("brew"))
        ? "brew install pyenv"
        : "curl -fsSL https://pyenv.run | bash";
    await runShell(cmd, ctx.projectDir, ctx, task);
  }
  task.title = `Installing Python ${version} (${slowStepNote("python")})`;
  // Prefix with PYENV_PREAMBLE: pyenv.run just installed to $PYENV_ROOT/bin,
  // which isn't on PATH in this fresh shell, so a bare `pyenv install` 404s.
  await runShell(pyenvExec(`pyenv install -s ${version}`), ctx.projectDir, ctx, task);
  task.title = `Installed Python ${version}`;
  ctx.done.push(`python ${version}`);
}

async function installRust(toolchain: string, ctx: PlaybookCtx, task: any): Promise<void> {
  if (!(await which("rustup"))) {
    task.output = "installing rustup";
    await runShell(
      `curl -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain ${toolchain}`,
      ctx.projectDir,
      ctx,
      task,
    );
  } else {
    await runShell(`rustup toolchain install ${toolchain}`, ctx.projectDir, ctx, task);
  }
  task.title = `Installed Rust ${toolchain}`;
  ctx.done.push(`rust ${toolchain}`);
}

async function installGo(version: string, ctx: PlaybookCtx, task: any): Promise<void> {
  const current = await tryVersion("go", ["version"]);
  if (current && current.includes(version.split(".").slice(0, 2).join("."))) {
    task.title = `Go ${current} already installed`;
    return;
  }
  if (os.platform() === "darwin" && (await which("brew"))) {
    task.title = `Installing Go ${version} via brew`;
    await runShell("brew install go || brew upgrade go", ctx.projectDir, ctx, task);
  } else if (os.platform() === "linux") {
    const tarball = `go${version}.linux-amd64.tar.gz`;
    task.title = `Installing Go ${version} (system)`;
    await runShell(
      `curl -fsSL -o /tmp/${tarball} https://go.dev/dl/${tarball} && ` +
        `sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf /tmp/${tarball}`,
      ctx.projectDir,
      ctx,
      task,
    );
    ctx.warnings.push("Add /usr/local/go/bin to your PATH");
  } else {
    ctx.detected!.goNeedsManualInstall = true;
    ctx.warnings.push(`Install Go ${version} from https://go.dev/dl/`);
    task.title = `Go ${version} — install manually from https://go.dev/dl/`;
    return;
  }
  task.title = `Installed Go ${version}`;
  ctx.done.push(`go ${version}`);
}

async function setupEnv(ctx: PlaybookCtx, task: any): Promise<void> {
  const copied: string[] = [];
  for (const template of ctx.detected!.envTemplates) {
    const src = path.join(ctx.projectDir, template);
    // dest is sibling .env in the same directory as the template
    const dst = path.join(path.dirname(src), ".env");
    if (await exists(dst)) {
      task.output = `${path.relative(ctx.projectDir, dst)} exists, leaving alone`;
      ctx.warnings.push(`${path.relative(ctx.projectDir, dst)} present — not overwritten`);
      continue;
    }
    if (ctx.dryRun) {
      task.output = `[dry-run] would copy ${template} → ${path.relative(ctx.projectDir, dst)}`;
    } else {
      await fs.copyFile(src, dst);
    }
    copied.push(`${template} → ${path.relative(ctx.projectDir, dst)}`);
  }
  if (copied.length) {
    task.title = `Env: ${copied.length === 1 ? copied[0] : `${copied.length} files copied`}`;
    ctx.done.push(...copied);
    ctx.warnings.push("Review .env and fill in real values before running");
  } else {
    task.title = "Env: nothing to do";
  }
}

/** Build the compose "up" command. `--wait` is Compose v2 only (v1 lacks it). */
export function composeUpCommand(base: string, file: string, wait: boolean): string {
  return `${base} -f ${file} up -d${wait ? " --wait" : ""}`;
}

/**
 * Resolve the available compose CLI: prefer v2 (`docker compose`, supports
 * --wait), fall back to legacy v1 (`docker-compose`, no --wait). null = neither.
 */
async function detectCompose(): Promise<{ base: string; wait: boolean } | null> {
  if (await which("docker")) {
    const v2 = await execa("docker", ["compose", "version"], { reject: false, timeout: 4000 });
    if (v2.exitCode === 0) return { base: "docker compose", wait: true };
  }
  if (await which("docker-compose")) return { base: "docker-compose", wait: false };
  return null;
}

async function startServices(ctx: PlaybookCtx, task: any): Promise<void> {
  const files = ctx.detected!.serviceComposeFiles;
  // Skip the probe in dry-run; just display the v2 form.
  const compose = ctx.dryRun ? { base: "docker compose", wait: true } : await detectCompose();
  if (!compose) {
    // Can't start what isn't installed — surface it, don't fail the whole run.
    ctx.warnings.push("Docker not found — install Docker to start services, then `docker compose up -d`");
    task.title = "Services — Docker not installed (skipped)";
    return;
  }
  // One `up` per compose file. --wait (v2) blocks until containers are healthy
  // so a following migration step finds the DB ready.
  for (const f of files) {
    task.title = `Starting services (${f})`;
    await runShell(composeUpCommand(compose.base, f, compose.wait), ctx.projectDir, ctx, task);
  }
  task.title = `Services started (${files.length})`;
  ctx.done.push(`${compose.base} up × ${files.length}`);
}

async function prismaGenerate(ctx: PlaybookCtx, task: any): Promise<void> {
  const pm = ctx.detected!.pkgManager ?? "npm";
  for (const schema of ctx.detected!.prismaSchemas) {
    // Absolute path: in monorepos where a nested workspace package.json also
    // carries a `prisma` field, Prisma resolves a relative `--schema` against
    // that package's dir instead of the repo root and reports "file not found".
    // An absolute path sidesteps the base-dir ambiguity (notably under yarn berry).
    const schemaPath = path.resolve(ctx.projectDir, schema);
    const cmd = `${pmExec(pm)} prisma generate --schema ${schemaPath}`;
    task.title = `prisma generate (${schema})`;
    await runShell(wrapForRuntime(cmd, ctx.detected!), ctx.projectDir, ctx, task);
  }
  task.title = `Prisma client generated (${ctx.detected!.prismaSchemas.length})`;
  ctx.done.push(`prisma generate × ${ctx.detected!.prismaSchemas.length}`);
}

async function dbProvision(ctx: PlaybookCtx, task: any): Promise<void> {
  const d = ctx.detected!;
  const pm = d.pkgManager ?? "npm";
  // `migrate deploy` applies committed migrations only — it never resets or
  // generates new ones, so it's safe to run unattended (unlike `migrate dev`).
  for (const schema of d.prismaSchemas) {
    const schemaPath = path.resolve(ctx.projectDir, schema);
    task.title = `prisma migrate deploy (${schema})`;
    await runShell(
      wrapForRuntime(`${pmExec(pm)} prisma migrate deploy --schema ${schemaPath}`, d),
      ctx.projectDir,
      ctx,
      task,
    );
  }
  if (d.prismaSeedConfigured) {
    task.title = "prisma db seed";
    await runShell(wrapForRuntime(`${pmExec(pm)} prisma db seed`, d), ctx.projectDir, ctx, task);
  }
  if (d.prismaSchemas.length) {
    ctx.done.push("prisma migrate deploy" + (d.prismaSeedConfigured ? " + seed" : ""));
  }
  // Non-Prisma ORMs / frameworks (Drizzle, Django, Rails).
  for (const cmd of d.migrationCommands) {
    task.title = truncate(cmd, 60);
    await runShell(wrapForRuntime(cmd, d), ctx.projectDir, ctx, task);
    ctx.done.push(cmd);
  }
  task.title = "Database provisioned";
}

async function generateVscode(ctx: PlaybookCtx, task: any): Promise<void> {
  if (ctx.dryRun) {
    task.output = "[dry-run] would write .vscode/launch.json";
    task.title = "Would generate .vscode/launch.json";
    return;
  }
  const result = await writeVscodeLaunch(ctx.projectDir, ctx.detected!);
  if (result === "exists") {
    task.title = ".vscode/launch.json already present (left alone)";
  } else if (result) {
    task.title = "Wrote .vscode/launch.json";
    ctx.done.push("wrote .vscode/launch.json");
  } else {
    task.title = ".vscode/launch.json — nothing to generate";
  }
}

async function populateSecrets(ctx: PlaybookCtx, task: any): Promise<void> {
  const provider = await detectSecretsProvider(ctx.projectDir, ctx.detected!.envTemplates);
  if (!provider) {
    ctx.warnings.push("--secrets: no provider detected (no op:// refs or doppler config)");
    task.title = "Secrets — no provider detected";
    return;
  }
  if (!ctx.dryRun && !(await which(provider.cli))) {
    ctx.warnings.push(`--secrets: ${provider.cli} not installed — install it, then re-run`);
    task.title = `Secrets — ${provider.cli} not installed`;
    return;
  }
  // Never clobber a .env the user already had. We still populate a .env that
  // devhelp created from a template this run (the 1Password op-inject case),
  // since that one only holds placeholders — envPreexisted distinguishes them.
  if (ctx.envPreexisted) {
    ctx.warnings.push(
      `--secrets: .env already present — not overwritten. Remove it and re-run to populate from ${provider.name}.`,
    );
    task.title = ".env present — not overwritten";
    return;
  }
  const cmd = secretsCommand(provider);
  task.title = `Populating .env via ${provider.name}`;
  await runShell(cmd, ctx.projectDir, ctx, task);
  task.title = `Populated .env via ${provider.name}`;
  ctx.done.push(`secrets via ${provider.name}`);
}

async function playwrightInstall(ctx: PlaybookCtx, task: any): Promise<void> {
  const pm = ctx.detected!.pkgManager ?? "npm";
  const cmd = `${pmExec(pm)} playwright install --with-deps`;
  await runShell(wrapForRuntime(cmd, ctx.detected!), ctx.projectDir, ctx, task);
  task.title = "Playwright browsers installed";
  ctx.done.push("playwright browsers");
}

/* -------------------------------------------------------------------------- */
/* Shell + helpers                                                             */
/* -------------------------------------------------------------------------- */

async function runShell(
  command: string,
  cwd: string,
  ctx: PlaybookCtx,
  task: any,
  successMsg?: string,
): Promise<void> {
  if (ctx.dryRun) {
    task.output = `[dry-run] ${command}`;
    return;
  }
  // Falls back to /bin/bash on POSIX; on native Windows without a bash shell
  // the up-front guard has already warned, but try "bash" (git-bash) anyway.
  const shell = pickShell() ?? "bash";
  const TIMEOUT_MS = 10 * 60 * 1000;
  const sub = execa(shell, ["-lc", command], {
    cwd,
    timeout: TIMEOUT_MS,
    env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
    reject: false,
    all: true,
  });
  if (sub.all) {
    sub.all.on("data", (chunk) => {
      const lines = chunk.toString().split("\n").map((l: string) => l.trim()).filter(Boolean);
      if (lines.length) task.output = truncate(lines[lines.length - 1], 100);
    });
  }
  const result = await sub;
  if (result.exitCode !== 0) {
    // Distinguish a real non-zero exit from a process we killed (timeout) or one
    // killed by signal — "exit undefined" tells the user nothing.
    const reason = result.timedOut
      ? `timed out after ${Math.round(TIMEOUT_MS / 60000)}m`
      : result.signal
        ? `killed by ${result.signal}`
        : `exit ${result.exitCode ?? "unknown"}`;
    // Keep a generous tail: noisy installers (uv, pnpm) emit pages of progress,
    // and the real error must survive the truncation for summarizeFailure to find it.
    const tail = (result.all ?? result.stderr ?? "").toString().split("\n").slice(-25).join("\n");
    throw new Error(`Command failed (${reason}):\n$ ${command}\n${tail}`);
  }
  if (successMsg) ctx.done.push(successMsg);
}

export function wrapForRuntime(command: string, d: Detected): string {
  if (d.nodeVersion && /^(npm|pnpm|yarn|bun|npx)\b/.test(command)) {
    return nvmWrap(
      // Quoted so zsh doesn't glob-expand version tokens like "lts/*".
      `nvm use "${d.nodeVersion}" >/dev/null 2>&1 || nvm use default >/dev/null 2>&1; ${ensurePmPrefix(command)}${command}`,
    );
  }
  // Bare python/pip in the venv-bootstrap path: the interactive shell's pyenv
  // init isn't loaded in the non-interactive login shell we spawn, so the
  // pyenv-installed interpreter isn't on PATH (and macOS ships no `python`).
  if (d.pythonVersion && /^(python3?|pip3?|pipenv|uv|poetry)\b/.test(command)) {
    return pyenvWrap(`${ensurePythonToolPrefix(command)}${command}`, d.pythonVersion);
  }
  return command;
}

/**
 * pnpm/yarn aren't installed just because Node is — on a clean machine a freshly
 * nvm-installed Node has only npm/npx, so `pnpm install` dies with "command not
 * found". We install the missing manager globally with npm (always present with
 * Node). We deliberately do NOT use corepack: its bundled version does online
 * release-signature verification that crashes on some Node builds/networks
 * (`verifySignature`/`fetchLatestStableVersion`) — too fragile for a tool that
 * must work on arbitrary machines. Only fires for pnpm/yarn when absent, so an
 * existing global install is left untouched. npm/npx need nothing (npm ships
 * with Node); bun has its own install path. Returns a prefix, or "" if not needed.
 */
function ensurePmPrefix(command: string): string {
  const m = command.match(/^(pnpm|yarn)\b/);
  if (!m) return "";
  const pm = m[1];
  return `command -v ${pm} >/dev/null 2>&1 || npm install -g ${pm} >/dev/null 2>&1 || true; `;
}

/**
 * uv/poetry/pipenv are project-level Python package managers, not guaranteed
 * to exist on a clean machine after Python itself is installed. Install the
 * missing CLI into the user site and expose ~/.local/bin for this shell only.
 */
function ensurePythonToolPrefix(command: string): string {
  const m = command.match(/^(uv|poetry|pipenv)\b/);
  if (!m) return "";
  const tool = m[1];
  return `export PATH="$HOME/.local/bin:$PATH"; command -v ${tool} >/dev/null 2>&1 || python3 -m pip install --user ${tool}; `;
}

/**
 * Put a freshly-installed pyenv on PATH and initialize it. pyenv.run installs to
 * $PYENV_ROOT/bin, which isn't on PATH in the next (fresh) shell — so a bare
 * `pyenv install` right after install dies with "command not found". This
 * preamble fixes that and is a harmless no-op when pyenv is already on PATH
 * (e.g. brew-installed) or absent (mise/asdf user).
 */
const PYENV_PREAMBLE =
  'export PYENV_ROOT="${PYENV_ROOT:-$HOME/.pyenv}"; ' +
  '[ -d "$PYENV_ROOT/bin" ] && export PATH="$PYENV_ROOT/bin:$PATH"; ' +
  'command -v pyenv >/dev/null 2>&1 && eval "$(pyenv init - 2>/dev/null)";';

/** A pyenv command (e.g. `pyenv install -s 3.11`) with pyenv guaranteed on PATH. */
function pyenvExec(cmd: string): string {
  return `${PYENV_PREAMBLE} ${cmd}`;
}

/**
 * Make the pyenv-installed interpreter usable as `python3`/`python` in the
 * non-interactive shell, and pin the highest installed version matching the
 * detected line (e.g. "3.11" → "3.11.15"). If pyenv isn't the manager (mise/asdf
 * user) the preamble is a no-op and the command falls back to the login shell's
 * own python3.
 */
function pyenvWrap(inner: string, version: string): string {
  const prefix = version.replace(/\./g, "\\.");
  return [
    PYENV_PREAMBLE,
    `__dhpy="$(pyenv versions --bare 2>/dev/null | grep -E '^${prefix}(\\.|$)' | tail -1)"; ` +
      '[ -n "$__dhpy" ] && export PYENV_VERSION="$__dhpy";',
    inner,
  ].join(" ");
}

function nvmWrap(inner: string): string {
  return [
    'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
    '[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"',
    inner,
  ].join(" && ");
}

function pmExec(pm: PkgManager): string {
  switch (pm) {
    case "pnpm":
      return "pnpm exec";
    case "yarn":
      return "yarn";
    case "bun":
      return "bunx";
    default:
      return "npx";
  }
}

async function which(cmd: string): Promise<string | null> {
  try {
    const probe = commandExistsProbe(cmd);
    const r = await execa(probe.cmd, probe.args, { reject: false, shell: probe.shell });
    if (r.exitCode !== 0) return null;
    // `where` can return multiple lines on Windows — take the first.
    return r.stdout.split(/\r?\n/)[0].trim() || null;
  } catch {
    return null;
  }
}

async function tryVersion(cmd: string, args: string[]): Promise<string | null> {
  try {
    const r = await execa(cmd, args, { timeout: 3000 });
    return (r.stdout || r.stderr).split("\n")[0].trim();
  } catch {
    return null;
  }
}

async function nvmInstalled(): Promise<boolean> {
  const nvmDir = process.env.NVM_DIR ?? path.join(os.homedir(), ".nvm");
  try {
    await fs.access(path.join(nvmDir, "nvm.sh"));
    return true;
  } catch {
    return false;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function extractRepo(
  request: string,
): { url: string; name: string; owner?: string; repo?: string } | null {
  const urlMatch = request.match(/(https?:\/\/[^\s]+|git@[^\s]+)/);
  if (urlMatch) {
    const url = urlMatch[1].replace(/[.,)\]]$/, "");
    const gh = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    return {
      url,
      name: guessRepoName(url),
      owner: gh?.[1],
      repo: gh?.[2],
    };
  }
  const shortMatch = request.match(/\b([\w.-]+)\/([\w.-]+)\b/);
  if (shortMatch) {
    const owner = shortMatch[1];
    const name = shortMatch[2].replace(/\.git$/, "");
    if (looksLikeRepo(owner, name)) {
      return { url: `https://github.com/${owner}/${name}.git`, name, owner, repo: name };
    }
  }
  return null;
}

function looksLikeRepo(owner: string, name: string): boolean {
  if (!owner || !name) return false;
  if (owner.startsWith(".") || name.startsWith(".")) return false;
  if (["src", "node_modules", "dist", "build"].includes(owner)) return false;
  return true;
}

function guessRepoName(url: string): string {
  const m = url.match(/([^/]+?)(?:\.git)?$/);
  return m?.[1] ?? "repo";
}

export function describe(d: Detected): string {
  const bits: string[] = [];
  if (d.framework) bits.push(d.framework.name);
  if (d.isLibrary) bits.push("library");
  if (d.bunIsRuntime) bits.push(`bun runtime ${d.bunVersion ?? ""}`.trim());
  if (d.nodeVersion && !d.nodeIsToolingOnly && !d.bunIsRuntime) bits.push(`node ${d.nodeVersion}`);
  if (d.pkgManager && !d.nodeIsToolingOnly && !d.bunIsRuntime) bits.push(d.pkgManager);
  if (d.monorepo) bits.push(`${d.monorepo} monorepo`);
  if (d.pythonVersion) bits.push(`python ${d.pythonVersion}`);
  if (d.rustToolchain) bits.push(d.rustIsOptional ? `rust ${d.rustToolchain} (optional)` : `rust ${d.rustToolchain}`);
  if (d.goVersion) bits.push(`go ${d.goVersion}`);
  if (d.rubyVersion) bits.push(`ruby ${d.rubyVersion}`);
  if (d.phpVersion) bits.push(`php ${d.phpVersion}`);
  if (d.elixirVersion) bits.push(`elixir ${d.elixirVersion}` + (d.erlangVersion ? ` (erlang ${d.erlangVersion})` : ""));
  if (d.javaVersion) bits.push(`${d.javaIsKotlin ? "kotlin/" : ""}java ${d.javaVersion} (${d.javaBuildSystem})`);
  if (d.dotnetVersion) bits.push(`.NET ${d.dotnetVersion}`);
  if (d.dartSdkVersion) bits.push(`${d.dartIsFlutter ? "flutter" : "dart"} ${d.dartSdkVersion}`);
  if (d.denoVersion) bits.push(`deno ${d.denoVersion}`);
  if (d.swiftVersion) bits.push(`swift ${d.swiftVersion} (${d.swiftBuildSystem})`);
  if (d.isAndroid) bits.push(`android sdk ${d.androidCompileSdk ?? ""}`.trim());
  if (d.isReactNative) bits.push("react-native");
  if (d.isExpo && !d.isReactNative) bits.push("expo");
  if (d.ghcVersion) bits.push(`haskell ghc ${d.ghcVersion} (${d.haskellBuildSystem})`);
  if (d.scalaVersion) bits.push(`scala ${d.scalaVersion} (${d.scalaBuildSystem})`);
  if (d.clojureVersion) bits.push(`clojure ${d.clojureVersion} (${d.clojureBuildSystem})`);
  if (d.rVersion) bits.push(`r ${d.rVersion}${d.rIsShiny ? " shiny" : ""}`);
  if (d.juliaVersion) bits.push(`julia ${d.juliaVersion}`);
  if (d.zigVersion) bits.push(`zig ${d.zigVersion}`);
  if (d.ocamlVersion) bits.push(`ocaml ${d.ocamlVersion}`);
  if (d.bazelVersion) bits.push(`bazel ${d.bazelVersion}${d.bazelLanguages?.length ? ` (${d.bazelLanguages.join("/")})` : ""}`);
  if (d.isNx) bits.push(`nx workspace`);
  if (d.infraType) bits.push(d.infraType);
  if (d.nixType && !d.informOnly) bits.push(`nix ${d.nixType}`);
  if (d.prismaSchemas.length) bits.push("prisma");
  if (d.hasPlaywright) bits.push("playwright");
  if (d.devcontainerSetupCommand) bits.push("devcontainer");
  if (d.informOnly && d.clikeBuildSystem) bits.push(`${d.clikeLanguage} (${d.clikeBuildSystem})`);
  if (d.informOnly && d.nixType && !d.clikeBuildSystem) bits.push(`nix ${d.nixType}`);
  if (d.unrecognizedManifests.length && bits.length === 0) {
    bits.push(`unrecognized: ${d.unrecognizedManifests.join(", ")}`);
  }
  return bits.length ? bits.join(", ") : "nothing recognized";
}

function prettyPath(p: string): string {
  return p.replace(os.homedir(), "~");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/* -------------------------------------------------------------------------- */
/* Banner + summary                                                            */
/* -------------------------------------------------------------------------- */

function printBanner(opts: SetupOptions): void {
  console.log();
  console.log(
    chalk.cyan.bold("  devhelp"),
    opts.dryRun ? chalk.dim("· DRY RUN") : "",
  );
  console.log(chalk.dim("  ›"), opts.request);
  console.log();
}

/** Returns the process exit code (0 = ready/inform, 1 = unsupported/incomplete). */
function printSummary(ctx: PlaybookCtx): number {
  if (ctx.detected?.informOnly) {
    // C/C++ and Nix — recognized stack, but devhelp can't auto-install system deps.
    printInformPanel(ctx);
    return 0;
  }
  if (ctx.criticalStepFailed) {
    printIncompletePanel(ctx);
    return 1;
  }
  if (ctx.nothingDetected) {
    printUnsupportedPanel(ctx);
    return 1;
  }
  printReadyPanel(ctx);
  return 0;
}

function printInformPanel(ctx: PlaybookCtx): void {
  const d = ctx.detected!;
  const lines: string[] = [];
  lines.push(chalk.cyan.bold(d.informTitle ?? "Info"));
  lines.push("");
  for (const l of d.informBody ?? []) lines.push(l);
  if (ctx.warnings.length) {
    lines.push("");
    for (const w of ctx.warnings) lines.push(chalk.yellow(`  ! ${w}`));
  }
  console.log();
  console.log(
    boxen(lines.join("\n"), {
      padding: { top: 1, bottom: 1, left: 2, right: 2 },
      borderStyle: "round",
      borderColor: "cyan",
      title: chalk.bold("devhelp"),
      titleAlignment: "center",
    }),
  );
  console.log();
}

function printUnsupportedPanel(ctx: PlaybookCtx): void {
  const d = ctx.detected;
  const lines: string[] = [];
  lines.push(chalk.yellow.bold("UNSUPPORTED STACK"));
  lines.push("");
  lines.push("devhelp doesn't recognize this project yet.");
  if (d?.unrecognizedManifests.length) {
    lines.push("");
    lines.push(chalk.dim("  Found: ") + d.unrecognizedManifests.join(", "));
  }
  if (d?.informOnly && d.informBody?.length) {
    lines.push("");
    lines.push(chalk.dim(`  ${d.informTitle ?? "Build instructions"}:`));
    for (const l of d.informBody) lines.push(chalk.dim(`  ${l}`));
  }
  if (ctx.warnings.length) {
    lines.push("");
    for (const w of ctx.warnings) lines.push(chalk.yellow(`  ! ${w}`));
  }
  lines.push("");
  lines.push(chalk.dim("  Request support →"));
  lines.push(chalk.dim("  github.com/sshivanshg/devhelp/issues/new"));
  console.log();
  console.log(
    boxen(lines.join("\n"), {
      padding: { top: 1, bottom: 1, left: 2, right: 2 },
      borderStyle: "round",
      borderColor: "yellow",
      title: chalk.bold("devhelp"),
      titleAlignment: "center",
    }),
  );
  console.log();
}

function printIncompletePanel(ctx: PlaybookCtx): void {
  const d = ctx.detected;
  const lines: string[] = [];
  lines.push(chalk.red.bold("INCOMPLETE"));
  lines.push(chalk.dim(`  ${ctx.failedSteps.length} step(s) need a hand — here's what and how:`));
  // One block per failure: what failed → why → the exact next move. Grouping
  // cause and remedy under each step (rather than two separate lists) keeps the
  // mapping unambiguous when more than one step fails.
  for (const f of ctx.failedSteps) {
    lines.push("");
    lines.push(chalk.red(`  ✗ ${f.name}`));
    if (f.cause) lines.push(chalk.dim(`    why:  ${f.cause}`));
    else lines.push(chalk.dim(`    why:  ${truncate(f.error, 100)}`));
    for (const step of remedyFor(f, d)) lines.push(chalk.yellow(`    fix:  ${step}`));
  }
  console.log();
  console.log(
    boxen(lines.join("\n"), {
      padding: { top: 1, bottom: 1, left: 2, right: 2 },
      borderStyle: "round",
      borderColor: "red",
      title: chalk.bold("devhelp"),
      titleAlignment: "center",
    }),
  );
  console.log();
}

/**
 * The concrete next action(s) for a failed step. Always returns at least one
 * actionable line — never a "check the log" dead-end. Priority: a matched
 * recovery remediation → a stack-specific hint → re-run the exact command that
 * failed (so the user sees the full error in context).
 */
function remedyFor(
  f: PlaybookCtx["failedSteps"][number],
  d: Detected | undefined,
): string[] {
  const out: string[] = [];
  if (f.recovery) out.push(f.recovery);
  const hint = hintFor(f.name, d);
  if (hint && hint !== f.recovery) out.push(hint);
  if (!out.length) {
    out.push(
      f.command
        ? `Re-run to see the full error:  ${truncate(f.command, 100)}`
        : "Open the run log below for the full output",
    );
  }
  return out;
}

/** Stack-specific hint keyed off the step name, or null when none applies. */
function hintFor(stepName: string, d: Detected | undefined): string | null {
  const lower = stepName.toLowerCase();
  if (lower.includes("node")) return `Install Node manually from https://nodejs.org or via nvm`;
  if (lower.includes("python"))
    return `Install Python manually from https://python.org or via pyenv`;
  if (lower.includes("rust")) return `Install Rust manually from https://rustup.rs`;
  if (lower.includes("go")) return `Install Go manually from https://go.dev/dl/`;
  if (lower.includes("dependencies"))
    return `Run "${d?.installCommands[0] ?? "install"}" manually to see the full error`;
  if (lower.includes("submodule"))
    return `Run "git submodule update --init --recursive" manually`;
  return null;
}

function printReadyPanel(ctx: PlaybookCtx): void {
  const d = ctx.detected!;
  const lines: string[] = [];
  lines.push(chalk.green.bold("READY"));
  lines.push("");
  lines.push(chalk.dim("  cd ") + prettyPath(ctx.projectDir));

  if (d.isLibrary) {
    if (d.buildCommand) lines.push(chalk.cyan(`  ${d.buildCommand}`) + chalk.dim("   # build"));
    if (d.testCommand) lines.push(chalk.cyan(`  ${d.testCommand}`) + chalk.dim("   # tests"));
  } else {
    if (d.devCommand) {
      const url = d.devUrl ? chalk.dim(`   → ${d.devUrl}`) : "";
      lines.push(chalk.cyan(`  ${d.devCommand}`) + url);
    } else if (d.buildCommand) {
      lines.push(chalk.cyan(`  ${d.buildCommand}`) + chalk.dim("   # build"));
    }
    if (d.testCommand) lines.push(chalk.cyan(`  ${d.testCommand}`) + chalk.dim("   # tests"));
  }

  if (d.devcontainerSetupCommand) {
    lines.push("");
    lines.push(
      chalk.dim("  Recommended setup (from .devcontainer):"),
    );
    lines.push(chalk.cyan(`  ${truncate(d.devcontainerSetupCommand, 80)}`));
  }

  if (d.serviceComposeFiles.length) {
    // Bare `docker compose up -d` only targets ./docker-compose.yml, which may be
    // the full-stack/app compose rather than the service deps. Name files with -f
    // unless the single service compose IS the default root one.
    const composeCmd = (f: string) =>
      f === "docker-compose.yml" || f === "compose.yml" ? "docker compose up -d" : `docker compose -f ${f} up -d`;
    lines.push("");
    if (ctx.withServices) {
      lines.push(chalk.dim("  Services (already started via docker compose):"));
      lines.push(chalk.dim(`  (${d.serviceComposeFiles.slice(0, 3).join(", ")}${d.serviceComposeFiles.length > 3 ? "…" : ""})`));
      lines.push(chalk.dim("  Stop with: docker compose down"));
    } else {
      lines.push(chalk.dim("  Before starting:"));
      for (const f of d.serviceComposeFiles.slice(0, 3)) {
        lines.push(chalk.cyan(`  ${composeCmd(f)}`) + chalk.dim("   # starts services (Postgres, Redis, etc.)"));
      }
      if (d.envHasLocalDb) {
        lines.push(chalk.yellow("  ! DATABASE_URL points at localhost — make sure the service is running"));
      }
    }
  }

  // Soft hints
  const hints: string[] = [];
  if (d.nodeIsToolingOnly && d.pkgManager) {
    hints.push(`For dev tooling: ${d.pkgManager} install   (optional)`);
  }
  if (d.rustIsOptional) {
    hints.push(`For compiler work: rustup show   (Rust optional)`);
  }
  if (d.goNeedsManualInstall && d.goVersion) {
    hints.push(`Install Go ${d.goVersion} from https://go.dev/dl/`);
  }
  if (hints.length) {
    lines.push("");
    for (const h of hints) lines.push(chalk.dim(`  ${h}`));
  }

  if (ctx.verifyChecks?.length) {
    lines.push("");
    lines.push(chalk.bold("  Verified:"));
    for (const c of ctx.verifyChecks) {
      lines.push(
        c.ok
          ? chalk.green(`  ✔ ${c.name} — ${c.detail}`)
          : chalk.red(`  ✗ ${c.name} — ${c.detail}`),
      );
    }
  }

  if (ctx.warnings.length) {
    lines.push("");
    for (const w of ctx.warnings) lines.push(chalk.yellow(`  ! ${w}`));
  }

  console.log();
  console.log(
    boxen(lines.join("\n"), {
      padding: { top: 1, bottom: 1, left: 2, right: 2 },
      borderStyle: "round",
      borderColor: (ctx.verifyChecks ?? []).some((c) => !c.ok) ? "yellow" : "green",
      title: d.framework?.name ? chalk.bold(d.framework.name) : undefined,
      titleAlignment: "center",
    }),
  );
  if (ctx.done.length && ctx.verbose) {
    console.log(chalk.dim("  did: " + ctx.done.join(" · ")));
    console.log();
  }
}

/* -------------------------------------------------------------------------- */
/* Installers for the additional ecosystems                                   */
/* -------------------------------------------------------------------------- */

async function installRuby(version: string, ctx: PlaybookCtx, task: any): Promise<void> {
  const current = await tryVersion("ruby", ["--version"]);
  if (current && current.includes(version)) {
    task.title = `Ruby ${current} already installed`;
    return;
  }
  const hasRbenv = await which("rbenv");
  if (hasRbenv) {
    task.title = `Installing Ruby ${version} via rbenv`;
    await runShell(`rbenv install -s ${version} && rbenv local ${version}`, ctx.projectDir, ctx, task);
  } else if (os.platform() === "darwin" && (await which("brew"))) {
    task.title = `Installing rbenv + Ruby ${version}`;
    await runShell(`brew install rbenv ruby-build && rbenv install -s ${version} && rbenv local ${version}`, ctx.projectDir, ctx, task);
  } else {
    ctx.warnings.push(`Install Ruby ${version}: https://github.com/rbenv/rbenv#installation, then 'rbenv install ${version}'`);
    task.title = `Ruby ${version} — install manually`;
    return;
  }
  task.title = `Installed Ruby ${version}`;
  ctx.done.push(`ruby ${version}`);
}

async function installPHP(version: string, ctx: PlaybookCtx, task: any): Promise<void> {
  const current = await tryVersion("php", ["--version"]);
  if (current && current.includes(`PHP ${version}`)) {
    task.title = `PHP ${current.split(" ").slice(0, 2).join(" ")} already installed`;
    return;
  }
  if (os.platform() === "darwin" && (await which("brew"))) {
    task.title = `Installing PHP ${version} via brew`;
    await runShell(`brew install php@${version} || brew upgrade php@${version} || true`, ctx.projectDir, ctx, task);
  } else {
    ctx.warnings.push(`Install PHP ${version}: 'sudo apt-get install php${version} php${version}-cli' or use phpenv`);
    task.title = `PHP ${version} — install manually`;
    return;
  }
  if (!(await which("composer"))) {
    task.title = `Installing composer`;
    if (os.platform() === "darwin" && (await which("brew"))) {
      await runShell(`brew install composer`, ctx.projectDir, ctx, task);
    }
  }
  task.title = `Installed PHP ${version}`;
  ctx.done.push(`php ${version}`);
}

async function installElixir(elixirVersion: string, erlangVersion: string, ctx: PlaybookCtx, task: any): Promise<void> {
  const current = await tryVersion("elixir", ["--version"]);
  if (current && current.includes(elixirVersion)) {
    task.title = `Elixir already installed`;
    return;
  }
  const hasAsdf = await which("asdf");
  if (hasAsdf) {
    task.title = `Installing Erlang ${erlangVersion} + Elixir ${elixirVersion} via asdf`;
    await runShell(
      `asdf plugin add erlang 2>/dev/null || true; asdf plugin add elixir 2>/dev/null || true; ` +
      `asdf install erlang ${erlangVersion}; asdf install elixir ${elixirVersion}; ` +
      `asdf local erlang ${erlangVersion} && asdf local elixir ${elixirVersion}`,
      ctx.projectDir, ctx, task);
  } else if (os.platform() === "darwin" && (await which("brew"))) {
    task.title = `Installing Elixir via brew`;
    await runShell(`brew install elixir`, ctx.projectDir, ctx, task);
  } else {
    ctx.warnings.push(`Install asdf, then: asdf install erlang ${erlangVersion} && asdf install elixir ${elixirVersion}`);
    task.title = `Elixir ${elixirVersion} — install manually`;
    return;
  }
  task.title = `Installed Elixir ${elixirVersion}`;
  ctx.done.push(`elixir ${elixirVersion}`);
}

async function installJava(version: string, ctx: PlaybookCtx, task: any): Promise<void> {
  const current = await tryVersion("java", ["-version"]);
  if (current && current.includes(`"${version}`)) {
    task.title = `Java ${version} already installed`;
    return;
  }
  if (os.platform() === "darwin" && (await which("brew"))) {
    task.title = `Installing Java ${version} via brew (temurin)`;
    await runShell(`brew install --cask temurin@${version} || brew install openjdk@${version}`, ctx.projectDir, ctx, task);
  } else {
    task.title = `Installing Java ${version} via SDKMAN`;
    await runShell(
      `if [ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]; then ` +
      `bash -lc "source $HOME/.sdkman/bin/sdkman-init.sh && sdk install java ${version}-tem"; ` +
      `else echo "Install SDKMAN: curl -s https://get.sdkman.io | bash, then 'sdk install java ${version}-tem'"; exit 1; fi`,
      ctx.projectDir, ctx, task);
  }
  task.title = `Installed Java ${version}`;
  ctx.done.push(`java ${version}`);
}

async function installDotnet(version: string, ctx: PlaybookCtx, task: any): Promise<void> {
  const current = await tryVersion("dotnet", ["--version"]);
  if (current && current.startsWith(version)) {
    task.title = `.NET ${current} already installed`;
    return;
  }
  if (os.platform() === "darwin" && (await which("brew"))) {
    task.title = `Installing .NET ${version} via brew`;
    await runShell(`brew install --cask dotnet-sdk`, ctx.projectDir, ctx, task);
  } else {
    task.title = `Installing .NET ${version}`;
    await runShell(
      `curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh && ` +
      `bash /tmp/dotnet-install.sh --channel ${version}.0 --install-dir $HOME/.dotnet`,
      ctx.projectDir, ctx, task);
    ctx.warnings.push("Add ~/.dotnet to PATH and set DOTNET_ROOT=~/.dotnet");
  }
  task.title = `Installed .NET ${version}`;
  ctx.done.push(`dotnet ${version}`);
}

async function installFlutter(version: string, isFlutter: boolean, ctx: PlaybookCtx, task: any): Promise<void> {
  if (isFlutter) {
    const current = await tryVersion("flutter", ["--version"]);
    if (current && current.includes(version)) {
      task.title = `Flutter ${version} already installed`;
      return;
    }
    if (await which("fvm")) {
      task.title = `Installing Flutter ${version} via fvm`;
      await runShell(`fvm install ${version} && fvm use ${version}`, ctx.projectDir, ctx, task);
    } else if (os.platform() === "darwin" && (await which("brew"))) {
      task.title = `Installing Flutter via brew`;
      await runShell(`brew install --cask flutter`, ctx.projectDir, ctx, task);
    } else {
      ctx.warnings.push(`Install fvm: 'dart pub global activate fvm', then 'fvm install ${version}'`);
      task.title = `Flutter ${version} — install manually`;
      return;
    }
    task.title = `Installed Flutter ${version}`;
    ctx.done.push(`flutter ${version}`);
  } else {
    const current = await tryVersion("dart", ["--version"]);
    if (current && current.includes(version)) {
      task.title = `Dart ${version} already installed`;
      return;
    }
    if (os.platform() === "darwin" && (await which("brew"))) {
      task.title = `Installing Dart via brew`;
      await runShell(`brew tap dart-lang/dart && brew install dart`, ctx.projectDir, ctx, task);
    } else {
      ctx.warnings.push(`Install Dart SDK: https://dart.dev/get-dart`);
      task.title = `Dart ${version} — install manually`;
      return;
    }
    task.title = `Installed Dart ${version}`;
    ctx.done.push(`dart ${version}`);
  }
}

async function installDeno(version: string, ctx: PlaybookCtx, task: any): Promise<void> {
  const current = await tryVersion("deno", ["--version"]);
  if (current && version === "latest") {
    task.title = `Deno ${current.split(" ").slice(0, 2).join(" ")} already installed`;
    return;
  }
  if (os.platform() === "darwin" && (await which("brew"))) {
    task.title = `Installing Deno via brew`;
    await runShell(`brew install deno`, ctx.projectDir, ctx, task);
  } else {
    task.title = `Installing Deno`;
    await runShell(`curl -fsSL https://deno.land/x/install/install.sh | sh`, ctx.projectDir, ctx, task);
  }
  task.title = `Installed Deno`;
  ctx.done.push(`deno ${version}`);
}

async function installBun(version: string, ctx: PlaybookCtx, task: any): Promise<void> {
  const current = await tryVersion("bun", ["--version"]);
  if (current && version === "latest") {
    task.title = `Bun ${current} already installed`;
    return;
  }
  if (os.platform() === "darwin" && (await which("brew"))) {
    task.title = `Installing Bun via brew`;
    await runShell(`brew install oven-sh/bun/bun || brew install bun`, ctx.projectDir, ctx, task);
  } else {
    task.title = `Installing Bun`;
    await runShell(`curl -fsSL https://bun.sh/install | bash`, ctx.projectDir, ctx, task);
  }
  task.title = `Installed Bun`;
  ctx.done.push(`bun ${version}`);
}

async function installSwift(version: string, requiresXcode: boolean, needsCocoaPods: boolean, ctx: PlaybookCtx, task: any): Promise<void> {
  if (os.platform() !== "darwin") {
    ctx.warnings.push(`Swift ${version}: install via swiftly — curl -L https://swift-server.github.io/swiftly/swiftly-install.sh | bash`);
    task.title = `Swift ${version} — install manually (non-macOS)`;
    return;
  }
  if (requiresXcode) {
    const xcs = await tryVersion("xcode-select", ["-p"]);
    if (!xcs || xcs.includes("error")) {
      ctx.warnings.push("Xcode required for iOS/macOS targets — install from the Mac App Store, or run: xcode-select --install");
    }
  }
  const current = await tryVersion("swift", ["--version"]);
  if (current && current.includes(version)) {
    task.title = `Swift ${current.split("\n")[0]} already installed`;
  } else if (await which("swiftenv")) {
    task.title = `Installing Swift ${version} via swiftenv`;
    await runShell(`swiftenv install ${version} 2>/dev/null || true; swiftenv local ${version}`, ctx.projectDir, ctx, task);
  } else if (current) {
    ctx.warnings.push(`Swift ${version} requested; found ${current.split("\n")[0]}. To pin: brew install swiftenv`);
    task.title = `Swift available (version not pinned)`;
  } else if (await which("brew")) {
    task.title = `Installing swiftenv + Swift ${version}`;
    await runShell(`brew install swiftenv && swiftenv install ${version} && swiftenv local ${version}`, ctx.projectDir, ctx, task);
  } else {
    ctx.warnings.push(`Install Swift ${version}: brew install swiftenv && swiftenv install ${version}`);
    task.title = `Swift ${version} — install manually`;
    return;
  }
  if (needsCocoaPods && !(await which("pod"))) {
    task.title = `Installing CocoaPods`;
    if (await which("brew")) {
      await runShell(`brew install cocoapods`, ctx.projectDir, ctx, task);
    } else {
      await runShell(`sudo gem install cocoapods`, ctx.projectDir, ctx, task);
    }
  }
  task.title = `Installed Swift ${version}`;
  ctx.done.push(`swift ${version}`);
}

async function installHaskell(ghcVersion: string, isStack: boolean, ctx: PlaybookCtx, task: any): Promise<void> {
  const current = await tryVersion("ghc", ["--version"]);
  if (current && current.includes(ghcVersion)) {
    task.title = `GHC ${current.split(",").pop()?.trim() ?? ghcVersion} already installed`;
    return;
  }
  const hasGhcup = await which("ghcup");
  if (!hasGhcup) {
    task.title = `Installing GHCup`;
    await runShell(
      `curl --proto '=https' --tlsv1.2 -sSf https://get-ghcup.haskell.org | ` +
      `BOOTSTRAP_HASKELL_NONINTERACTIVE=1 BOOTSTRAP_HASKELL_GHC_VERSION=${ghcVersion} ` +
      `BOOTSTRAP_HASKELL_INSTALL_STACK=${isStack ? "1" : "0"} sh`,
      ctx.projectDir, ctx, task);
  } else {
    task.title = `Installing GHC ${ghcVersion}`;
    await runShell(`ghcup install ghc ${ghcVersion} && ghcup set ghc ${ghcVersion}`, ctx.projectDir, ctx, task);
    if (isStack && !(await which("stack"))) {
      await runShell(`ghcup install stack`, ctx.projectDir, ctx, task);
    }
  }
  task.title = `Installed GHC ${ghcVersion}`;
  ctx.done.push(`ghc ${ghcVersion}`);
}

async function installScala(scalaVersion: string, buildSystem: string, ctx: PlaybookCtx, task: any): Promise<void> {
  const current = await tryVersion("scala", ["-version"]);
  if (current && current.includes(scalaVersion)) {
    task.title = `Scala ${scalaVersion} already installed`;
    return;
  }
  const hasCs = (await which("cs")) || (await which("coursier"));
  if (!hasCs) {
    if (os.platform() === "darwin" && (await which("brew"))) {
      task.title = `Installing coursier (cs)`;
      await runShell(`brew install coursier/formulas/coursier && cs setup --yes`, ctx.projectDir, ctx, task);
    } else {
      task.title = `Installing coursier`;
      await runShell(
        `curl -fL https://github.com/coursier/launchers/raw/master/cs-x86_64-pc-linux.gz | gzip -d > cs && ` +
        `chmod +x cs && ./cs setup --yes`,
        ctx.projectDir, ctx, task);
    }
  }
  task.title = `Installing Scala ${scalaVersion}`;
  await runShell(`cs install scala:${scalaVersion}.0 scala3-compiler:${scalaVersion}.0 || true`, ctx.projectDir, ctx, task);
  if (buildSystem === "sbt" && !(await which("sbt"))) {
    if (os.platform() === "darwin" && (await which("brew"))) {
      await runShell(`brew install sbt`, ctx.projectDir, ctx, task);
    } else {
      await runShell(`cs install sbt`, ctx.projectDir, ctx, task);
    }
  }
  task.title = `Installed Scala ${scalaVersion}`;
  ctx.done.push(`scala ${scalaVersion}`);
}

async function installClojure(buildSystem: string, ctx: PlaybookCtx, task: any): Promise<void> {
  if (!(await which("clojure"))) {
    if (os.platform() === "darwin" && (await which("brew"))) {
      task.title = `Installing Clojure via brew`;
      await runShell(`brew install clojure/tools/clojure`, ctx.projectDir, ctx, task);
    } else {
      task.title = `Installing Clojure CLI`;
      await runShell(
        `curl -L -O https://github.com/clojure/brew-install/releases/latest/download/linux-install.sh && ` +
        `chmod +x linux-install.sh && sudo ./linux-install.sh`,
        ctx.projectDir, ctx, task);
    }
  }
  if (buildSystem === "leiningen" && !(await which("lein"))) {
    if (os.platform() === "darwin" && (await which("brew"))) {
      task.title = `Installing Leiningen`;
      await runShell(`brew install leiningen`, ctx.projectDir, ctx, task);
    } else {
      task.title = `Installing Leiningen`;
      await runShell(
        `curl -O https://raw.githubusercontent.com/technomancy/leiningen/stable/bin/lein && ` +
        `chmod +x lein && sudo mv lein /usr/local/bin/ && lein`,
        ctx.projectDir, ctx, task);
    }
  }
  task.title = `Installed Clojure`;
  ctx.done.push(`clojure`);
}

async function installR(version: string, ctx: PlaybookCtx, task: any): Promise<void> {
  const current = await tryVersion("R", ["--version"]);
  if (current && current.includes(`R version ${version}`)) {
    task.title = `R ${version} already installed`;
    return;
  }
  if (os.platform() === "darwin") {
    if (!(await which("rig"))) {
      task.title = `Installing rig (R installation manager)`;
      await runShell(`brew tap r-lib/rig && brew install --cask rig`, ctx.projectDir, ctx, task);
    }
    task.title = `Installing R ${version}`;
    await runShell(`rig install ${version} && rig default ${version}`, ctx.projectDir, ctx, task);
  } else {
    ctx.warnings.push(`Install R ${version}: 'sudo apt-get install r-base r-base-dev' or use rig (https://github.com/r-lib/rig)`);
    task.title = `R ${version} — install manually`;
    return;
  }
  task.title = `Installed R ${version}`;
  ctx.done.push(`r ${version}`);
}

async function installJulia(version: string, ctx: PlaybookCtx, task: any): Promise<void> {
  const current = await tryVersion("julia", ["--version"]);
  if (current && current.includes(version)) {
    task.title = `Julia ${version} already installed`;
    return;
  }
  if (os.platform() === "darwin" && (await which("brew"))) {
    if (!(await which("juliaup"))) {
      task.title = `Installing juliaup`;
      await runShell(`brew install juliaup`, ctx.projectDir, ctx, task);
    }
    task.title = `Installing Julia ${version}`;
    await runShell(`juliaup add ${version} && juliaup default ${version}`, ctx.projectDir, ctx, task);
  } else {
    if (!(await which("juliaup"))) {
      task.title = `Installing juliaup`;
      await runShell(`curl -fsSL https://install.julialang.org | sh -s -- --yes`, ctx.projectDir, ctx, task);
    }
    task.title = `Installing Julia ${version}`;
    await runShell(`juliaup add ${version} && juliaup default ${version}`, ctx.projectDir, ctx, task);
  }
  task.title = `Installed Julia ${version}`;
  ctx.done.push(`julia ${version}`);
}

async function installZig(version: string, ctx: PlaybookCtx, task: any): Promise<void> {
  const current = await tryVersion("zig", ["version"]);
  if (current && current.trim() === version) {
    task.title = `Zig ${version} already installed`;
    return;
  }
  if (os.platform() === "darwin" && (await which("brew"))) {
    if (await which("zvm")) {
      task.title = `Installing Zig ${version} via zvm`;
      await runShell(`zvm install ${version} && zvm use ${version}`, ctx.projectDir, ctx, task);
    } else {
      task.title = `Installing Zig via brew`;
      await runShell(`brew install zig`, ctx.projectDir, ctx, task);
    }
  } else {
    const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
    task.title = `Installing Zig ${version} (binary)`;
    await runShell(
      `curl -L https://ziglang.org/download/${version}/zig-linux-${arch}-${version}.tar.xz ` +
      `| tar -xJ -C $HOME/.local/share/ && ` +
      `echo 'export PATH="$HOME/.local/share/zig-linux-${arch}-${version}:$PATH"' >> ~/.bashrc`,
      ctx.projectDir, ctx, task);
    ctx.warnings.push(`Add $HOME/.local/share/zig-linux-${arch}-${version} to your PATH`);
  }
  task.title = `Installed Zig ${version}`;
  ctx.done.push(`zig ${version}`);
}

async function installOCaml(version: string, ctx: PlaybookCtx, task: any): Promise<void> {
  if (!(await which("opam"))) {
    if (os.platform() === "darwin" && (await which("brew"))) {
      task.title = `Installing opam`;
      await runShell(`brew install opam && opam init --bare --yes`, ctx.projectDir, ctx, task);
    } else {
      task.title = `Installing opam`;
      await runShell(
        `bash -c "$(curl -fsSL https://raw.githubusercontent.com/ocaml/opam/master/shell/install.sh)" && opam init --bare --yes`,
        ctx.projectDir, ctx, task);
    }
  }
  const current = await tryVersion("ocaml", ["--version"]);
  if (current && current.includes(version)) {
    task.title = `OCaml ${version} already installed`;
  } else {
    task.title = `Installing OCaml ${version}`;
    await runShell(`opam switch create ${version} --yes 2>/dev/null || opam switch ${version} 2>/dev/null || true`, ctx.projectDir, ctx, task);
  }
  if (!(await which("dune"))) {
    await runShell(`opam install dune --yes`, ctx.projectDir, ctx, task);
  }
  task.title = `Installed OCaml ${version}`;
  ctx.done.push(`ocaml ${version}`);
}

async function installBazel(ctx: PlaybookCtx, task: any): Promise<void> {
  if (await which("bazel")) {
    task.title = `Bazel already installed`;
    return;
  }
  if (os.platform() === "darwin" && (await which("brew"))) {
    task.title = `Installing bazelisk via brew`;
    await runShell(`brew install bazelisk`, ctx.projectDir, ctx, task);
  } else {
    task.title = `Installing bazelisk via npm`;
    await runShell(`npm install -g @bazel/bazelisk`, ctx.projectDir, ctx, task);
  }
  task.title = `Installed bazelisk (reads .bazelversion)`;
  ctx.done.push(`bazel`);
}

async function androidSdkCheck(ctx: PlaybookCtx, task: any): Promise<void> {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdk) {
    task.title = `Android SDK detected at ${sdk}`;
    return;
  }
  ctx.warnings.push(
    "Android SDK not detected — install Android Studio (https://developer.android.com/studio) " +
    "or set ANDROID_HOME to your SDK path"
  );
  task.title = `Android SDK — install Android Studio`;
}
