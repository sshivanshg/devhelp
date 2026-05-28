# Stress Test Summary

> **Historical — v0.1.0 baseline (2026-05-23).** This is devhelp's first warts-and-all
> stress test, run *before* the v0.2 fix pipeline. Its headline finding — "the offline
> dry-run path cannot fail" — was the #1 bug it surfaced, and it is fixed. For the
> current numbers (25% → 75% clean, `neovim` now honestly refused) see the v0.2 re-run
> in [`RETEST_RESULTS.md`](./RETEST_RESULTS.md). Kept public because the receipts matter
> more than the marketing.

**Date:** 2026-05-23
**devhelp version:** 0.1.0 (local build, not yet on npm)
**Repos tested:** 20
**Method:** `devhelp --offline --dry-run "set up this project"` on each cloned repo, plus one real-install attempt on `tiangolo/fastapi`.

## Headline

**0/20 repos returned a meaningful failure status.** All 20 returned exit 0 and showed a green READY panel. This is the most important finding of the entire stress test: in offline mode, devhelp *cannot fail*. That makes the success/failure label useless and hides every other detection bug.

Real-install on `fastapi` confirmed the same problem from the other direction: `pip install -e .` failed (`command not found: python` after pyenv install), exit was non-zero, but devhelp drew the green READY panel anyway.

## Run-by-run results

| Repo | Dry-run exit | Detection | Issues found |
|---|---|---|---|
| `vercel/next.js` | 0 | Next.js + node 20 + pnpm + turbo + rust + playwright | Eager Rust install; playwright pulls ~1.5GB |
| `calcom/cal.com` | 0 | node lts/* + yarn + turbo + playwright | **Prisma missed**; playwright auto-install for non-e2e contributors |
| `withastro/astro` | 0 | node 24.14.0 + pnpm + turbo | Detection clean; has devcontainer.json that's a better source |
| `trpc/trpc` | 0 | **Vite (wrong)** + node 24 (vague) + pnpm + turbo | False-positive framework; wrong dev URL |
| `vitejs/vite` | 0 | Vite + node 22.12.0 + pnpm + workspaces | Clean (true positive for Vite, since vite is the framework) |
| `tiangolo/fastapi` | 0 (dry-run) / fail (real) | FastAPI + python 3.11 | Real install fails on pyenv path; READY panel still drawn |
| `django/django` | 0 | Django + **node lts/* (wrong)** + npm + python 3.12 | Tooling-only package.json triggers Node install |
| `pallets/flask` | 0 | Flask + python 3.10 | OK; has devcontainer.json |
| `pydantic/pydantic` | 0 | python 3.10 | Library — no dev command — still shows READY |
| `encode/httpx` | 0 | python 3.9 | EOL Python pinned from lower bound |
| `rust-lang/mdBook` | 0 | **node lts/* (wrong)** + npm + rust stable | Tooling-only package.json triggers Node install |
| `sharkdp/bat` | 0 | rust stable | Clean (library — no dev command — still shows READY) |
| `gohugoio/hugo` | 0 | go 1.25.0 | No Go installer; "READY" is misleading |
| `cli/cli` | 0 | go 1.26.0 | Same as hugo; has devcontainer image-only |
| `supabase/supabase` | 0 | node 22 (vague) + pnpm + workspaces | Per-app envs missed; dev URL wrong |
| `remix-run/remix` | 0 | node 24 (vague) + pnpm + workspaces | Archived repo; no archive warning |
| `sveltejs/kit` | 0 | node lts/* + pnpm + workspaces + playwright | Clean detection; lts/* is vague |
| `excalidraw/excalidraw` | 0 | Vite + node 18.0.0 + yarn + workspaces | "npm-workspaces" label is wrong (yarn classic) |
| `facebook/react` | 0 | node 20.19.0 + yarn + workspaces | "npm-workspaces" label is wrong (yarn classic) |
| `neovim/neovim` | 0 | **nothing recognized** | Empty READY panel — should refuse politely |

## Counts

- **Clean detection:** 5 (`vite`, `flask`, `bat`, `astro` cleanish, `sveltejs/kit` cleanish)
- **Detection bugs (false positives):** 5 (`trpc` Vite, `django` Node, `mdBook` Node, `react` workspaces, `excalidraw` workspaces)
- **Missing detection:** 3 (`cal.com` Prisma, `supabase` per-app envs, `httpx`/`pydantic` Python version too low)
- **No installer for detected stack:** 2 (`hugo`, `cli` — Go)
- **Stack entirely unsupported:** 1 (`neovim`)
- **Real-install failed but READY drawn:** 1 confirmed (`fastapi`)

## Top 3 things to fix before shipping

1. **Make failure visible.** Track critical step failures and "nothing recognized" state; replace the green READY with an amber INCOMPLETE or red FAILED panel and exit non-zero. *Today, devhelp lies to the user every time something goes wrong.* This is the #1 bug.
2. **Fix the cal.com Prisma path.** It's the canonical demo repo. The fix is a one-line path change. (See `FAILURE_PATTERNS.md` Pattern 3.)
3. **Don't claim Node is needed for django and mdBook.** Tooling-only `package.json` files should not promote Node to a required install. Gate behind lockfile / `engines.node` / `dependencies` / framework presence.

## Top 3 demo repos (when fixes ship)

1. **`vitejs/vite`** — clean detection, real framework match, fast dry-run. Best "it just works" demo.
2. **`pallets/flask`** — clean Python detection, manageable size, has a devcontainer for the next milestone.
3. **`withastro/astro`** — clean Node monorepo + has `postCreateCommand` in devcontainer, sets up the Phase A devcontainer integration story.

Avoid using `cal.com` as the demo until the Prisma path is fixed and Docker-dependency surfacing is in.

## Ship readiness: **NOT READY**

**Reason:** Offline mode cannot fail (Pattern 1) and the canonical demo (cal.com) misses its Prisma schema (Pattern 3). Both are simple fixes (likely <50 lines combined), but until they land, the marketing claim "one command and everything is set up" is provably false on the headline use case.

After Patterns 1 + 2 + 3 are fixed: ALMOST. After Pattern 4 (Vite false positive) is fixed: READY.
