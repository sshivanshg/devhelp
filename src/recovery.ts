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
  /** Human, one-line statement of what went wrong (the rule's `description`). */
  cause: string;
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

  // --- Execution-path failures (hint-only; no safe automatic fix) -----------
  // These cover the common reasons a real setup stalls. Each maps to one
  // obvious next action so the INCOMPLETE panel never dead-ends on "check the
  // log". Ordered most-specific first; findRecovery returns the first match.
  {
    id: "docker-daemon-down",
    description: "Docker isn't running, so services couldn't start",
    match: /Cannot connect to the Docker daemon|Is the docker daemon running|docker daemon is not running|error during connect.*docker/i,
    remediation: isMac()
      ? "Start Docker Desktop (open -a Docker), wait for it, then re-run devhelp"
      : "Start Docker (sudo systemctl start docker), then re-run devhelp",
  },
  {
    id: "db-unreachable",
    description: "The database server isn't reachable yet",
    match: /Can't reach database server|P1001|database server at .* (?:is not reachable|refused)|ECONNREFUSED.*(?:5432|3306|6379|27017)|could not connect to server.*(?:5432|3306)/i,
    remediation:
      "Start the DB service first (docker compose up -d, or pass --with-services), confirm it's healthy, then re-run",
  },
  {
    id: "prisma-schema-missing",
    description: "Prisma couldn't locate the schema file",
    match: /Could not load `--schema`|Could not find a schema\.prisma|Could not load schema from|provided path .* (?:file or directory not found|does not exist)/i,
    remediation:
      'Check the schema path in package.json ("prisma": { "schema": ... }), or pass --schema with an absolute path',
  },
  {
    id: "env-var-conflict",
    description: "Conflicting env vars across .env files",
    match: /conflict between env vars in .* and|There is a conflict between/i,
    remediation: "Reconcile the duplicate keys between the conflicting .env files, then re-run",
  },
  {
    id: "port-in-use",
    description: "A required port is already in use",
    match: /EADDRINUSE|address already in use|port is already allocated|bind: address already in use/i,
    remediation: "Free the port (lsof -i :<port> then kill the process) or change it, then re-run",
  },
  {
    id: "disk-full",
    description: "Out of disk space",
    match: /ENOSPC|no space left on device|not enough space/i,
    remediation: "Free up disk space (e.g. docker system prune, clear caches), then re-run",
  },
  {
    // Ordered before network-unreachable: a not-found/auth clone failure is a
    // bad URL or private repo, not a flaky connection — different fix, and we
    // must not waste the automatic clone-retry on it.
    id: "repo-not-found",
    description: "The repository couldn't be found or accessed",
    match: /Repository not found|repository '.*' not found|fatal: could not read Username|Authentication failed|Permission denied \(publickey\)|terminal prompts disabled|remote: (?:Not Found|Invalid username or password)/i,
    remediation:
      "Check the repo name/URL is correct and public — for a private repo, set up git auth (SSH key or token) first, then re-run",
  },
  {
    id: "network-unreachable",
    description: "Couldn't reach the network (clone or registry)",
    match: /fetch-pack|early EOF|RPC failed|curl \d+|index-pack|Connection reset by peer|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|getaddrinfo|Could not resolve host|network timeout|ECONNRESET/i,
    remediation: "Check your connection/proxy and re-run — clones are shallow, so a retry is cheap",
  },
  {
    id: "registry-auth",
    description: "The package registry rejected the request",
    match: /\b(401 Unauthorized|403 Forbidden)\b|code E401|code E403|authentication required|need auth/i,
    remediation: "Check your registry auth (npm whoami) or .npmrc token, then re-run",
  },
];

export function findRecovery(errorText: string): RecoveryMatch | null {
  if (!errorText) return null;
  for (const rule of RULES) {
    if (rule.match.test(errorText)) {
      return {
        ruleId: rule.id,
        cause: rule.description,
        remediation: rule.remediation,
        systemDeps: rule.systemDeps,
      };
    }
  }
  return null;
}

export function listRules(): readonly RecoveryRule[] {
  return RULES;
}
