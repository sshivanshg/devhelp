/**
 * Deterministic recovery rules.
 *
 * When a critical step fails, we scan the captured stderr/stdout tail against
 * these patterns. A match produces a "Likely fix" hint surfaced in the
 * INCOMPLETE panel. These are conservative — only patterns with a single
 * obvious remediation belong here.
 */
import type { SystemDep } from "./platform.js";

export interface RecoveryRule {
  id: string;
  description: string;
  match: RegExp;
  remediation: string;
  /**
   * Logical system deps that fix this failure. When present and --fix is on,
   * devhelp installs them via the detected system package manager and retries
   * the failed step once. Absent → hint-only (no safe automatic fix).
   */
  systemDeps?: SystemDep[];
}

export interface RecoveryMatch {
  ruleId: string;
  remediation: string;
  systemDeps?: SystemDep[];
}

const isMac = () => process.platform === "darwin";
const isLinux = () => process.platform === "linux";

const RULES: RecoveryRule[] = [
  {
    id: "xcode-clt-missing",
    description: "macOS Xcode Command Line Tools missing",
    match: /xcrun: error: invalid active developer path|xcode-select.*command line tools|CommandLineTools.*not found/i,
    remediation: isMac()
      ? "Run: xcode-select --install   (then re-run devhelp)"
      : "Install build tools for your platform",
  },
  {
    id: "node-gyp-python",
    description: "node-gyp can't find Python",
    match: /gyp ERR! find Python|Could not find any Python installation to use|gyp.*python.*not found/i,
    remediation: isMac()
      ? "Run: brew install python   (node-gyp needs Python on PATH)"
      : isLinux()
        ? "Install Python 3: apt install python3 / dnf install python3 / pacman -S python"
        : "Install Python 3 and ensure it's on PATH",
    systemDeps: ["python3"],
  },
  {
    id: "openssl-headers-missing",
    description: "OpenSSL headers / pkg-config missing for native build",
    match: /openssl\/(ssl|opensslv|crypto)\.h.*(?:not found|No such file)|Package openssl was not found|pkg-config.*not found|pkg-config: command not found/i,
    remediation: isMac()
      ? "Run: brew install openssl pkg-config   (then re-run devhelp)"
      : isLinux()
        ? "Install: apt install libssl-dev pkg-config / dnf install openssl-devel pkgconf"
        : "Install OpenSSL development headers and pkg-config",
    systemDeps: ["openssl-dev", "pkg-config"],
  },
];

export function findRecovery(errorText: string): RecoveryMatch | null {
  if (!errorText) return null;
  for (const rule of RULES) {
    if (rule.match.test(errorText)) {
      return { ruleId: rule.id, remediation: rule.remediation, systemDeps: rule.systemDeps };
    }
  }
  return null;
}

export function listRules(): readonly RecoveryRule[] {
  return RULES;
}
