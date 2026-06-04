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

/**
 * The OS-specific one-line Docker install. Single-sourced so the recovery rule
 * and the proactive "services skipped — Docker missing" warning give identical
 * guidance.
 */
export function dockerInstallOneLiner(): string {
  return isMac()
    ? "brew install --cask docker  (or download Docker Desktop from docker.com)"
    : isLinux()
      ? "curl -fsSL https://get.docker.com | sh"
      : "install Docker Desktop from docker.com";
}

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
  {
    // A C/C++ toolchain is missing — the usual cause of node-gyp/native-module
    // builds failing on a fresh Linux box that has Node but no compiler.
    id: "build-tools-missing",
    description: "No C/C++ compiler toolchain (make / gcc) for a native build",
    match: /make: .*command not found|make: not found|\bg?cc1?(plus)?\b.*(?:not found|No such file)|\b(gcc|g\+\+|cc): .*(?:not found|No such file)|C compiler cannot create executables|no acceptable C compiler found|need to install the build-essential/i,
    remediation: isMac()
      ? "Run: xcode-select --install   (installs the compiler toolchain, then re-run devhelp)"
      : isLinux()
        ? "Install a compiler: apt install build-essential / dnf install gcc gcc-c++ make / pacman -S base-devel  — or re-run with --fix"
        : "Install a C/C++ build toolchain (make + a C compiler), then re-run",
    systemDeps: ["build-tools"],
  },

  // --- Execution-path failures (hint-only; no safe automatic fix) -----------
  // These cover the common reasons a real setup stalls. Each maps to one
  // obvious next action so the INCOMPLETE panel never dead-ends on "check the
  // log". Ordered most-specific first; findRecovery returns the first match.
  {
    // Distinct from docker-daemon-down: here Docker isn't installed at all, so
    // there's no daemon to start. The headline newcomer blocker — give the exact
    // one-line install, not just "install Docker".
    id: "docker-not-installed",
    description: "Docker isn't installed, so services can't start",
    match: /docker: (?:command )?not found|docker-compose: (?:command )?not found|(?:command not found|not found): docker|'docker' is not recognized|docker: The term/i,
    remediation: isMac()
      ? `Install Docker: ${dockerInstallOneLiner()}, open it, then re-run devhelp`
      : isLinux()
        ? `Install Docker: ${dockerInstallOneLiner()}  then \`sudo usermod -aG docker $USER\`, re-log in, then re-run devhelp`
        : `${dockerInstallOneLiner()}, start it, then re-run devhelp`,
  },
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
  {
    // Hit by any repo that pins a packageManager in package.json (yarn berry,
    // pnpm) when corepack isn't on yet. Common on fresh Node 18+ installs —
    // corepack ships with Node but is disabled by default, so the first install
    // dies with a confusing "this project is configured to use yarn …" or
    // "Internal Error: This project's package.json defines …" line.
    id: "corepack-disabled",
    description: "The packageManager pinned in package.json needs corepack enabled",
    match: /This project's package\.json defines "packageManager"|This project is configured to use (?:yarn|pnpm|bun), but it isn't installed|corepack: command not found|Usage Error: This project is configured to use|Cannot find module 'corepack'/i,
    remediation:
      "Enable corepack and let it shim the right package manager: corepack enable  (then re-run devhelp)",
  },
  {
    // PEP 668 — Debian/Ubuntu 23+, Fedora 38+, Arch, etc. Newer system Pythons
    // refuse `pip install` outside a venv with "error:
    // externally-managed-environment". The fix devhelp already does for
    // pyproject/requirements paths is to run inside .venv, so this is mostly hit
    // when a repo's own postInstall or CI command pip-installs at the system
    // level.
    id: "python-externally-managed",
    description: "This Python is externally managed — pip refuses to install at the system level",
    match: /error: externally-managed-environment|This environment is externally managed/i,
    remediation:
      "Install into a venv instead: python3 -m venv .venv && . .venv/bin/activate && pip install …  (or use pipx for app tools)",
  },
  {
    // React Native / Expo iOS builds need CocoaPods. `pod: command not found`
    // on macOS is a fresh-Mac newcomer hit; the install is `brew install
    // cocoapods` (the gem path is brittle on Apple Silicon Ruby).
    id: "cocoapods-not-installed",
    description: "CocoaPods isn't installed, so iOS deps can't be fetched",
    match: /^pod: (?:command )?not found|pod: command not found|'pod' is not recognized/im,
    remediation: isMac()
      ? "Install CocoaPods: brew install cocoapods, then re-run"
      : "CocoaPods is only used for iOS builds — switch to a Mac, or skip the iOS step",
  },
  {
    // `git: command not found` from the clone step is its own class — the user
    // doesn't even have git, the generic command-not-found rule's "try brew
    // install <name>" hint is fine but a tailored one names the package.
    id: "git-not-installed",
    description: "git isn't installed, so devhelp can't clone the repo",
    match: /^git: (?:command )?not found|git: command not found|'git' is not recognized/im,
    remediation: isMac()
      ? "Install git: xcode-select --install  (or brew install git), then re-run"
      : isLinux()
        ? "Install git: apt install git / dnf install git / pacman -S git, then re-run"
        : "Install git from git-scm.com, then re-run",
  },
  {
    // Building large Next.js / Storybook / Vite monorepos commonly blows past
    // v8's default heap and dies with "FATAL ERROR: Reached heap limit
    // Allocation failed" or "JavaScript heap out of memory". The fix is a
    // NODE_OPTIONS bump, not a re-run.
    id: "node-oom",
    description: "Node ran out of heap memory during the build",
    match: /FATAL ERROR:.*Reached heap limit.*Allocation failed|JavaScript heap out of memory|ineffective mark-compacts near heap limit/i,
    remediation:
      "Raise the v8 heap and re-run the failed step: NODE_OPTIONS=--max-old-space-size=8192 <cmd>  (8GB; lower to 4096 if you have less RAM)",
  },
  {
    // Generic safety net for any "<tool>: command not found" we don't have a
    // tailored rule for. Ordered LAST so specific rules (docker, build tools,
    // pkg-config, repo-not-found) always win. The panel already prints the cause
    // line, which names the missing tool — so the fix can point at it.
    id: "command-not-found",
    description: "A required command isn't installed",
    match: /\S+: (?:command )?not found|is not recognized as an internal or external command/i,
    remediation: isMac()
      ? "Install the missing command shown above (try: brew install <name>), then re-run devhelp"
      : isLinux()
        ? "Install the missing command shown above with your package manager (apt install / dnf install / pacman -S <name>), then re-run devhelp"
        : "Install the missing command shown above, ensure it's on your PATH, then re-run devhelp",
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
