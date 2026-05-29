# Failure Patterns

> **Historical — v0.1.0 baseline (2026-05-23).** These are the patterns the first
> stress test surfaced, with fix sketches. The critical ones (Patterns 1–4, 7) shipped
> in v0.2; see [`RETEST_RESULTS.md`](./RETEST_RESULTS.md) for the per-repo before/after.
> Read this for *how* devhelp was hardened, not as a description of current behavior.

Based on the 20-repo stress test in `results.json`. Critical observation up front:

**All 20 runs returned `exit_code: 0` and showed a READY panel.** Including `neovim/neovim`, where devhelp detected nothing and the panel was empty. The dry-run path *cannot fail*. This masks every other problem and is the root cause of pattern #1 below.

A separate real-install run on `tiangolo/fastapi` (logged at `/tmp/devhelp-trials/fastapi.real.log`) confirmed the same bug from the other direction: install failed with `command not found: python`, exit was non-zero, and devhelp *still* drew the green READY panel.

---

## Pattern 1: False success — READY panel shown when no setup happened
**Severity: critical**
**Repos affected:** `neovim/neovim` (no manifests at all), `pydantic/pydantic` (library; no dev command), `encode/httpx` (library; no dev command), `sharkdp/bat` (library), and — confirmed via real-install — `tiangolo/fastapi` (install actually failed).

**Failure step:** none — finishes "successfully" anyway.

**Root cause:** The setup runner always called `printSummary` at the end. There was no concept of "I cannot help with this repo" or "a critical step failed". `listr2` was configured `exitOnError: false`, which is correct for letting later steps run, but we never inspected the resulting task statuses before printing READY.

**User-visible failure:** The user sees green, then runs the suggested command and is confused when nothing works (neovim) or the command errors (fastapi after real install).

**Fix:**
- Track `criticalStepFailed` on `PlaybookCtx`. If detection returned `nothing recognized`, or any non-skip task failed, replace the green READY panel with an amber/red "INCOMPLETE" panel that lists what failed and what the user should do.
- Detect "unsupported repo" explicitly: if `detect()` returns no runtimes, no installCommands, and no recognized framework, print a one-line "devhelp doesn't know this stack yet — file a playbook request" and exit non-zero.

**Files:** `src/setup.ts:runSetup`, `src/setup.ts:printSummary`

---

## Pattern 2: Tooling-only `package.json` triggers false-positive Node project
**Severity: high**
**Repos affected:** `django/django` (biome + grunt), `rust-lang/mdBook` (eslint for docs assets), and likely many other Rust/Go/Python repos that ship JS tooling for linting.

**Failure step:** detection → planning extra work.

**Root cause:** `detectNode` treats any root `package.json` as proof of a Node project. The signal isn't strong enough: a `package.json` with only `devDependencies` and no `dependencies` is almost always a tooling config.

**User-visible failure:** Plan includes `Install Node lts/* via nvm` + `npm install`, neither of which the contributor needs. On django, the dev workflow is `python -m django ...` — Node is irrelevant. The dry-run "looks fine"; a real run would burn ~2 minutes installing Node + downloading npm packages for no reason.

**Fix:** Treat Node as required only when at least one of these is true:
1. A lockfile is present (`pnpm-lock.yaml` / `yarn.lock` / `package-lock.json` / `bun.lockb`)
2. `engines.node` is set
3. `package.json` has a non-empty `dependencies` field
4. A known framework dep is present

Otherwise, mark the Node toolchain as *optional* and add it to a "you'll want this for tooling: `npm install`" hint in the READY panel.

**Files:** `src/detect.ts:detectNode`

---

## Pattern 3: Prisma schema missed when the workspace package is literally named `prisma`
**Severity: critical** (this is the canonical demo repo)
**Repos affected:** `calcom/cal.com`.

**Failure step:** Prisma generation step skipped: `Generating Prisma client [SKIPPED: no prisma schema]`.

**Root cause:** In `detectPostInstall`, the path concat is `path.join(sub, e.name, "prisma/schema.prisma")` → for cal.com this produces `packages/prisma/prisma/schema.prisma`. The real path is `packages/prisma/schema.prisma`. The detector never tries the package root itself.

**User-visible failure:** Contributor runs `pnpm dev`, sees Prisma client missing, has to remember to run `pnpm db-deploy` themselves.

**Fix:** When iterating workspace packages, check *both* `packages/<x>/prisma/schema.prisma` and `packages/<x>/schema.prisma`. Or replace the manual walk with a depth-3 glob excluding `node_modules`.

**Files:** `src/detect.ts:detectPostInstall`

---

## Pattern 4: Framework false-positive on build-tool dep
**Severity: high**
**Repos affected:** `trpc/trpc` (vite is a devDep of the playground), `excalidraw/excalidraw` (vite is a build dep — though excalidraw *is* historically Vite-based, so this might be a true positive — needs verification).

**Failure step:** detection → final panel shows wrong framework, wrong dev URL.

**Root cause:** `FRAMEWORK_TABLE` matches first-hit. `vite` is the broadest signal, comes near the end of the table, and matches any repo that uses vite for anything.

**User-visible failure:** Final panel shows `→ http://localhost:5173` for trpc. tRPC is a library, not a Vite app. The URL is meaningless.

**Fix:**
1. Reorder `FRAMEWORK_TABLE` so the more specific frameworks always win (already mostly correct; vite is the catch-all at the bottom).
2. *Suppress framework detection entirely* when the root `package.json` looks like a library (`private: false`, no `dependencies` block, no `scripts.dev`, or `main` / `exports` field present).
3. For "Vite" specifically, only assert it as a *framework* when a `vite.config.{ts,js,mjs}` exists at the root or in `apps/*`.

**Files:** `src/detect.ts:FRAMEWORK_TABLE`, `detectNode`

---

## Pattern 5: Eager Rust detection on Node-primary repos that ship a Rust crate
**Severity: medium**
**Repos affected:** `vercel/next.js` (next-swc, turbopack), and likely any modern JS toolchain that ships native bits.

**Failure step:** detection → plan includes `Installing Rust toolchain stable`.

**Root cause:** `detectRust` triggers on any `Cargo.toml`, including subdirectories that aren't part of the user's dev path. A Next.js *contributor* might need Rust; a Next.js *user* installing the repo to learn definitely doesn't.

**User-visible failure:** Plan adds 2–5 minutes of Rust install for someone who doesn't need it.

**Fix:**
- Only trigger Rust detection from a `Cargo.toml` *at the project root* (currently it doesn't recurse, but `detectRust` does check root — investigate whether `next.js/Cargo.toml` is the actual root or a workspace setup that bubbles up).
- Confirmed via `find`: `repos/next.js/Cargo.toml` exists at root. So this is "next.js really does have a top-level Rust workspace." Mitigation: add a heuristic where if a Node project is detected with a major framework, Rust becomes optional with a hint, not a default step.

**Files:** `src/detect.ts:detectRust`

---

## Pattern 6: Vague `engines.node` ranges installed verbatim
**Severity: medium**
**Repos affected:** `trpc/trpc` (`node 24`), `remix-run/remix` (`node 24`), `supabase/supabase` (`node 22`), `withastro/astro` (`node 24.14.0` — concrete, OK).

**Failure step:** `Installing Node 24` — nvm resolves "24" to latest 24.x.x, which can drift from CI pinning.

**Root cause:** `normalizeNodeVersion` does its job — turns `^24.0.0` into `24`. But that's not "the right version", it's "an ambiguous version".

**Fix:** When the manifest only provides a range, look at the lockfile or `engines.node` minimum and resolve to that concrete version. Or warn: `engines.node is "^24" — installing latest 24.x.x. Add an .nvmrc for reproducibility.`

**Files:** `src/versions.ts`, `src/setup.ts:installNode`

---

## Pattern 7: Polyglot / non-standard ecosystems are silently ignored
**Severity: high**
**Repos affected:** `neovim/neovim` (C + CMake + Lua), `supabase/supabase` (some Postgres tooling not in detect), `gohugoio/hugo` and `cli/cli` (Go — detected but no install plan, since devhelp has no Go installer).

**Failure step:** Detection succeeds-but-empty. Go projects detect `go 1.25` but the playbook has no `installGo` task.

**Root cause:** No support for C/CMake/Lua/Elixir; no installer for Go even though detection mentions a version.

**Fix:**
- Add Go installer (via `gvm` or just instruct user to use `brew install go`).
- For unsupported ecosystems, return early with a clear message: `devhelp doesn't know <ecosystem> yet. Found: <list of unrecognized manifest files>`.

**Files:** `src/setup.ts` (new `installGo` task), `src/detect.ts` (track unrecognized manifests).

---

## Pattern 8: `.env.example` only checked at project root
**Severity: medium**
**Repos affected:** `supabase/supabase` (per-app envs in `apps/studio/`, `apps/docs/`), likely also true for `excalidraw/excalidraw` and most monorepos.

**Failure step:** `Setting up environment files [SKIPPED: no .env templates]`.

**Root cause:** `detectPostInstall` only looks in the root directory.

**Fix:** In monorepos, also scan `apps/*/` and `packages/*/` for `.env.example` / `.env.template` and copy each to a sibling `.env`.

**Files:** `src/detect.ts:detectPostInstall`

---

## Pattern 9: Wrong workspace flavor detected for yarn-classic monorepos
**Severity: low**
**Repos affected:** `facebook/react`, `excalidraw/excalidraw`.

**Failure step:** Detection reports "npm-workspaces" when the actual lockfile is `yarn.lock` and the workspaces field is yarn-classic.

**Root cause:** Detector picks pm from lockfile (correct → yarn) but reads `pkg.workspaces` to label monorepo type. The label "npm-workspaces" is misleading; it's just "yarn workspaces."

**Fix:** When `pkg.workspaces` is present *and* pm is yarn, label as `yarn-workspaces`. When `pkg.packageManager?.startsWith("yarn@1")`, label as `yarn-classic`.

**Files:** `src/detect.ts:detectNode` (monorepo label)

---

## Pattern 10: pyproject.toml version constraint sometimes resolved too low
**Severity: medium**
**Repos affected:** `encode/httpx` (detected `python 3.9` — actual pyproject says `requires-python = ">=3.9"`, but the codebase tests on 3.13). `pydantic/pydantic` (detected `python 3.10` — similar story).

**Failure step:** detection — installs the oldest compatible Python, not what CI actually uses.

**Root cause:** `parsePyProjectPython` reads the lower bound of the range. For libraries with a wide compat range, this picks an ancient EOL Python.

**Fix:**
- Read `tool.hatch.envs.default.python` or `tool.uv.python-preference` if present.
- Fallback: detect `python_requires` in CI files (`.github/workflows/*.yml`) — yes, this is the "CI parser" idea, narrowly applied as a hint, not the whole product.
- Final fallback: install latest stable Python (3.13 today), not the oldest supported.

**Files:** `src/detect.ts:detectPython`, `src/detect.ts:parsePyProjectPython`

---

## Pattern 11: Listr UI noise — five SKIPPED lines per Python-only repo
**Severity: low (cosmetic but very visible)**
**Repos affected:** `tiangolo/fastapi`, `django/django`, `pallets/flask`, `pydantic/pydantic`, `encode/httpx`, `sharkdp/bat`, `gohugoio/hugo`, `cli/cli`.

**Failure step:** N/A.

**Root cause:** Every task prints a `[SKIPPED: reason]` line even when totally irrelevant.

**Fix:** `listr2` `rendererOptions.collapseSubtasks` or filter skipped tasks from output unless `--verbose`.

**Files:** `src/setup.ts:runSetup` (Listr options)

---

## Pattern 12: Performance is fine in dry-run; unknown for real runs (only fastapi tested)
**Severity: medium (unknown)**

Dry-run is uniformly <1 s. The single real-install attempt (fastapi) took ~2 minutes mostly burned on pyenv via brew + Python compilation from source. Need to run more real installs to characterize real performance, especially for big monorepos like next.js, supabase, and cal.com.

---

## Summary

| Pattern | Severity | Affects | Has fix sketch |
|---|---|---|---|
| 1. False READY when nothing/everything failed | critical | all | yes |
| 2. Tooling-only package.json → false Node | high | django, mdBook | yes |
| 3. Prisma path bug in cal.com | critical | calcom | yes |
| 4. Framework false positive (Vite) | high | trpc, possibly excalidraw | yes |
| 5. Eager Rust on Node monorepos | medium | next.js | yes |
| 6. Vague Node ranges installed verbatim | medium | trpc, remix, supabase | yes |
| 7. Polyglot/unsupported silently ignored | high | neovim, supabase | yes |
| 8. .env.example only at root | medium | supabase, monorepos | yes |
| 9. Wrong workspace flavor label | low | react, excalidraw | yes |
| 10. Python version too low | medium | httpx, pydantic | yes |
| 11. SKIPPED line noise | low (cosmetic) | most | yes |
| 12. Real-install performance unknown | medium | unknown | needs measurement |
