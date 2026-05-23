/**
 * Detect existing runtime version managers before defaulting to nvm/pyenv.
 *
 * Goal: don't surprise-install nvm into a user's shell when they already use
 * mise/asdf/fnm/volta. Trust win. The probe is read-only — no shell mutations,
 * no network, no installs.
 */
import { execa } from "execa";

export type RuntimeManager = "mise" | "asdf" | "fnm" | "volta";

export interface AvailableManagers {
  mise: boolean;
  asdf: boolean;
  fnm: boolean;
  volta: boolean;
}

async function onPath(cmd: string): Promise<boolean> {
  try {
    const r = await execa("command", ["-v", cmd], { reject: false, timeout: 2000, shell: true });
    return r.exitCode === 0 && r.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function detectAvailable(): Promise<AvailableManagers> {
  const [mise, asdf, fnm, volta] = await Promise.all([
    onPath("mise"),
    onPath("asdf"),
    onPath("fnm"),
    onPath("volta"),
  ]);
  return { mise, asdf, fnm, volta };
}

/**
 * Pick the preferred manager for installing a Node version, in order of:
 * mise → asdf → fnm → volta. Returns null when none are available
 * (caller should fall back to nvm).
 */
export function pickNodeManager(av: AvailableManagers): RuntimeManager | null {
  if (av.mise) return "mise";
  if (av.asdf) return "asdf";
  if (av.fnm) return "fnm";
  if (av.volta) return "volta";
  return null;
}

/**
 * Pick the preferred manager for Python. mise + asdf both support Python;
 * fnm + volta are Node-only, so they don't qualify. Returns null → fall back
 * to pyenv.
 */
export function pickPythonManager(av: AvailableManagers): RuntimeManager | null {
  if (av.mise) return "mise";
  if (av.asdf) return "asdf";
  return null;
}

/**
 * Shell command to install a Node version via the chosen manager.
 * Each command is idempotent — re-running is safe.
 */
export function nodeInstallCommand(mgr: RuntimeManager, version: string): string {
  switch (mgr) {
    case "mise":
      return `mise install node@${version} && mise use --global node@${version}`;
    case "asdf":
      return `asdf plugin add nodejs || true && asdf install nodejs ${version} && asdf global nodejs ${version}`;
    case "fnm":
      return `fnm install ${version} && fnm use ${version}`;
    case "volta":
      return `volta install node@${version}`;
  }
}

export function pythonInstallCommand(mgr: RuntimeManager, version: string): string {
  switch (mgr) {
    case "mise":
      return `mise install python@${version} && mise use --global python@${version}`;
    case "asdf":
      return `asdf plugin add python || true && asdf install python ${version} && asdf global python ${version}`;
    default:
      throw new Error(`Python install not supported via ${mgr}`);
  }
}
