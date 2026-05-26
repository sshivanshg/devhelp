# Why not just use mise?

This is the first question anyone in this space will ask. Here's the honest answer.

## Short version

`mise`, `asdf`, `volta`, `fnm`, and `corepack` manage **runtime versions**. They install the Node/Python/Rust your project asks for.

`devhelp` does that *and* everything else you have to do before `pnpm dev` actually works:

- `git submodule update --init --recursive`
- pick the right package manager from the **lockfile** (not from `packageManager`)
- run `pnpm install` / `pip install` / `cargo build`
- copy `.env.example` → `.env` (root **and** per-app in monorepos)
- `prisma generate` for every schema (including weird layouts like `packages/prisma/schema.prisma`)
- `playwright install --with-deps` when Playwright is in deps
- read `.devcontainer/devcontainer.json` and honor `postCreateCommand`
- detect Docker Compose dependencies and surface them as a required pre-start step
- print the real dev URL based on detected framework, not a guess

If you've ever cloned a repo, run `mise install`, and *still* spent 30 minutes figuring out which `.env` to copy and why Prisma is missing — that's the gap devhelp closes.

## Side-by-side

| Concern | mise / asdf | volta | corepack | devcontainers | **devhelp** |
|---|---|---|---|---|---|
| Install runtime version | Yes | Yes (Node only) | No | Yes (containerized) | Yes (delegates to your existing mise/asdf/volta if present) |
| Pick package manager | No | Yes (Node only) | Yes (Node only) | Yes (containerized) | Yes (from lockfile, ground truth) |
| Run install | No | No | No | Yes (`postCreateCommand`) | Yes |
| Copy `.env.example` → `.env` | No | No | No | No | Yes (root + monorepo apps) |
| `prisma generate` | No | No | No | maybe (if author wrote it) | Yes |
| Playwright browsers | No | No | No | maybe | Yes |
| Git submodules | No | No | No | partially | Yes |
| Devcontainer `postCreateCommand` on native | No | No | No | only inside container | Yes |
| Docker service surfacing | No | No | No | Yes | Yes (surfaces, doesn't auto-run) |
| Works without Docker | Yes | Yes | Yes | No | Yes |
| Honest failure ("I don't know this stack") | No (silent) | No (silent) | No (silent) | n/a | Yes (`UNSUPPORTED` panel, exit 1) |

## "Use mise" is great advice when

- You're the *maintainer* of the repo
- You've set up a `.tool-versions` or `.mise.toml`
- All a new contributor needs is the runtime version
- Everything else is documented and works

That's the happy path. devhelp doesn't try to replace mise for that.

## "Use mise" leaves you stranded when

- You're a *contributor* cloning someone else's repo for the first time
- The repo has no `.tool-versions` (~70% of OSS repos still don't)
- The runtime is one of five things that need to be right
- The README says "just `pnpm install`" but actually you also need to copy three `.env.example` files, generate the Prisma client, and start Postgres in Docker — and none of that is in the README

This is the actual situation for most OSS contributors. We measured it: of 20 randomly-chosen popular OSS repos, **15 needed at least one post-install step that mise can't help with** (env files, Prisma, Playwright, submodules). The full breakdown is in [`../stress-test/SUMMARY.md`](../stress-test/SUMMARY.md).

## Composition, not replacement

devhelp **uses** mise/asdf/volta when you have them. If you've already installed mise, devhelp detects it and routes runtime installs through `mise install` instead of falling back to nvm/pyenv. We aren't trying to compete with the runtime-management layer — we're trying to make the rest of the setup deterministic.

## What about Devbox / devenv.sh / Nix?

Devbox and devenv.sh are great if:

- You're the maintainer
- You're willing to add a `devbox.json` or `devenv.nix`
- Your contributors are willing to install Nix

That's a real ecosystem, and if you've adopted it, devhelp has nothing to add. It's also a 1% adoption story for most OSS repos in 2026. devhelp is for the other 99% — repos that have a `package.json`, a `pyproject.toml`, a `Gemfile`, and nothing else.

## What about Gitpod / Codespaces / dev containers?

Same answer as devcontainers above: they work, and devhelp reads `.devcontainer/devcontainer.json` as a signal. But they need Docker, they need cloud or a beefy machine, and they don't help you run things on your laptop natively. devhelp is the native-laptop story.

## TL;DR

**`mise` is a runtime version manager. `devhelp` is a contributor-onboarding tool.**

They're complementary. The thing devhelp does that no other tool in the space does end-to-end is: *take a freshly cloned repo and run every step needed before `pnpm dev` works.* That includes runtime install (where mise wins if you let it drive), package install, env scaffolding, post-install codegen, and an honest "I can't help" panel when none of the above applies.
