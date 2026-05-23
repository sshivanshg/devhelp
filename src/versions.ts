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
