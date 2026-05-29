/**
 * Minimal MCP (Model Context Protocol) server over stdio.
 *
 * Exposes devhelp's read-only analysis (detect + doctor) as MCP tools so an
 * agent can call them. Hand-rolled JSON-RPC 2.0 over newline-delimited stdio —
 * no SDK dependency, matching the project's no-extra-deps style.
 *
 * Contract: stdout carries ONLY JSON-RPC messages (one per line). Anything
 * diagnostic must go to stderr, or it corrupts the stream. The tools we call
 * (detect, diagnoseProject) are print-free by construction.
 */
import { detect, isDetectionEmpty } from "./detect.js";
import { describe, diagnoseProject } from "./setup.js";
import { pkgVersion } from "./versions.js";

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "detect",
    description: "Detect the dev stack (runtimes, package manager, frameworks, services) of a project directory.",
    inputSchema: {
      type: "object",
      properties: { cwd: { type: "string", description: "Project directory (default: current dir)" } },
    },
  },
  {
    name: "doctor",
    description: "Diagnose a project: detected stack vs. what's installed on PATH, plus service/env/prisma needs.",
    inputSchema: {
      type: "object",
      properties: { cwd: { type: "string", description: "Project directory (default: current dir)" } },
    },
  },
];

function send(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const cwd = typeof args.cwd === "string" && args.cwd ? args.cwd : process.cwd();
  if (name === "detect") {
    const d = await detect(cwd);
    const text = JSON.stringify({ summary: describe(d), unsupported: isDetectionEmpty(d), detected: d }, null, 2);
    return { content: [{ type: "text", text }] };
  }
  if (name === "doctor") {
    const report = await diagnoseProject(cwd);
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
  throw new Error(`unknown tool: ${name}`);
}

export async function dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: (params.protocolVersion as string) ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "devhelp", version: pkgVersion() },
      };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return await callTool(params.name as string, (params.arguments as Record<string, unknown>) ?? {});
    case "ping":
      return {};
    default:
      throw new Error(`method not found: ${method}`);
  }
}

async function handleLine(line: string): Promise<void> {
  let msg: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore non-JSON noise
  }
  if (!msg.method) return; // a response or junk — not for us
  // Notifications (no id) get no reply.
  if (msg.id === undefined) return;
  try {
    const result = await dispatch(msg.method, msg.params ?? {});
    send({ jsonrpc: "2.0", id: msg.id, result });
  } catch (e) {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
    });
  }
}

export function runMcpServer(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    let buf = "";
    let chain: Promise<void> = Promise.resolve();
    process.stdin.on("data", (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) chain = chain.then(() => handleLine(line)); // serialize handling
      }
    });
    process.stdin.on("end", () => resolve());
    process.stdin.resume();
  });
}
