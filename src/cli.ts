#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { runOffline, runDoctor } from "./offline.js";
import { runMcpServer } from "./mcp.js";
import { pkgVersion } from "./versions.js";

const program = new Command();

program
  .name("devhelp")
  .description("Clone an OSS repo, get a working dev environment. Deterministic — no LLM, no network calls to AI providers.")
  .version(pkgVersion());

program
  .command("doctor")
  .description("Diagnose the current project (detected stack vs. what's installed) without changing anything")
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("--json", "Emit the diagnosis as JSON", false)
  .action(async (_opts, command) => {
    // The root command also declares --json, so commander binds it to the
    // program; optsWithGlobals merges parent + subcommand options.
    const opts = command.optsWithGlobals();
    try {
      const exitCode = await runDoctor({ cwd: opts.cwd, json: opts.json });
      if (exitCode !== 0) process.exit(exitCode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.json) console.log(JSON.stringify({ status: "ERROR", error: message }, null, 2));
      else console.error(chalk.red("\ndevhelp doctor failed:"), message);
      process.exit(1);
    }
  });

program
  .command("mcp")
  .description("Run as an MCP server over stdio (exposes detect + doctor as tools)")
  .action(async () => {
    await runMcpServer();
  });

program
  .argument("<request...>", 'Repo to set up — a github.com URL or owner/repo, e.g. "Set me up to contribute to facebook/react"')
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("--dry-run", "Print what would happen without executing", false)
  .option("--verbose", "Show skipped steps and a detailed action summary", false)
  .option("--json", "Emit a machine-readable JSON result instead of the panels", false)
  .option("--fix", "On a recoverable failure, install the missing system dep and retry once", false)
  .option("--write-lock", "Write a .devhelp.lock with the resolved runtime versions", false)
  .option("--with-services", "Start detected docker compose services (default: only surface them)", false)
  .option("--verify", "After setup, run tests and boot the dev server to confirm it actually works", false)
  .option("--vscode", "Generate a .vscode/launch.json for the detected stack (won't overwrite)", false)
  .option("--secrets", "Populate .env from a detected secrets provider (1Password / Doppler)", false)
  .action(async (requestParts: string[], opts) => {
    const request = requestParts.join(" ").trim();

    try {
      const exitCode = await runOffline({
        request,
        cwd: opts.cwd,
        dryRun: opts.dryRun,
        verbose: opts.verbose,
        json: opts.json,
        fix: opts.fix,
        writeLock: opts.writeLock,
        withServices: opts.withServices,
        verify: opts.verify,
        vscode: opts.vscode,
        secrets: opts.secrets,
      });
      if (exitCode !== 0) process.exit(exitCode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.json) {
        console.log(JSON.stringify({ status: "ERROR", error: message }, null, 2));
      } else {
        console.error(chalk.red("\ndevhelp failed:"), message);
      }
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
