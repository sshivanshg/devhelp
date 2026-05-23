#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { runAgent } from "./agent.js";
import { runOffline } from "./offline.js";

const program = new Command();

program
  .name("devhelp")
  .description("AI agent that sets up, configures, and repairs dev environments.")
  .version("0.4.0");

program
  .argument("<request...>", 'Natural language request, e.g. "Set me up to contribute to the React repo"')
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("--dry-run", "Print what would happen without executing", false)
  .option("--yes", "Auto-approve destructive actions (installs, clones)", false)
  .option("--offline", "Force offline mode — deterministic playbook, no LLM, no network calls to AI providers", false)
  .option("--verbose", "Show skipped steps and a detailed action summary", false)
  .option("--model <id>", "Override the Anthropic model (online mode only)", process.env.DEVHELP_MODEL ?? "claude-sonnet-4-6")
  .option("--max-steps <n>", "Maximum agent steps (online mode only)", (v) => parseInt(v, 10), 25)
  .action(async (requestParts: string[], opts) => {
    const request = requestParts.join(" ").trim();

    const useOffline = opts.offline || !process.env.ANTHROPIC_API_KEY;

    if (!opts.offline && !process.env.ANTHROPIC_API_KEY) {
      console.log(
        chalk.yellow("No ANTHROPIC_API_KEY found — running in offline mode."),
        chalk.dim("(set ANTHROPIC_API_KEY for AI-assisted mode, or pass --offline to silence this notice)"),
      );
      console.log();
    }

    try {
      if (useOffline) {
        const exitCode = await runOffline({
          request,
          cwd: opts.cwd,
          dryRun: opts.dryRun,
          verbose: opts.verbose,
        });
        if (exitCode !== 0) process.exit(exitCode);
      } else {
        const exitCode = await runAgent({
          request,
          cwd: opts.cwd,
          dryRun: opts.dryRun,
          autoApprove: opts.yes,
          model: opts.model,
          maxSteps: opts.maxSteps,
        });
        if (exitCode !== 0) process.exit(exitCode);
      }
    } catch (err) {
      console.error(chalk.red("\ndevhelp failed:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
