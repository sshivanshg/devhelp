# devhelp differentiators

Grounded in the 20-repo stress test ([`stress-test/results.json`](./stress-test/results.json), [`stress-test/RETEST_RESULTS.md`](./stress-test/RETEST_RESULTS.md)) and the regression suite (`run-regression.sh`). All numbers come from real runs.

## TL;DR

| Tool | What it solves | What it doesn't |
|---|---|---|
| **mise / asdf** | Runtime versions from `.tool-versions` | Package install, env files, codegen, framework hints |
| **volta** | Node version + pm pinning | Non-Node ecosystems, post-install |
| **corepack** | Node package-manager selection | Runtime install, anything beyond pm |
| **Devbox / devenv.sh** | Declarative dev env via Nix | Only works if the repo opted in (1% of OSS) |
| **devcontainers** | Containerized dev environment | Requires Docker; doesn't help native |
| **act** | Run CI workflows locally in Docker | Doesn't set up your laptop |
| **devhelp** | All of the above, glued into one command, on your native laptop | Doesn't replace your existing runtime manager — uses it |

If you want the long-form answer to "why not just use mise?", see [`docs/WHY-NOT-MISE.md`](./docs/WHY-NOT-MISE.md).

## Honest accuracy (measured, not claimed)

Same 20 real OSS repos, two test runs.

| Ecosystem | Repos | v0.1 clean | v0.2 clean |
|---|---|---|---|
| Node monorepos | 5 | 3/5 | 5/5 |
| Python | 5 | 1/5 | 4/5 |
| Rust | 2 | 2/2 | 2/2 |
| Go | 2 | 0/2 | 2/2 |
| Polyglot / edge | 4 | 0/4 | 1/4 |
| Library-only | 2 | 0/2 | 1/2 |
| **Total** | **20** | **5/20 (25%)** | **15/20 (75%)** |

Repos outside coverage exit non-zero with a clear `UNSUPPORTED` panel. Zero silent failures since v0.2.

The biggest single bug fix in v0.2 was the panel branching: v0.1 always rendered a green `READY` box, even on broken detection or failed installs. v0.2 returns exit 1 with `UNSUPPORTED` (no recognized stack) or `INCOMPLETE` (a critical step errored), so users actually find out when something went wrong.

## vs. mise / asdf

`mise` (and `asdf`) install runtime versions from `.tool-versions` / `.mise.toml`. They do that one thing very well.

|  | mise | devhelp |
|---|---|---|
| Install Node/Python/Rust at the right version | ✅ | ✅ (delegates to mise when present) |
| Pick package manager from lockfile | ❌ | ✅ |
| Run `pnpm install` / `pip install` | ❌ | ✅ |
| Copy `.env.example` → `.env` | ❌ | ✅ |
| `prisma generate` on every schema | ❌ | ✅ |
| Playwright browsers | ❌ | ✅ |
| Git submodules | ❌ | ✅ |
| Honor `.devcontainer/devcontainer.json` `postCreateCommand` natively | ❌ | ✅ |
| Surface Docker Compose service deps | ❌ | ✅ |
| Honest "I can't help here" panel | n/a | ✅ |

**Concrete examples from the stress test:**

- **`calcom/cal.com`**: `.tool-versions` would resolve Node + Yarn for you. devhelp does that *and* runs `pnpm install`, finds `packages/prisma/schema.prisma`, runs `prisma generate`, copies the eight per-app `.env.example` files, and surfaces the `docker compose up -d` requirement for Postgres.
- **`pydantic/pydantic`**: mise picks up `requires-python` (3.9, EOL). devhelp picks 3.14 from the CI matrix max — what the maintainers actually develop against.

mise + devhelp compose: if you have mise installed, devhelp routes runtime installs through it instead of falling back to nvm/pyenv.

## vs. volta

Volta pins Node + npm/pnpm/yarn per repo from `package.json#volta`. Works great for Node-only repos. Doesn't help Python, Rust, Go, Ruby, PHP, Elixir, .NET, JVM, Dart, Deno, Swift, Haskell, Scala, Clojure, R, Julia, Zig, OCaml, or any of the 20 other ecosystems devhelp covers. Volta + devhelp compose the same way mise does — devhelp will detect Volta and use it for Node.

## vs. corepack

Corepack picks the Node package manager from `packageManager`. That's a useful primitive. devhelp uses the **same lockfile-as-ground-truth heuristic Corepack uses**, but extends it to everything else in the setup chain. Corepack-only: you still need to run install yourself, generate Prisma yourself, copy envs yourself.

## vs. Devbox / devenv.sh

Devbox and devenv.sh give you reproducible dev envs via Nix. They're great — if the repo's maintainers added a `devbox.json` or `devenv.nix`. Most OSS repos haven't. devhelp is the tool for the repos that *haven't* opted into Nix — which is the vast majority. If you've adopted Devbox, devhelp has nothing to add for those repos.

## vs. devcontainers

Devcontainers run your entire dev environment in a Docker container. devhelp sets up your native machine.

Devcontainers need Docker and an editor that supports them (VS Code, JetBrains). devhelp needs nothing.

They're **complementary**: devhelp reads `.devcontainer/devcontainer.json` as an additional signal. It extracts the runtime version from the image tag (`javascript-node:1-20-bookworm` → Node 20) and surfaces the `postCreateCommand` in the `READY` panel. For repos with a curated devcontainer, the maintainer's setup wins. From the stress-test sample, `astro`, `flask`, `next.js`, and `cli/cli` all have devcontainer.json files that devhelp uses.

## vs. nektos/act (57k stars)

`act` runs your CI workflows locally inside Docker. devhelp sets up your machine to develop. Different problems.

|  | act | devhelp |
|---|---|---|
| Goal | Reproduce CI runs | Set up your dev machine |
| Output | Container exit code | Native env (managed runtimes, copied env files, generated Prisma client) |
| Side effects | Containers, ephemeral | Persistent — laptop is ready to `pnpm dev` afterwards |
| Needs Docker | Yes | No |
| Needs CI to exist | Yes | No (works on repos with zero CI) |

## The two-mode architecture

**Offline mode (default):** pure rules, zero network calls to AI providers. No trust barrier. Handles the 75% of repos with standard manifests.

**AI mode (opt-in):** Claude-tool-use loop for unknown build scripts and guided remediation. Triggered when `ANTHROPIC_API_KEY` is in the environment. We are deliberately conservative about what we claim AI mode does — see the [`Honest about the AI mode`](./README.md#honest-about-the-ai-mode) section of the README.

## v0.2 changes that mattered

- `INCOMPLETE` / `UNSUPPORTED` panels with non-zero exit codes (the silent-success bug)
- Prisma schema detection at `<pkg>/schema.prisma` (cal.com)
- Tooling-only `package.json` (django, mdBook) no longer triggers a false Node install
- Vite framework detection now requires `vite.config.*` (trpc no longer mis-tagged)
- Python version resolved from CI matrix max instead of `requires-python` lower bound
- Rust marked optional when a major JS framework is the primary stack
- Go installer (brew on macOS, manual instructions on Linux)
- Devcontainer Phase A+B (image tag → runtime version, `postCreateCommand` → READY panel)
- Yarn-workspaces detected (was previously mis-labeled npm-workspaces for react/excalidraw)
- `--verbose` to opt back in to SKIPPED noise
- Archive-repo warning via GitHub API (heads up before contributors waste an afternoon)
- Docker Compose detection — surfaces `docker compose up -d` as a required pre-start step (never auto-runs it; destructive)

## What we don't do (yet)

- Docker / service containers — detected and surfaced but not automated (destructive on shared dev DBs)
- Windows native (WSL works)
- Database provisioning (`prisma migrate dev` left to the user)
- C / CMake / Lua and other non-manifest ecosystems — exit with `UNSUPPORTED` or `INFORM`, never silent
- Cloud secret bootstrapping (1Password, doppler)
- `.vscode/launch.json` generation
- Local LLM backend (Ollama / llama.cpp)
