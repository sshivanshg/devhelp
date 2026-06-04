# Security policy

devhelp runs install scripts on your machine — `npm install`, `pip install`,
`cargo build`, the repo's `postInstall` hooks. That trust boundary is the same
as cloning a repo and running its setup yourself. devhelp does **not** add a
sandbox: it only constrains *which* commands run.

## What devhelp does to keep you safe

- **No network calls to AI providers.** Detection is deterministic; no telemetry.
- **Shell quoting.** Commands devhelp synthesises are shell-quoted so a repo
  can't smuggle metacharacters via version files or package names.
- **A repo's own `.devhelp.yml` always wins** over bundled recipes; bundled
  recipes carry the same trust as committed ones and only ship for well-known
  repos with stable, verifiable steps.
- **CI-mined commands are surfaced, never auto-run.** They only fill an empty
  `test`/`build` slot — they never override or chain.
- **`--with-services` and `--secrets` are opt-in.** Setup never starts Docker
  services or fetches secrets without an explicit flag, and Prisma uses
  `migrate deploy` (never destructive `migrate dev`).
- **Dry-run is real.** `--dry-run` makes no system mutations and uses a
  throwaway clone that's cleaned up in a `finally` path.

## Reporting a vulnerability

If you believe you've found a security issue, please **don't** open a public
GitHub issue. Email the maintainer or open a [GitHub Security
Advisory](https://github.com/sshivanshg/devhelp/security/advisories/new)
instead.

Please include:
- A clear description of the issue and impact.
- The minimum steps to reproduce.
- The devhelp version (`devhelp --version`) and OS.

You can expect an acknowledgement within a few days. There is no bounty
programme — this is a personal project.

## Supported versions

Only the latest minor release on npm is supported. Older versions won't
receive security fixes; upgrade before reporting.
