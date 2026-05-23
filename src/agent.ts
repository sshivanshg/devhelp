import Anthropic from "@anthropic-ai/sdk";
import chalk from "chalk";
import ora from "ora";
import { tools, dispatch, type ToolContext } from "./tools.js";

export interface RunOptions {
  request: string;
  cwd: string;
  dryRun: boolean;
  autoApprove: boolean;
  model: string;
  maxSteps: number;
}

const SYSTEM_PROMPT = `You are devhelp's AI-assisted mode. The deterministic offline path has already failed or been bypassed — your job is to handle repos with non-standard build scripts that the rule-based detector couldn't recognize.

You operate by calling tools. Be decisive and act — do not ask the user clarifying questions unless absolutely necessary, since this runs as a one-shot CLI.

Scope:
- You are NOT a general "fix anything" agent. If the offline playbook would have handled this repo cleanly, you shouldn't have been called.
- You are NOT a self-healing system. Deterministic recovery (missing Xcode CLT, node-gyp Python, OpenSSL/pkg-config) lives in the offline path, not here. Don't promise the user you'll repair their system; do the install and report what happened.
- Prefer the smallest set of tool calls that gets the job done. If you can answer from one read_manifest + one run_shell, do that. Don't bloat the trace.

Standard playbook:
1. read_manifest on the project to understand the build system. If you've been invoked, the rule-based detector didn't recognize something — find the non-standard piece.
2. If a recognized runtime is needed and missing, install_version_manager + install_runtime.
3. Run the install/build command(s) the project's scripts or documentation indicate via run_shell.
4. If a command fails, report the failure verbatim and stop. Don't loop trying random fixes.
5. Output a final summary as plain text (not via a tool): what you did, what's left, how to start the dev server / run tests.

Style: terse status lines. No fluff. Honest about what worked and what didn't.`;

export async function runAgent(opts: RunOptions): Promise<number> {
  const client = new Anthropic();
  const ctx: ToolContext = {
    cwd: opts.cwd,
    dryRun: opts.dryRun,
    autoApprove: opts.autoApprove,
  };

  console.log(chalk.cyan.bold("devhelp"), chalk.dim(`· ${opts.model}${opts.dryRun ? " · DRY RUN" : ""}`));
  console.log(chalk.dim("›"), opts.request);
  console.log();

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: opts.request },
  ];

  for (let step = 0; step < opts.maxSteps; step++) {
    const spinner = ora({ text: chalk.dim("thinking..."), color: "cyan" }).start();
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: opts.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });
    } finally {
      spinner.stop();
    }

    const assistantContent = response.content;
    messages.push({ role: "assistant", content: assistantContent });

    const toolUses = assistantContent.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    const textBlocks = assistantContent.filter(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );

    for (const block of textBlocks) {
      const text = block.text.trim();
      if (text) console.log(chalk.white(text));
    }

    if (response.stop_reason === "end_turn" || toolUses.length === 0) {
      console.log();
      console.log(chalk.green("✓ done"));
      return 0;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      console.log(chalk.blue("→"), chalk.bold(toolUse.name), chalk.dim(summarizeInput(toolUse.input)));
      const result = await dispatch(toolUse.name, toolUse.input, ctx);
      const preview = result.output.split("\n").slice(0, 3).join("\n");
      if (preview.trim()) {
        console.log(chalk.dim(indent(preview, "  ")));
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result.output.slice(0, 16000),
        is_error: result.isError,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  console.log(chalk.yellow(`\nReached max steps (${opts.maxSteps}). Stopping.`));
  return 1;
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    parts.push(`${k}=${s.length > 60 ? s.slice(0, 57) + "..." : s}`);
  }
  return parts.join(" ");
}

function indent(text: string, prefix: string): string {
  return text.split("\n").map((l) => prefix + l).join("\n");
}
