/**
 * Post-setup verification.
 *
 * devhelp's stated success metric is: "did `pnpm dev` actually work afterwards?"
 * --verify makes that measurable per-run instead of only in a stress test. It
 * runs the project's test command and boots its dev server, polling the dev URL
 * for a real response, then tears the server down.
 *
 * Spawning + network only happen when the user passes --verify.
 */
import { execa, type ResultPromise } from "execa";

export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Treat 2xx/3xx/4xx as "the server is up and routing." A 404 still proves the
 * dev server booted and is answering; only a connection failure or 5xx during
 * boot means it isn't ready.
 */
export function isServerUp(status: number): boolean {
  return status >= 200 && status < 500;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ status: number }>;

/** Poll a URL until it answers (per isServerUp) or the timeout elapses. */
export async function pollUrl(
  url: string,
  timeoutMs: number,
  fetcher: Fetcher = fetch as unknown as Fetcher,
  intervalMs = 1000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetcher(url, { signal: AbortSignal.timeout(3000) });
      if (isServerUp(res.status)) return true;
    } catch {
      /* not up yet */
    }
    await sleep(intervalMs);
  }
  return false;
}

/** Run the test command (already runtime-wrapped) and report pass/fail. */
export async function verifyTests(
  shellCmd: string,
  cwd: string,
  label: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<VerifyCheck> {
  const shell = process.env.SHELL || "/bin/bash";
  const r = await execa(shell, ["-lc", shellCmd], {
    cwd,
    reject: false,
    timeout: timeoutMs,
    env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
  });
  const ok = r.exitCode === 0;
  return { name: label, ok, detail: ok ? "passed" : `failed (exit ${r.exitCode ?? "timeout"})` };
}

/** Boot the dev server, poll its URL, then kill the process group. */
export async function verifyDevServer(
  shellCmd: string,
  cwd: string,
  url: string,
  label: string,
  timeoutMs = 60 * 1000,
): Promise<VerifyCheck> {
  const shell = process.env.SHELL || "/bin/bash";
  // detached so the child is its own process-group leader — lets us kill the
  // whole tree (dev servers spawn children) by signalling the negative pid.
  const sub = execa(shell, ["-lc", shellCmd], {
    cwd,
    reject: false,
    detached: true,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  try {
    const ok = await pollUrl(url, timeoutMs);
    return {
      name: label,
      ok,
      detail: ok ? `responded at ${url}` : `no response within ${Math.round(timeoutMs / 1000)}s`,
    };
  } finally {
    killProcessTree(sub);
  }
}

function killProcessTree(sub: ResultPromise): void {
  const pid = sub.pid;
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
      return;
    } catch {
      /* group already gone or not a leader — fall through */
    }
  }
  try {
    sub.kill("SIGKILL");
  } catch {
    /* already dead */
  }
}
