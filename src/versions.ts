import { readFileSync } from "node:fs";

/** devhelp's own version, read from the shipped package.json. */
export function pkgVersion(): string {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * True when a version spec means "at least X" — a `>=`/`>` lower bound with no
 * upper bound (e.g. ">=18", "> 16.0"). Such specs are satisfied by any newer
 * runtime, so doctor must compare them as a floor, not an exact pin. Caret/tilde
 * and bounded ranges (containing `<`) are deliberately excluded.
 */
export function isFloorSpec(spec?: string | null): boolean {
  if (!spec) return false;
  const t = spec.trim();
  return /^>=?\s*v?\d/.test(t) && !t.includes("<");
}

/**
 * Turn package.json / .nvmrc semver specs into versions nvm understands.
 * e.g. ">=18" -> "18", "^20.0.0" -> "20", "lts/*" unchanged.
 */
export function normalizeNodeVersion(spec: string): string {
  let t = spec.trim().replace(/^v/, "");
  if (!t) return "lts/*";

  if (/^(lts|node|system)(\/|\*|$|-)/i.test(t)) return t;
  if (/^\d+\.\d+\.\d+/.test(t)) return t;
  if (/^\d+\.\d+$/.test(t)) return t;
  if (/^\d+$/.test(t)) return t;

  const gte = t.match(/>=?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (gte) {
    const [, major, minor, patch] = gte;
    if (minor !== undefined && patch !== undefined) return `${major}.${minor}.${patch}`;
    if (minor !== undefined) return `${major}.${minor}`;
    return major;
  }

  const caret = t.match(/\^\s*v?(\d+)/);
  if (caret) return caret[1];

  const tilde = t.match(/~\s*v?(\d+)\.(\d+)/);
  if (tilde) return `${tilde[1]}.${tilde[2]}`;

  const xr = t.match(/^(\d+)(?:\.x(?:\.x)?)?$/i);
  if (xr) return xr[1];

  if (t === "*" || t === "x") return "lts/*";

  return t;
}

/** Normalize Gemfile ruby version requirements to an installable token. */
export function normalizeRubyVersion(spec: string): string {
  const t = spec.trim().replace(/^v/, "");
  const lowerBound = t.match(/>=?\s*v?(\d+(?:\.\d+){0,2})/);
  if (lowerBound) return lowerBound[1];
  const concrete = t.match(/^(\d+(?:\.\d+){0,2})/);
  if (concrete) return concrete[1];
  return t;
}

/**
 * A concrete runtime version / toolchain token that is safe to interpolate
 * into a shell command. These values originate in *untrusted* cloned
 * manifests (.python-version, rust-toolchain, .tool-versions, …), so anything
 * outside this charset — shell metacharacters, whitespace, redirections — is
 * rejected before it can reach a login shell.
 *
 * Allowed: alphanumerics plus `. _ + - * /` (covers "3.12.4", "stable",
 * "nightly-2024-01-01", "lts/*", "stable-x86_64-apple-darwin").
 */
const SAFE_VERSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._+*/-]*$/;

export function isSafeVersionToken(v: string): boolean {
  return SAFE_VERSION_TOKEN.test(v);
}

/**
 * Scan a Detected-shaped object for any version/toolchain/sdk string field
 * whose value is not a safe token. Returns the first offender, or null.
 * Used as a security gate after detection, before any install runs.
 */
export function findUnsafeVersionField(
  obj: Record<string, unknown>,
): { field: string; value: string } | null {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string" || v === "") continue;
    if (!/(version|toolchain|sdk)$/i.test(k)) continue;
    if (!isSafeVersionToken(v)) return { field: k, value: v };
  }
  return null;
}
