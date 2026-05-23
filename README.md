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
Deterministic by default. Honest about what it can't do.

[Install](#install) · [Receipts](#receipts) · [Why not mise?](#why-not-mise) · [How it works](#how-it-works) · [Examples](#examples) · [Contributing](#contributing)

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

It works in **two modes**:

| Mode | When | Needs |
|---|---|---|
| **Offline** (default if no key) | Deterministic playbook | Nothing |
| **AI-assisted** | When `ANTHROPIC_API_KEY` is set | An Anthropic API key |

Offline mode handles the boring 80% with no network calls to any AI provider — pure rules + lockfile reading. AI mode is opt-in for repos with non-standard build scripts. See [Honest about the AI mode](#honest-about-the-ai-mode) for what it actually does and doesn't.

## Receipts

Most OSS dev-tool READMEs leave this part out. Here's the measured behavior on 20 randomly-chosen popular OSS repos:

| Status | Repos | What happened |
|---|---|---|
| **Clean setup** | 15/20 | Detected stack, picked right pm, installed runtime, ran post-install |
| **Honest refusal** | 1/20 | `neovim` (C + CMake): `UNSUPPORTED` panel, exit 1 |
| **Partial / known limitation** | 4/20 | Detected, but service deps (Postgres/Redis) need manual `docker compose up` first |

That's 75% clean on real repos, with **zero silent failures** since v0.2 — failures get an amber `INCOMPLETE` or red `UNSUPPORTED` panel and non-zero exit, not a fake-green "READY."

Full breakdown: [`stress-test/SUMMARY.md`](./stress-test/SUMMARY.md) · [`stress-test/FAILURE_PATTERNS.md`](./stress-test/FAILURE_PATTERNS.md). Read the failure patterns before you trust the numbers.

## Why not mise?

Short answer: **mise manages runtime versions. devhelp does runtime versions *and* everything else** — package install, env scaffolding, Prisma, Playwright, submodules, devcontainer `postCreateCommand`, Docker surfacing, framework-aware dev URLs. If you already have mise/asdf/volta/fnm installed, devhelp uses them — it's not trying to replace your runtime manager.

Full comparison vs. mise, asdf, volta, corepack, devbox, devenv.sh, and devcontainers: [`docs/WHY-NOT-MISE.md`](./docs/WHY-NOT-MISE.md).

## Coverage (v0.4)

29 ecosystems covered — ~99% of real OSS repos on GitHub. v0.4 added Swift/iOS, Android native, React Native, Expo, Haskell, Scala, Clojure, R, Julia, Zig, OCaml, Bazel, Nx, and INFORM panels for Terraform/Ansible/Helm/Pulumi.

| Ecosystem | Detection | Install | Notes |
|---|---|---|---|
| Node / JS / TS | ✅ Full | ✅ nvm | Next, Vite, Astro, Remix, NestJS, … |
| Python | ✅ Full | ✅ pyenv | Django, FastAPI, Flask, … |
| Rust | ✅ Full | ✅ rustup | |
| Go | ✅ Full | ✅ brew/binary | |
| Ruby | ✅ Full | ✅ rbenv | Rails, Jekyll, Sinatra |
| PHP | ✅ Full | ✅ brew | Laravel, Symfony, WordPress |
| Elixir | ✅ Full | ✅ asdf | Phoenix, Nerves |
| Java / Kotlin | ✅ Full | ✅ brew/SDKMAN | Spring Boot, Quarkus, Maven, Gradle |
| .NET / C# | ✅ Full | ✅ dotnet-install | ASP.NET, Blazor, MAUI |
| Dart / Flutter | ✅ Full | ✅ fvm | |
| Deno | ✅ Full | ✅ brew/install.sh | |
| Bun (runtime) | ✅ Full | ✅ bun.sh | |
| Swift / iOS | ✅ Full | ✅ swiftenv | SPM, CocoaPods, Carthage |
| Android | ✅ Full | ℹ️ SDK manual | Android Studio / ANDROID_HOME |
| React Native | ✅ Full | ✅ + CocoaPods | Xcode + Android Studio required |
| Expo | ✅ Full | ✅ | |
| Haskell | ✅ Full | ✅ GHCup | Stack + Cabal |
| Scala | ✅ Full | ✅ coursier | sbt, Mill, Play, Spark |
| Clojure | ✅ Full | ✅ brew | Leiningen, tools.deps |
| R | ✅ Full | ✅ rig | renv, R packages, Shiny |
| Julia | ✅ Full | ✅ juliaup | |
| Zig | ✅ Full | ✅ zvm / brew | |
| OCaml | ✅ Full | ✅ opam | dune |
| Bazel | ✅ Full | ✅ bazelisk | Build layer over Python/Java/Go/Rust |
| Nx | ✅ Full | — | Detected as monorepo layer |
| C / C++ | ℹ️ Informed | — | CMake, Make, Meson, Autotools |
| Nix | ℹ️ Informed | — | flake, shell, default |
| Terraform | ℹ️ Informed | — | init / plan / apply commands |
| Ansible | ℹ️ Informed | — | galaxy + playbook commands |
| Helm | ℹ️ Informed | — | lint + template commands |
| Pulumi | ℹ️ Informed | — | preview / up / destroy |

**✅ Full** = detects, installs runtime, installs deps, surfaces correct commands.
**ℹ️ Informed** = detects, surfaces correct commands, and explains what to install manually.

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

# Preview what it would do — never touches your system
devhelp --dry-run "set up this project"

# Force pure-offline (no LLM, no API calls to AI providers)
devhelp --offline "set up this project"

# Opt into AI-assisted mode (experimental — see "Honest about the AI mode")
export ANTHROPIC_API_KEY=sk-...
devhelp --dry-run "set me up for this monorepo"
```

## How it works

```
┌──────────────────────────┐
│  devhelp "<request>"     │
└────────────┬─────────────┘
             │
        ┌────▼────┐
        │  parse  │   extract repo name, detect intent
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
   ┌─────────┴──────────┐
   │                    │
┌──▼───┐            ┌───▼───┐
│ rule │            │  AI   │   (only when key is set
│ path │            │ path  │    and offline isn't forced)
└──┬───┘            └───┬───┘
   │                    │
   └─────────┬──────────┘
             │
        ┌────▼─────┐
        │ install  │   nvm/pyenv/rustup → runtime → deps
        └────┬─────┘
             │
        ┌────▼─────┐
        │  report  │   cd / dev / test hints
        └──────────┘
```

### What it sets up (offline mode)

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
<summary><strong>Full-stack Next.js app (offline, dry-run)</strong></summary>

```
  devhelp · offline · DRY RUN
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
$ devhelp --offline --dry-run --cwd ./my-project "get this going"

→ detect python 3.12.4, rust stable
→ pyenv installing
→ python installing 3.12.4 via pyenv
→ rustup installing
→ install poetry install
→ install cargo build

✓ ready
  cd ./my-project
  pytest   # run tests
```

</details>

<details>
<summary><strong>AI-assisted mode (opt-in, experimental)</strong></summary>

When `ANTHROPIC_API_KEY` is set, `devhelp` routes the request through a Claude tool-use loop with access to: `inspect_system`, `read_manifest`, `read_file`, `list_dir`, `run_shell`, `install_version_manager`, `install_runtime`, `write_file`.

It's useful for repos with non-standard build scripts that the rule-based detector doesn't understand.

```bash
export ANTHROPIC_API_KEY=sk-...
devhelp --model claude-sonnet-4-6 --dry-run "set up this monorepo"
```

**Run `--dry-run` first.** Without `--yes`, every shell command the agent runs is printed before execution. With `--yes`, the agent runs autonomously up to `--max-steps`.

See [Honest about the AI mode](#honest-about-the-ai-mode) for what AI mode is *not*.

</details>

## Honest about the AI mode

An earlier version of this README oversold AI mode. Setting the record straight:

**What AI mode actually is:** a Claude tool-use loop. Useful when the rule-based detector doesn't recognize a build script, or when you want a guided walkthrough of an unfamiliar repo.

**What AI mode is *not* (yet):**

- Self-healing
- Automatic recovery from arbitrary build failures
- Smart enough to handle anything offline mode can't

**Deterministic recovery lives in offline mode**, not the agent. Three rules ship today (Xcode CLT, node-gyp Python, OpenSSL/pkg-config). More to come. We'd rather ship one deterministic rule than a paragraph about "AI fixing your environment."

If you don't have an API key, devhelp falls back to offline mode silently with a one-line notice. That's the supported default path and what the receipts above measure.

## Flags

```
devhelp <request...>

Options:
  --cwd <dir>       Working directory (default: $PWD)
  --dry-run         Print what would happen without executing
  --offline         Force offline playbook, no LLM calls
  --yes             Auto-approve destructive actions in AI mode
  --model <id>      Override the Anthropic model
  --max-steps <n>   Agent step cap (AI mode)
  -h, --help        Show help
```

## What it won't do (yet)

Honest list. PRs welcome.

- Windows native (WSL only for now)
- Auto-start Docker / docker-compose services — detected and surfaced as a step, but never run automatically (destructive)
- Database provisioning and `prisma migrate dev` — left to the user since it can be destructive
- Cloud secrets bootstrapping (1Password CLI, doppler) — `.env` is copied from the template but not populated
- `.vscode/launch.json` generation
- Local LLM backend (Ollama / llama.cpp) for AI-mode-without-cloud
- Per-command confirm prompts in AI mode (currently relies on `--dry-run` to preview)
- Non-manifest ecosystems — C / CMake / Lua / Elixir / etc. exit with an `UNSUPPORTED` panel rather than guessing
- Auto-recovery from common build errors (missing Xcode CLT, libssl, node-gyp Python) — partially surfaced as `INCOMPLETE` with manual fallbacks, not yet auto-fixed

## Roadmap

- [ ] Auto-recovery rules for common install failures (node-gyp Python, missing Xcode CLT, libssl/pkg-config)
- [ ] `.vscode/launch.json` and JetBrains run-config generation
- [ ] Ollama backend for fully-local AI mode
- [ ] Linux package detection (`apt`, `dnf`, `pacman`) for build-tool installs
- [ ] Plugin API for project-specific recipes (`.devhelp.yml`)
- [ ] Windows native support

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## Why this exists

Every developer loses hours a week to environment setup. Most of those hours go to problems with **deterministic answers** — wrong Node version, missing system lib, lockfile/manager mismatch, forgot to copy `.env.example`, forgot to `prisma generate`. There's no reason a tool can't just fix them.

devhelp keeps the deterministic path fast, free, and offline. AI is opt-in, scoped, and honestly described.

The thing we measure ourselves on is: *did the user run our command, and did `pnpm dev` actually work afterwards?* If no, that's a failure pattern we want documented in [`stress-test/FAILURE_PATTERNS.md`](./stress-test/FAILURE_PATTERNS.md). The receipts matter more than the marketing.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The best PRs add detectors (new ecosystem, new manifest, new error recovery rule).

## License

[MIT](./LICENSE)
