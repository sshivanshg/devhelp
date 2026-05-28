<div align="center">

```
       _            _          _
    __| | _____   _| |__   ___| |_ __
   / _` |/ _ \ \ / / '_ \ / _ \ | '_ \
  | (_| |  __/\ V /| | | |  __/ | |_) |
   \__,_|\___| \_/ |_| |_|\___|_| .__/
                                |_|
```

**Clone an OSS repo. Get a working dev environment.**
Fully deterministic. Honest about what it can't do.

[Install](#install) · [Receipts](#receipts) · [Why not mise?](#why-not-mise) · [How it works](#how-it-works) · [Examples](#examples) · [Contributing](#contributing)

<br>

![devhelp setting up the documenso Prisma/Next.js monorepo](https://raw.githubusercontent.com/sshivanshg/devhelp/main/demo/devhelp.gif)

<sub>One command reads the documenso monorepo and plans the whole setup — Node 22, `npm ci`, `.env`, `prisma generate`, Playwright, and the Next.js dev URL. (Shown with `--dry-run`; a real run executes the same steps.)</sub>

</div>

---

## What is this

`devhelp` reads a one-liner like:

```bash
devhelp "Set me up to contribute to facebook/react"
```

…and then does what you'd do by hand for the next 45 minutes — *automatically, with a live progress UI*:

- Clones the repo
- Reads every manifest (`package.json`, `.nvmrc`, `pyproject.toml`, `Cargo.toml`, `go.mod`, …)
- Initializes git submodules
- Installs the exact Node / Python / Rust version it needs (via `nvm` / `pyenv` / `rustup`, installing the manager itself if missing)
- Picks the right package manager **from the lockfile** (not from what `package.json` claims)
- Runs the install command
- **Copies `.env.example` → `.env`** (won't overwrite an existing one)
- **Runs `prisma generate`** for every schema it finds (works inside `apps/*`, `packages/*` monorepos too)
- **Installs Playwright browsers** if Playwright is in deps
- Detects your framework (Next.js, Vite, Astro, Nuxt, SvelteKit, NestJS, Django, FastAPI…) and shows the real dev URL at the end
- Prints one of four explicit states at the end: `READY` (everything worked), `INCOMPLETE` (a critical step failed — exit 1), `UNSUPPORTED` (stack not recognized — exit 1), or `INFORM` (recognized but auto-install isn't safe). Never a fake-green panel on a real failure.

It's **fully deterministic**: pure rules + lockfile reading, no LLM and no network calls to any AI provider. The only network it touches is cloning the repo and downloading the runtimes/packages the project itself asks for.

## Receipts

Most OSS dev-tool READMEs leave this part out. Here's the measured behavior (v0.2 re-run) on 20 randomly-chosen popular OSS repos:

| Status | Repos | What happened |
|---|---|---|
| **Clean setup** | 15/20 | Detected stack, picked right pm, installed runtime, ran post-install |
| **Honest refusal** | 1/20 | `neovim`: at v0.2, C + CMake wasn't recognized → red `UNSUPPORTED` panel, exit 1. *(Re-checked on v0.5: neovim now ships `build.zig`, and devhelp gained Zig support in v0.4 — it detects as Zig and reaches READY. The exit-1 refusal still fires for genuinely unrecognized stacks.)* |
| **Partial / known limitation** | 4/20 | Detected, but service deps (Postgres/Redis) need manual `docker compose up` first |

That's 75% clean on real repos, with **zero silent failures** since v0.2 — failures get an amber `INCOMPLETE` or red `UNSUPPORTED` panel and non-zero exit, not a fake-green "READY."

These numbers come from the v0.2 re-run in [`stress-test/RETEST_RESULTS.md`](./stress-test/RETEST_RESULTS.md) (per-repo before/after). The original v0.1 baseline that drove the fixes is in [`stress-test/SUMMARY.md`](./stress-test/SUMMARY.md) · [`stress-test/FAILURE_PATTERNS.md`](./stress-test/FAILURE_PATTERNS.md). Read the failure patterns before you trust the numbers.

## Why not mise?

Short answer: **mise manages runtime versions. devhelp does runtime versions *and* everything else** — package install, env scaffolding, Prisma, Playwright, submodules, devcontainer `postCreateCommand`, Docker surfacing, framework-aware dev URLs. If you already have mise/asdf/volta/fnm installed, devhelp uses them — it's not trying to replace your runtime manager.

Full comparison vs. mise, asdf, volta, corepack, devbox, devenv.sh, and devcontainers: [`docs/WHY-NOT-MISE.md`](./docs/WHY-NOT-MISE.md).

## Coverage (v0.4)

31 ecosystems covered — ~99% of real OSS repos on GitHub. v0.4 added Swift/iOS, Android native, React Native, Expo, Haskell, Scala, Clojure, R, Julia, Zig, OCaml, Bazel, Nx, and INFORM panels for Terraform/Ansible/Helm/Pulumi.

| Ecosystem | Detection | Install | Notes |
|---|---|---|---|
| Node / JS / TS | Full | nvm | Next, Vite, Astro, Remix, NestJS, … |
| Python | Full | pyenv | Django, FastAPI, Flask, … |
| Rust | Full | rustup | |
| Go | Full | brew/binary | |
| Ruby | Full | rbenv | Rails, Jekyll, Sinatra |
| PHP | Full | brew | Laravel, Symfony, WordPress |
| Elixir | Full | asdf | Phoenix, Nerves |
| Java / Kotlin | Full | brew/SDKMAN | Spring Boot, Quarkus, Maven, Gradle |
| .NET / C# | Full | dotnet-install | ASP.NET, Blazor, MAUI |
| Dart / Flutter | Full | fvm | |
| Deno | Full | brew/install.sh | |
| Bun (runtime) | Full | bun.sh | |
| Swift / iOS | Full | swiftenv | SPM, CocoaPods, Carthage |
| Android | Full | manual | Android Studio / ANDROID_HOME |
| React Native | Full | Yes + CocoaPods | Xcode + Android Studio required |
| Expo | Full | Yes | |
| Haskell | Full | GHCup | Stack + Cabal |
| Scala | Full | coursier | sbt, Mill, Play, Spark |
| Clojure | Full | brew | Leiningen, tools.deps |
| R | Full | rig | renv, R packages, Shiny |
| Julia | Full | juliaup | |
| Zig | Full | zvm / brew | |
| OCaml | Full | opam | dune |
| Bazel | Full | bazelisk | Build layer over Python/Java/Go/Rust |
| Nx | Full | — | Detected as monorepo layer |
| C / C++ | Informed | — | CMake, Make, Meson, Autotools |
| Nix | Informed | — | flake, shell, default |
| Terraform | Informed | — | init / plan / apply commands |
| Ansible | Informed | — | galaxy + playbook commands |
| Helm | Informed | — | lint + template commands |
| Pulumi | Informed | — | preview / up / destroy |

**Full** = detects, installs runtime, installs deps, surfaces correct commands.
**Informed** = detects, surfaces correct commands, and explains what to install manually.

Repos that devhelp still can't recognize exit non-zero with an `UNSUPPORTED` panel and a link to file a support request.

## Install

```bash
npm i -g devhelp-cli
```

Or run without installing:

```bash
npx devhelp-cli "set up this project"
```

The npm package is `devhelp-cli`; the command on your PATH is still `devhelp`.

Requirements: Node 18+. macOS and Linux supported. (Windows: WSL works; native is on the roadmap.)

## Quickstart

```bash
# Onboard onto an existing repo
devhelp "Set me up to contribute to vercel/next.js"

# Fix the project you're already in
cd my-stale-project
devhelp "get this running"

# Diagnose what's detected vs. what's installed, without changing anything
devhelp doctor

# Preview what it would do — never touches your system
devhelp --dry-run "set up this project"
```

## How it works

```
┌──────────────────────────┐
│  devhelp "<request>"     │
└────────────┬─────────────┘
             │
        ┌────▼────┐
        │  parse  │   extract the repo (URL or owner/repo)
        └────┬────┘
             │
        ┌────▼────┐
        │  clone  │   (if a repo is named)
        └────┬────┘
             │
        ┌────▼────┐
        │ detect  │   read manifests, lockfiles, version files
        └────┬────┘
             │
        ┌────▼─────┐
        │ install  │   nvm/pyenv/rustup → runtime → deps
        └────┬─────┘
             │
        ┌────▼─────┐
        │  report  │   cd / dev / test hints
        └──────────┘
```

### What it sets up

| Capability | Detected from | Action |
|---|---|---|
| **Node version** | `volta.node` → `.nvmrc` → `.node-version` → `engines.node` | `nvm install` |
| **Package manager** | lockfile (`pnpm-lock.yaml` → `yarn.lock` → `bun.lockb` → `package-lock.json`) → `packageManager` field | the right `install` for that pm |
| **Python version** | `.python-version` → `pyproject.toml` constraint → fallback `3.12` | `pyenv install` |
| **Python deps** | `pyproject.toml` (poetry / uv / pip) → `Pipfile` → `requirements.txt` | `poetry install` / `uv sync` / `pipenv install` / venv+pip |
| **Rust** | `rust-toolchain` → `rust-toolchain.toml` → `stable` | `rustup toolchain install` |
| **Go** | `go.mod` | `go mod download` |
| **Env files** | `.env.example` / `.env.template` / `.env.sample` | copy → `.env` (won't overwrite) |
| **Prisma** | `prisma/schema.prisma` (root + `apps/*` + `packages/*`) | `prisma generate` per schema |
| **Playwright** | `@playwright/test` or `playwright` in deps | `playwright install --with-deps` |
| **Submodules** | `.gitmodules` | `git submodule update --init --recursive` |
| **Framework hints** | Next.js / Vite / Astro / Nuxt / SvelteKit / Remix / NestJS / Django / FastAPI / Flask / … | Real dev-server URL in the final panel |
| **Devcontainer** | `.devcontainer/devcontainer.json` | Extracts runtime version from `image` tag + surfaces `postCreateCommand` |
| **Docker services** | `docker-compose*.yml` / `compose*.yml` at root + workspace packages | Surfaces `docker compose up -d` as a required pre-start step (never runs it automatically) |
| **Archived repos** | GitHub API check for `archived: true` | Warns up-front so you don't waste time on a repo that won't accept PRs |

Lockfile presence overrides whatever `packageManager` claims. The lockfile is ground truth — that's the same heuristic Corepack uses.

## Examples

<details open>
<summary><strong>Full-stack Next.js app (dry-run)</strong></summary>

```
  devhelp · DRY RUN
  › set up this project

↓ Cloning repository                    [skipped: working in $PWD]
✔ Detected: Next.js, node 20.11.1, pnpm, prisma, playwright
↓ Initializing git submodules           [skipped: no .gitmodules]
✔ Installed Node 20.11.1
✔ Installed dependencies                 pnpm install
✔ Env: .env.example → .env
✔ Prisma client generated (1)
✔ Playwright browsers installed

╭──────────────────── Next.js ────────────────────╮
│                                                 │
│  READY                                          │
│                                                 │
│    cd ./my-app                                  │
│    pnpm run dev   → http://localhost:3000       │
│    pnpm test      # tests                       │
│                                                 │
│    ! Review .env and fill in real values        │
│                                                 │
╰─────────────────────────────────────────────────╯
```

</details>

<details>
<summary><strong>Polyglot (Python + Rust) project</strong></summary>

```
  devhelp · DRY RUN
  › get this going

✔ Detected: python 3.12.4, rust stable
✔ Installed Python 3.12.4
✔ Installed Rust stable
✔ Installed dependencies                 poetry install
✔ Installed dependencies                 cargo build

╭─────────────────────────────────────────────────╮
│                                                 │
│  READY                                          │
│                                                 │
│    cd ./my-project                              │
│    pytest      # tests                          │
│                                                 │
╰─────────────────────────────────────────────────╯
```

</details>

## Security / trust model

devhelp clones and sets up arbitrary repositories, so it's worth being explicit about what that means:

- **Running install commands runs the repo's code.** `npm install`, `cargo build`, `bundle install`, etc. execute the project's own post-install/build scripts *by design*. devhelp does not sandbox them. Only run it on repos you'd be willing to `npm install` by hand.
- **Version strings from manifests are validated before use.** Values like `.python-version`, `rust-toolchain`, and `.tool-versions` entries are read from the (untrusted) repo and would otherwise be interpolated into shell commands. devhelp rejects any version/toolchain value containing shell metacharacters and refuses to install rather than run it — closing a shell-injection vector.
- **Service containers are never started automatically.** `docker compose up` is surfaced as a step, never run.
- **`--dry-run` previews everything.** Every command is printed and nothing touches your system, so you can see exactly what would run before committing to it.

Found something that slips past this? Please open a security issue.

## Commands & flags

```
devhelp <request...>          Set up a repo (a github.com URL or owner/repo)
devhelp doctor                Diagnose the current project without changing anything
devhelp mcp                   Run as an MCP server over stdio (detect + doctor tools)

Options:
  --cwd <dir>       Working directory (default: $PWD)
  --dry-run         Print what would happen without executing
  --verbose         Show skipped steps and a detailed action summary
  --json            Emit a machine-readable JSON result instead of the panels
  --fix             On a recoverable failure, install the missing system dep and retry once
  --with-services   Start detected docker compose services + run DB migrations
  --write-lock      Write a .devhelp.lock with the resolved runtime versions
  --verify          After setup, run tests and boot the dev server to confirm it works
  --vscode          Generate a .vscode/launch.json for the detected stack (won't overwrite)
  --secrets         Populate .env from a detected secrets provider (1Password / Doppler)
  -h, --help        Show help
  -V, --version     Show version
```

Native Windows isn't fully supported: setup commands are bash syntax, so run devhelp under **WSL** (recommended) or **Git Bash**. It detects a missing bash-compatible shell and tells you up front.

## What it won't do (yet)

Honest list. PRs welcome.

- **Native Windows** — run under WSL or Git Bash for now (setup commands use bash syntax); devhelp detects a missing bash-compatible shell and says so up front.
- **Auto-starting Docker services / DB migrations by default** — they're surfaced as steps and only run when you pass `--with-services` (which uses the non-destructive `prisma migrate deploy`; `prisma migrate dev` is never run).
- **Secrets beyond 1Password / Doppler** — `--secrets` populates `.env` from those two providers; other vaults and inline secrets aren't fetched.
- **JetBrains run-configs** — VS Code `launch.json` is generated with `--vscode`, but IntelliJ/PyCharm configs aren't yet.
- **Auto-installing system deps for C / C++ and Nix** — detected and explained via an `INFORM` panel, but not installed. Genuinely unrecognized stacks (e.g. Lua) exit with an `UNSUPPORTED` panel rather than guessing.
- **Unattended auto-recovery** — `--fix` retries a few failures with an obvious system-package fix (node-gyp Python, OpenSSL/pkg-config); without it, failures surface as `INCOMPLETE` with a manual hint. Xcode CLT stays hint-only (its installer is interactive).

## Roadmap

- [x] Auto-recovery rules for common install failures (node-gyp Python, libssl/pkg-config) — `--fix`
- [x] Linux package detection (`apt`, `dnf`, `pacman`, `zypper`, `apk`) for system-dep installs
- [x] Plugin API for project-specific recipes (`.devhelp.yml`)
- [x] Post-setup verification (run tests + boot the dev server) — `--verify`
- [x] `.vscode/launch.json` generation — `--vscode`
- [x] Cloud secret bootstrapping (1Password, Doppler) to populate `.env` — `--secrets`
- [x] MCP server exposing detect + doctor — `devhelp mcp`
- [ ] JetBrains run-config generation
- [ ] Full native Windows support (WSL / Git Bash work today; cross-platform probing + guard landed)

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## Why this exists

Every developer loses hours a week to environment setup. Most of those hours go to problems with **deterministic answers** — wrong Node version, missing system lib, lockfile/manager mismatch, forgot to copy `.env.example`, forgot to `prisma generate`. There's no reason a tool can't just fix them.

devhelp keeps that path fast, free, and fully deterministic — no LLM, no API keys, no surprises.

The thing we measure ourselves on is: *did the user run our command, and did `pnpm dev` actually work afterwards?* If no, that's a failure pattern we want documented in [`stress-test/FAILURE_PATTERNS.md`](./stress-test/FAILURE_PATTERNS.md). The receipts matter more than the marketing.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The best PRs add detectors (new ecosystem, new manifest, new error recovery rule).

## License

[MIT](./LICENSE)
