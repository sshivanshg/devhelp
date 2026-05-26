/**
 * System package-manager detection.
 *
 * devhelp installs language runtimes via nvm/pyenv/etc., but native builds
 * often fail on a missing *system* library (libssl-dev, pkg-config). To turn
 * those failures into concrete fixes (see recovery.ts), we need to know which
 * OS package manager is on this machine. The probe is read-only — no installs.
 */
import { execa } from "execa";

export type SystemPkgManager =
  | "apt"
  | "dnf"
  | "yum"
  | "pacman"
  | "zypper"
  | "apk"
  | "brew";

// Probe order matters: prefer the modern manager when several coexist
// (dnf over yum on Fedora; apt is canonical on Debian/Ubuntu).
const PROBE_ORDER: { mgr: SystemPkgManager; bin: string }[] = [
  { mgr: "apt", bin: "apt-get" },
  { mgr: "dnf", bin: "dnf" },
  { mgr: "yum", bin: "yum" },
  { mgr: "pacman", bin: "pacman" },
  { mgr: "zypper", bin: "zypper" },
  { mgr: "apk", bin: "apk" },
  { mgr: "brew", bin: "brew" },
];

async function onPath(cmd: string): Promise<boolean> {
  try {
    const r = await execa("command", ["-v", cmd], { reject: false, timeout: 2000, shell: true });
    return r.exitCode === 0 && r.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * How to check whether a command exists, per platform. Windows has no
 * `command -v`/`which` builtin reachable the same way — use `where`.
 * Pure so it can be unit-tested without spawning anything.
 */
export function commandExistsProbe(
  cmd: string,
  platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[]; shell: boolean } {
  return platform === "win32"
    ? { cmd: "where", args: [cmd], shell: false }
    : { cmd: "command", args: ["-v", cmd], shell: true };
}

/**
 * Pick the shell to run setup commands through. devhelp's commands are POSIX
 * sh/bash syntax (`&&`, `export`, `. .venv/bin/activate`), so on Windows we need
 * a bash-compatible shell (WSL — which reports as linux — or git-bash, which
 * sets SHELL). Returns the shell binary, or null if native Windows has none.
 */
export function pickShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.SHELL) return env.SHELL;
  if (platform === "win32") return null; // cmd/PowerShell can't run our bash syntax
  return "/bin/bash";
}

export const WINDOWS_SHELL_HELP =
  "Native Windows isn't fully supported yet: devhelp's install commands need a " +
  "bash-compatible shell. Run it under WSL (recommended) or Git Bash.";

/** Returns the system package manager on this machine, or null if none found. */
export async function detectSystemPackageManager(): Promise<SystemPkgManager | null> {
  // On macOS, brew is the only one devhelp drives. Don't probe Linux managers.
  if (process.platform === "darwin") {
    return (await onPath("brew")) ? "brew" : null;
  }
  for (const { mgr, bin } of PROBE_ORDER) {
    if (await onPath(bin)) return mgr;
  }
  return null;
}

/**
 * Logical system dependencies devhelp knows how to map to OS package names.
 * Keep this list small — only deps that show up in real native-build failures.
 */
export type SystemDep = "openssl-dev" | "pkg-config" | "python3" | "build-tools";

// Package names per manager for each logical dep. A null entry means "this
// manager ships it by default / not separately packaged" → skip it.
const PACKAGES: Record<SystemDep, Partial<Record<SystemPkgManager, string>>> = {
  "openssl-dev": {
    apt: "libssl-dev",
    dnf: "openssl-devel",
    yum: "openssl-devel",
    pacman: "openssl",
    zypper: "libopenssl-devel",
    apk: "openssl-dev",
    brew: "openssl",
  },
  "pkg-config": {
    apt: "pkg-config",
    dnf: "pkgconf-pkg-config",
    yum: "pkgconfig",
    pacman: "pkgconf",
    zypper: "pkg-config",
    apk: "pkgconf",
    brew: "pkg-config",
  },
  python3: {
    apt: "python3",
    dnf: "python3",
    yum: "python3",
    pacman: "python",
    zypper: "python3",
    apk: "python3",
    brew: "python",
  },
  "build-tools": {
    apt: "build-essential",
    dnf: "gcc gcc-c++ make",
    yum: "gcc gcc-c++ make",
    pacman: "base-devel",
    zypper: "gcc gcc-c++ make",
    apk: "build-base",
    brew: "", // Xcode CLT, handled separately
  },
};

/**
 * Build the shell command to install the given logical deps with this manager.
 * Returns null if none of the deps are packaged for this manager. Linux managers
 * get `sudo` and a non-interactive yes flag.
 */
export function systemInstallCommand(
  mgr: SystemPkgManager,
  deps: SystemDep[],
): string | null {
  const pkgs = deps
    .map((d) => PACKAGES[d]?.[mgr])
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  if (pkgs.length === 0) return null;
  const list = [...new Set(pkgs.join(" ").split(" "))].join(" ");

  switch (mgr) {
    case "apt":
      return `sudo apt-get update && sudo apt-get install -y ${list}`;
    case "dnf":
      return `sudo dnf install -y ${list}`;
    case "yum":
      return `sudo yum install -y ${list}`;
    case "pacman":
      return `sudo pacman -S --noconfirm ${list}`;
    case "zypper":
      return `sudo zypper install -y ${list}`;
    case "apk":
      return `sudo apk add ${list}`;
    case "brew":
      return `brew install ${list}`;
  }
}
