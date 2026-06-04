# devhelp — FAQ & Known Limitations

Honest answers to the questions a first-time user (or a skeptical launch-day reader) actually asks. If something here is wrong or missing, [open an issue](https://github.com/sshivanshg/devhelp/issues).

## What is devhelp, in one line?

It clones an OSS repo and gets you to a working dev environment — installs the right runtime, picks the package manager from the lockfile, runs install, copies env files, generates Prisma, etc. Deterministic: no LLM, no API keys, no telemetry. When it can't finish, it tells you exactly what's missing instead of failing silently.

## Is it safe to point at any repo?

**Treat it exactly like cloning the repo and running `npm install` / `make` yourself — because that's what it does.** Install/build scripts run the repo's own code; devhelp does not sandbox them. Only run it on repos you'd already trust. Use `--dry-run` to see every command first. (More in the README's [Security / trust model](../README.md#security--trust-model).)

## Which stacks actually work?

Two honest tiers:

- **Verified end-to-end:** Node, Python, Go — proven by real clone-and-install runs on macOS *and* Linux (including a clean machine with no version managers, and the Docker/Postgres/Prisma-migrate path). These are the paths to trust.
- **Detected & best-effort:** ~27 more ecosystems (Rust, Ruby, PHP, Java, Swift, …) are recognized and plan the right steps, guarded by detection fixtures — but most haven't been through a real install on a real repo yet. When one falls short it exits with an honest `INCOMPLETE`/`INFORM` panel and a fix, never a fake-green READY.

We'd rather under-promise here. If a "best-effort" stack works for you, great; if it doesn't, the run log makes it a one-click bug report.

## It looks frozen — is it hung?

Probably not. Three steps are legitimately slow and now say so up front:
- **Compiling Python from source** (pyenv, no prebuilt binary) — several minutes. This is normal.
- **Downloading a Node runtime** (nvm) — tens of seconds to a couple minutes.
- **Installing a large monorepo's dependencies** — a few minutes.

The last line of the tool's output streams live beneath the step, so you can see it's still working. If it truly hangs past ~10 minutes, the step times out and reports `timed out after 10m` with the failing command.

## It said INCOMPLETE / it didn't work. Now what?

Every run ends in one of four explicit states — never a fake green:
- **READY** — it worked.
- **INCOMPLETE** (exit 1) — a step failed; the panel shows *what* failed, *why*, and a concrete *fix*.
- **UNSUPPORTED** (exit 1) — the stack isn't recognized.
- **INFORM** — recognized, but auto-install isn't safe (C/C++, Nix, Terraform…).

Every run also writes a full JSON record to `~/.devhelp/runs/<timestamp>.json`. **Attach that file to a bug report** — it has the detected stack, every step, and the real failure output.

## Common failures and what they mean

| You see | Meaning | Fix |
|---|---|---|
| `repository couldn't be found or accessed` | Typo'd repo, or it's private | Check the name/URL; for private repos set up git auth (SSH/token) first |
| `Docker isn't running` | `--with-services` needs the daemon | Start Docker Desktop / `systemctl start docker`, then re-run |
| `Can't reach database server` (P1001) | DB service not up yet | `docker compose up -d` (or `--with-services`), wait for healthy, re-run |
| `npm ci` lockfile error | Repo's committed lockfile is out of sync | devhelp now falls back to `npm install` automatically and warns |
| `Out of disk space` (ENOSPC) | No room for runtime/deps | Free space (`docker system prune`, clear caches), re-run |
| pyenv build fails (missing headers) | System build deps absent | Install build deps (the panel names them), or `--fix` to auto-install on supported package managers |

## Does it need a GitHub token / does it rate-limit?

No token required. The only GitHub API call is an optional "is this repo archived?" courtesy check. If GitHub rate-limits it (or the network is unavailable), devhelp silently skips the check and proceeds — it never blocks setup.

## Windows?

Run under **WSL** (recommended) or **Git Bash**. Native Windows isn't supported yet — setup commands use bash syntax, and devhelp detects a missing bash-compatible shell and says so up front.

## How is this different from mise / asdf / volta?

Those manage runtime *versions*. devhelp does versions *and everything else* — install, env scaffolding, Prisma, Playwright, submodules, devcontainer commands, Docker surfacing, framework dev URLs. If you already have mise/asdf/volta/fnm, devhelp uses them. Full comparison: [`docs/WHY-NOT-MISE.md`](./WHY-NOT-MISE.md).

## How can I help?

- File issues with the run-log JSON attached — failure reports are the most valuable contribution.
- Maintainers: drop a [`.devhelp.yml`](../src/recipe.ts) in your repo to declare repo-specific setup steps (`postInstall`, `dev`/`test`/`build` overrides).
- PRs that add detectors (new ecosystem, new manifest, new recovery rule) are the best kind.
