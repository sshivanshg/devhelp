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

[Install](#install) · [Receipts](#receipts) · [Why not mise?](#why-not-mise) · [How it works](#how-it-works) · [Examples](#examples) · [When it can't finish](#when-it-cant-finish) · [Contributing](#contributing)

<br>

![devhelp setting up the documenso Prisma/Next.js monorepo](https://raw.githubusercontent.com/sshivanshg/devhelp/main/demo/devhelp.gif)

<sub>One command reads the documenso monorepo and plans the whole setup — Node 22, the right package manager, `.env`, `prisma generate`, Playwright, and the Next.js dev URL. <em>This clip is the <code>--dry-run</code> plan (detection + step ordering). For real, verified end-to-end runs see <a href="#examples">Examples</a> and <a href="#receipts">Receipts</a>.</em></sub>

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

Most OSS dev-tool READMEs skip this. Here's the **measured behavior on v0.6.0**, running devhelp for real — a full (non-dry-run) clone + install — against a spread of popular repos on macOS:

| Repo | Stack | Result |
|---|---|---|
| `expressjs/express` | Node · npm | ✅ READY |
| `vitejs/vite` | Node · pnpm monorepo | ✅ READY |
| `pallets/flask` | Python · uv | ✅ READY |
| `tiangolo/fastapi` | Python · pip / venv | ✅ READY |
| `gin-gonic/gin` | Go | ✅ READY |
| `documenso/documenso` | Next.js · npm · turbo monorepo · Prisma · Playwright | ✅ READY — its committed lockfile is out of sync so `npm ci` refused; devhelp fell back to `npm install` and warned about it |

**6/6 reached READY — zero silent failures, zero fake-green.** (When a step *can't* be recovered, devhelp exits non-zero with a what/why/fix panel rather than a green lie — see [When it can't finish](#when-it-cant-finish).) Separately, a dry-run *detection* pass over 13 repos (the six above plus `sveltejs/svelte`, `vuejs/core`, `psf/requests`, `gohugoio/hugo`, `BurntSushi/ripgrep`, `clap-rs/clap`, `prisma/prisma`) identified the stack and planned the right steps on all 13.

Honest caveats on these numbers: the six above were run on **macOS** with common runtimes already installed, against popular, well-maintained repos. On a clean Linux container, the **real installs** (Node npm/pnpm, Python uv compiled from source via pyenv) reached READY, and a Go repo reached READY in a real **arm64** clean-Linux install (which is what surfaced — and fixed — the amd64-only download bug); the rest of the core sweep (Go via Hugo, Rust, Ruby, Astro monorepo) was dry-run *detection*, not a full install. A broad Linux dry-run detection sweep reached READY for 31/31 repos across the advertised ecosystem matrix. `--with-services` was verified with a throwaway Postgres compose + Prisma migration, including a DB query proving the migration applied. Still thin: large real installs across every ecosystem and native Windows — see [What it won't do (yet)](#what-it-wont-do-yet).

This is a **small, honest sample** — deliberately not a "works on 99% of GitHub" claim. The point isn't the percentage; it's that when devhelp can't finish, it tells you exactly why and what to do, and saves a reproducible run log. Run it on your own repos and, when it falls short, [open an issue](https://github.com/sshivanshg/devhelp/issues). The older v0.1/v0.2 stress-test history lives in [`stress-test/`](./stress-test/).

## Why not mise?

Short answer: **mise manages runtime versions. devhelp does runtime versions *and* everything else** — package install, env scaffolding, Prisma, Playwright, submodules, devcontainer `postCreateCommand`, Docker surfacing, framework-aware dev URLs. If you already have mise/asdf/volta/fnm installed, devhelp uses them — it's not trying to replace your runtime manager.

Full comparison vs. mise, asdf, volta, corepack, devbox, devenv.sh, and devcontainers: [`docs/WHY-NOT-MISE.md`](./docs/WHY-NOT-MISE.md).

## Coverage

devhelp detects 31 ecosystems — but "detects" and "proven end-to-end" aren't the same thing, so here are the two tiers honestly:

- **Verified end-to-end (v0.6.0):** **Node, Python, Go** — exercised by real clone-and-install runs that reached READY (see [Receipts](#receipts)); Go includes a real **arm64** clean-Linux install. **Rust, Ruby, Bun, Deno** have had their clean-machine runtime-PATH resolved and unit-tested, but not yet a full real-install run to READY. These are the paths to trust most.
- **Detected & planned:** the other ~27 ecosystems are recognized, surface the right runtime + commands, and are guarded by detection fixtures — but most haven't been through a real install on a real repo yet. Treat them as **best-effort**: when one falls short, it exits with an honest `INCOMPLETE`/`INFORM` panel and a fix, never a fake-green READY.

The table below lists all of them; the tier above tells you how far each has actually been proven.

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

The npm package is `devhelp-cli`; the command on your PATH is still `devhelp`. (The shorter `devhelp` name is taken on npm by an unrelated package, so the published name is `devhelp-cli`.)

Requirements: Node 18+. macOS and Linux supported. (Windows: WSL works; native is on the roadmap.)

> [!WARNING]
> **devhelp runs the repo's own code.** Setting up a project executes its install/build scripts (`npm install` post-install hooks, `cargo build`, `bundle install`, …) — exactly as if you'd run them by hand. devhelp does **not** sandbox them. Only point it at repos you'd already trust enough to `npm install`. Use `--dry-run` to preview every command first. See [Security / trust model](#security--trust-model).

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

These are **real (non-dry-run) v0.6.0 runs**, copied verbatim — one that works, one that honestly can't finish.

<details open>
<summary><strong>Python API — <code>tiangolo/fastapi</code> (real run → READY)</strong></summary>

```
  devhelp
  › tiangolo/fastapi

  ↪ Cloning https://github.com/tiangolo/fastapi.git
  ✔ Cloned to ./fastapi
  ✔ Detected: FastAPI, python 3.11
  ✔ Installed Python 3.11
  ✔ Installed · python3 -m venv .venv && . .venv/bin/activate && pip install -e .

╭────────── FastAPI ──────────╮
│                             │
│  READY                      │
│                             │
│    cd ./fastapi             │
│    pytest   # tests         │
│                             │
╰─────────────────────────────╯
  Full log: ~/.devhelp/runs/<timestamp>.json
```

</details>

<details>
<summary><strong>Monorepo with an out-of-sync lockfile — <code>documenso/documenso</code> (real run → recovers → READY)</strong></summary>

```
  devhelp
  › documenso/documenso

  ✔ Detected: Next.js, node 22.0.0, npm, turbo monorepo, prisma, playwright, devcontainer
  ✔ Installed Node 22.0.0
  ❯ Installing deps · npm ci (large monorepos can take a few minutes)
  ✔ Installed · npm install        # npm ci rejected the lockfile — fell back automatically

╭───────────── Next.js ─────────────╮
│                                   │
│  READY                            │
│    ! npm ci rejected the          │
│      committed lockfile (out of   │
│      sync); fell back to          │
│      "npm install"                │
│                                   │
╰───────────────────────────────────╯
  Full log: ~/.devhelp/runs/<timestamp>.json
```

<sub>(documenso's committed lockfile is out of sync with its `package.json`, so the strict `npm ci` aborts. Rather than dead-end, devhelp falls back to `npm install` once and tells you it did — reaching a working install without hiding the lockfile drift.)</sub>

</details>

## When it can't finish

devhelp never fakes a green panel. Every run ends in one of four explicit states:

- **`READY`** — everything worked; the panel shows the `cd` / `dev` / `test` commands and the real dev URL.
- **`INCOMPLETE`** (exit 1) — a critical step failed. The panel breaks each failure into **what** failed, **why** (the real cause line pulled from the output, not a generic "exit 1"), and a concrete **fix** — a matched remediation, a stack-specific hint, or the exact command to re-run. It never dead-ends on "check the log."
- **`UNSUPPORTED`** (exit 1) — the stack isn't recognized; you get a link to file a support request instead of a wrong guess.
- **`INFORM`** — recognized, but auto-install isn't safe (C/C++, Nix, Terraform…); the panel explains what to install by hand.

Every run also writes a full JSON record to `~/.devhelp/runs/<timestamp>.json` (the last 100 are kept) and prints its path at the end. That log has the detected stack, every step run, and the captured failure output — enough to reproduce a failure without guessing.

**Help it improve:** hit a repo devhelp gets wrong? [Open an issue](https://github.com/sshivanshg/devhelp/issues) and attach the run-log JSON. Maintainers can also commit a [`.devhelp.yml`](./src/recipe.ts) to their repo declaring repo-specific steps (`postInstall:` commands plus `dev` / `test` / `build` overrides) so devhelp sets their project up out of the box.

See the [**FAQ & known limitations**](./docs/FAQ.md) for common failures (and what each means), the slow-step explanations, and the honest scope of what's verified vs. best-effort.

## Security / trust model

devhelp clones and sets up arbitrary repositories, so it's worth being explicit about what that means. **The short version: running devhelp on a repo is as trusting as cloning it and running `npm install` / `make` yourself — because that's literally what it does.** Don't point it at code you wouldn't run by hand.

- **Running install commands runs the repo's code.** `npm install`, `cargo build`, `bundle install`, etc. execute the project's own post-install/build scripts *by design*. devhelp does not sandbox them. Only run it on repos you'd be willing to `npm install` by hand.
- **Version strings from manifests are validated before use.** Values like `.python-version`, `rust-toolchain`, and `.tool-versions` entries are read from the (untrusted) repo and would otherwise be interpolated into shell commands. devhelp rejects any version/toolchain value containing shell metacharacters and refuses to install rather than run it — closing a shell-injection vector.
- **Service containers are never started automatically.** `docker compose up` is surfaced as a step, never run.
- **`--dry-run` previews every command without running any of it.** No install/build/runtime command executes and nothing in your existing files is modified. To produce an accurate plan it does make a temporary shallow clone of the named repo (so it can read the real manifests), then deletes that clone before exiting — so the only thing it touches is its own throwaway checkout.

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

devhelp keeps that path fast, free, and fully deterministic — no LLM, no API keys, no telemetry, no surprises.

The thing we measure ourselves on is: *did the user run our command, and did `pnpm dev` actually work afterwards?* If no, that's a failure pattern we want documented in [`stress-test/FAILURE_PATTERNS.md`](./stress-test/FAILURE_PATTERNS.md). The receipts matter more than the marketing.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The best PRs add detectors (new ecosystem, new manifest, new error recovery rule).

## License

[MIT](./LICENSE)
