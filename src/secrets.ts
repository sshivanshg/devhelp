/**
 * Cloud secret bootstrapping.
 *
 * devhelp copies `.env.example` → `.env` but leaves the values as placeholders.
 * When a repo uses a secrets manager, we can populate them:
 *   - 1Password: a template full of `op://vault/item/field` references → `op inject`.
 *   - Doppler: a `doppler.yaml` / `.doppler.yaml` project config → `doppler secrets download`.
 *
 * Opt-in via --secrets, and it relies on the user already being signed in to the
 * provider CLI. Command-building is pure and unit-tested; the run is in setup.ts.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { shellQuote } from "./platform.js";

export interface SecretsProvider {
  name: "1Password" | "Doppler";
  cli: string; // binary that must be on PATH
  template?: string; // env template to inject from (1Password)
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect a secrets provider for this repo. 1Password wins when a template
 * contains `op://` references; otherwise Doppler if its config is present.
 */
export async function detectSecretsProvider(
  dir: string,
  envTemplates: string[],
): Promise<SecretsProvider | null> {
  for (const template of envTemplates) {
    const raw = await fs.readFile(path.join(dir, template), "utf8").catch(() => "");
    if (/\bop:\/\//.test(raw)) {
      return { name: "1Password", cli: "op", template };
    }
  }
  if ((await exists(path.join(dir, "doppler.yaml"))) || (await exists(path.join(dir, ".doppler.yaml")))) {
    return { name: "Doppler", cli: "doppler" };
  }
  return null;
}

/** Build the shell command that populates .env for the given provider. */
export function secretsCommand(provider: SecretsProvider): string {
  if (provider.name === "1Password") {
    // op inject resolves op:// refs from the template into a concrete .env.
    // The template path is repo-controlled, so quote it.
    return `op inject -i ${shellQuote(provider.template ?? ".env.example")} -o .env`;
  }
  // Doppler: download to a temp file, then atomically move it into place. Piping
  // straight to `.env` would truncate it the instant the shell opens the file,
  // so a failed/partial download would leave a corrupt .env; the temp-then-mv
  // dance keeps any existing .env intact unless the download fully succeeds.
  return `doppler secrets download --no-file --format env > .env.devhelp.tmp && mv .env.devhelp.tmp .env`;
}
