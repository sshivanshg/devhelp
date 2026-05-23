import { execa } from "execa";
import { simpleGit } from "simple-git";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeNodeVersion } from "./versions.js";

export interface ToolContext {
  cwd: string;
  dryRun: boolean;
  autoApprove: boolean;
}

export interface ToolResult {
  output: string;
  isError: boolean;
}

export const tools: Anthropic.Tool[] = [
  {
    name: "inspect_system",
    description:
      "Inspect the local machine: OS, architecture, installed runtimes (node, python, ruby, go, rust, java), package managers (npm, pnpm, yarn, pip, brew, apt), version managers (nvm, pyenv, rustup, asdf, volta), git config, build tools.",
    input_schema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description:
            "Optional list of specific tools to check (comma-separated). Defaults to a standard sweep.",
        },
      },
    },
  },
  {
    name: "clone_repo",
    description:
      "Clone a git repository into the working directory. Accepts a full URL or a github shorthand like 'facebook/react'.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository URL or owner/name shorthand." },
        dir: { type: "string", description: "Destination directory name. Defaults to the repo name." },
        depth: { type: "number", description: "Optional shallow clone depth." },
      },
      required: ["repo"],
    },
  },
  {
    name: "read_manifest",
    description:
      "Read project manifest files (package.json, pyproject.toml, requirements.txt, Cargo.toml, go.mod, Gemfile, .nvmrc, .python-version, .tool-versions, .ruby-version). Pass a project root; returns whichever manifests exist.",
    input_schema: {
      type: "object",
      properties: {
        project_dir: { type: "string", description: "Absolute or relative path to project root." },
      },
      required: ["project_dir"],
    },
  },
  {
    name: "list_dir",
    description: "List the contents of a directory (one level deep).",
    input_schema: {
      type: "object",
      properties: {
        dir: { type: "string" },
      },
      required: ["dir"],
    },
  },
  {
    name: "read_file",
    description: "Read a text file. Limited to 64 KB.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
  },
  {
    name: "run_shell",
    description:
      "Run a shell command. Use this for installs (npm install, pip install, brew install, cargo build), version manager operations (nvm install, pyenv install), and diagnostic commands. Runs in a login shell so nvm/pyenv shell functions are available. Times out after 10 minutes.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The full shell command to execute." },
        cwd: { type: "string", description: "Working directory for the command. Defaults to project cwd." },
        reason: { type: "string", description: "One-sentence justification shown to the user." },
      },
      required: ["command", "reason"],
    },
  },
  {
    name: "install_version_manager",
    description:
      "Install a version manager if missing: nvm (Node), pyenv (Python), rustup (Rust). On macOS prefers Homebrew; falls back to the official installer script.",
    input_schema: {
      type: "object",
      properties: {
        manager: { type: "string", enum: ["nvm", "pyenv", "rustup"] },
      },
      required: ["manager"],
    },
  },
  {
    name: "install_runtime",
    description:
      "Install a specific runtime version through the appropriate version manager. Examples: node 20.11.1, python 3.12.4, rust stable.",
    input_schema: {
      type: "object",
      properties: {
        runtime: { type: "string", enum: ["node", "python", "rust"] },
        version: { type: "string", description: "Version string, or 'lts'/'stable' where applicable." },
        set_default: { type: "boolean", description: "Set as the global default. Defaults to false." },
      },
      required: ["runtime", "version"],
    },
  },
  {
    name: "write_file",
    description: "Write a small text file (config, dotfile). Use only when configuring the project.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
];

export async function dispatch(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = (rawInput ?? {}) as Record<string, any>;
  try {
    switch (name) {
      case "inspect_system":
        return ok(await inspectSystem(input.focus));
      case "clone_repo":
        return ok(await cloneRepo(input.repo, input.dir, input.depth, ctx));
      case "read_manifest":
        return ok(await readManifest(resolve(ctx, input.project_dir)));
      case "list_dir":
        return ok(await listDir(resolve(ctx, input.dir)));
      case "read_file":
        return ok(await readFile(resolve(ctx, input.path)));
      case "run_shell":
        return await runShell(input.command, input.cwd ? resolve(ctx, input.cwd) : ctx.cwd, ctx);
      case "install_version_manager":
        return await installVersionManager(input.manager, ctx);
      case "install_runtime":
        return await installRuntime(input.runtime, input.version, !!input.set_default, ctx);
      case "write_file":
        return ok(await writeFile(resolve(ctx, input.path), input.content, ctx));
      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

function ok(output: string): ToolResult {
  return { output: output || "(no output)", isError: false };
}
function err(output: string): ToolResult {
  return { output, isError: true };
}
function resolve(ctx: ToolContext, p: string): string {
  if (!p) return ctx.cwd;
  return path.isAbsolute(p) ? p : path.resolve(ctx.cwd, p);
}

async function which(cmd: string): Promise<string | null> {
  try {
    const r = await execa("which", [cmd]);
    return r.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function tryVersion(cmd: string, args: string[] = ["--version"]): Promise<string | null> {
  try {
    const r = await execa(cmd, args, { timeout: 5000 });
    return (r.stdout || r.stderr).split("\n")[0].trim();
  } catch {
    return null;
  }
}

async function inspectSystem(focus?: string): Promise<string> {
  const lines: string[] = [];
  lines.push(`OS: ${os.platform()} ${os.release()} (${os.arch()})`);
  lines.push(`User: ${os.userInfo().username}  Shell: ${process.env.SHELL ?? "unknown"}`);
  lines.push(`Home: ${os.homedir()}`);

  const defaults = [
    "git",
    "node",
    "npm",
    "pnpm",
    "yarn",
    "bun",
    "python3",
    "pip3",
    "ruby",
    "go",
    "rustc",
    "cargo",
    "java",
    "make",
    "gcc",
    "clang",
    "docker",
    "brew",
    "nvm",
    "pyenv",
    "rustup",
    "asdf",
    "volta",
  ];
  const targets = focus
    ? focus.split(",").map((s) => s.trim()).filter(Boolean)
    : defaults;

  lines.push("");
  lines.push("Tools:");
  for (const t of targets) {
    if (t === "nvm") {
      const nvmDir = process.env.NVM_DIR ?? path.join(os.homedir(), ".nvm");
      try {
        await fs.access(path.join(nvmDir, "nvm.sh"));
        lines.push(`  nvm: present (${nvmDir})`);
      } catch {
        lines.push(`  nvm: not installed`);
      }
      continue;
    }
    const loc = await which(t);
    if (!loc) {
      lines.push(`  ${t}: not installed`);
      continue;
    }
    const v = await tryVersion(t);
    lines.push(`  ${t}: ${v ?? "(version unknown)"} at ${loc}`);
  }

  if (os.platform() === "darwin") {
    const xcode = await tryVersion("xcode-select", ["-p"]);
    lines.push("");
    lines.push(`Xcode CLT: ${xcode ?? "missing (run: xcode-select --install)"}`);
  }
  return lines.join("\n");
}

async function cloneRepo(
  repo: string,
  dir: string | undefined,
  depth: number | undefined,
  ctx: ToolContext,
): Promise<string> {
  const url = /^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://github.com/${repo}.git` : repo;
  const target = dir ?? guessRepoName(url);
  const dest = path.resolve(ctx.cwd, target);
  try {
    await fs.access(dest);
    const entries = await fs.readdir(dest);
    if (entries.length) return `Directory ${dest} already exists and is non-empty; skipping clone.`;
  } catch {
    /* ok, doesn't exist */
  }
  if (ctx.dryRun) return `[dry-run] would clone ${url} -> ${dest}`;
  const git = simpleGit({ baseDir: ctx.cwd });
  const args: string[] = [];
  if (depth) args.push("--depth", String(depth));
  await git.clone(url, dest, args);
  return `Cloned ${url} -> ${dest}`;
}

function guessRepoName(url: string): string {
  const m = url.match(/([^/]+?)(?:\.git)?$/);
  return m?.[1] ?? "repo";
}

const MANIFEST_FILES = [
  "package.json",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
  ".nvmrc",
  ".node-version",
  ".python-version",
  ".ruby-version",
  ".tool-versions",
  "rust-toolchain",
  "rust-toolchain.toml",
];

async function readManifest(dir: string): Promise<string> {
  const out: string[] = [`Project: ${dir}`];
  let found = 0;
  for (const f of MANIFEST_FILES) {
    const p = path.join(dir, f);
    try {
      const buf = await fs.readFile(p);
      if (buf.byteLength > 32_000) {
        out.push(`\n--- ${f} (truncated, ${buf.byteLength}B) ---\n` + buf.toString("utf8").slice(0, 8000));
      } else {
        out.push(`\n--- ${f} ---\n` + buf.toString("utf8"));
      }
      found++;
    } catch {
      /* skip */
    }
  }
  if (!found) out.push("(no recognized manifests found)");
  return out.join("\n");
}

async function listDir(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort()
    .join("\n");
}

async function readFile(p: string): Promise<string> {
  const buf = await fs.readFile(p);
  if (buf.byteLength > 64_000) return buf.toString("utf8").slice(0, 64_000) + "\n…[truncated]";
  return buf.toString("utf8");
}

async function runShell(command: string, cwd: string, ctx: ToolContext): Promise<ToolResult> {
  if (ctx.dryRun) return ok(`[dry-run] ${command}  (cwd: ${cwd})`);
  const shell = process.env.SHELL || "/bin/bash";
  const isZsh = shell.endsWith("zsh");
  const args = isZsh ? ["-lc", command] : ["-lc", command];
  try {
    const r = await execa(shell, args, {
      cwd,
      timeout: 10 * 60 * 1000,
      env: { ...process.env, FORCE_COLOR: "0" },
      reject: false,
    });
    const out = [
      `$ ${command}`,
      r.stdout,
      r.stderr,
      `(exit ${r.exitCode})`,
    ].filter(Boolean).join("\n");
    return { output: out, isError: r.exitCode !== 0 };
  } catch (e) {
    return err(`shell error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function installVersionManager(manager: string, ctx: ToolContext): Promise<ToolResult> {
  const platform = os.platform();
  switch (manager) {
    case "nvm": {
      const nvmDir = process.env.NVM_DIR ?? path.join(os.homedir(), ".nvm");
      try {
        await fs.access(path.join(nvmDir, "nvm.sh"));
        return ok("nvm already installed");
      } catch {
        /* install */
      }
      const cmd =
        'curl -fsSL -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash';
      return await runShell(cmd, ctx.cwd, ctx);
    }
    case "pyenv": {
      if ((await which("pyenv")) ) return ok("pyenv already installed");
      const cmd =
        platform === "darwin" && (await which("brew"))
          ? "brew install pyenv"
          : "curl -fsSL https://pyenv.run | bash";
      return await runShell(cmd, ctx.cwd, ctx);
    }
    case "rustup": {
      if (await which("rustup")) return ok("rustup already installed");
      const cmd = "curl -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain none";
      return await runShell(cmd, ctx.cwd, ctx);
    }
    default:
      return err(`Unknown version manager: ${manager}`);
  }
}

async function installRuntime(
  runtime: string,
  version: string,
  setDefault: boolean,
  ctx: ToolContext,
): Promise<ToolResult> {
  switch (runtime) {
    case "node": {
      const v = normalizeNodeVersion(version);
      const sub = [
        'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
        '[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"',
        `nvm install ${v}`,
        `nvm use ${v}`,
        setDefault ? `nvm alias default ${v}` : "",
      ]
        .filter(Boolean)
        .join(" && ");
      return await runShell(sub, ctx.cwd, ctx);
    }
    case "python": {
      const cmd = setDefault
        ? `pyenv install -s ${version} && pyenv global ${version}`
        : `pyenv install -s ${version} && pyenv local ${version}`;
      return await runShell(cmd, ctx.cwd, ctx);
    }
    case "rust": {
      const cmd = `rustup toolchain install ${version}${setDefault ? ` && rustup default ${version}` : ""}`;
      return await runShell(cmd, ctx.cwd, ctx);
    }
    default:
      return err(`Unknown runtime: ${runtime}`);
  }
}

async function writeFile(p: string, content: string, ctx: ToolContext): Promise<string> {
  if (ctx.dryRun) return `[dry-run] would write ${p} (${content.length}B)`;
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, "utf8");
  return `Wrote ${p} (${content.length}B)`;
}
