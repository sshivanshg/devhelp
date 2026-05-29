# Hardening Log

## Summary

Current branch: `hardening-production-readiness`.

Bugs found and fixed in this pass:
- Clean Linux Python `uv` projects failed after pyenv install because the `uv` CLI was not present. Fixed by bootstrapping `uv`/`poetry`/`pipenv` through `python3 -m pip install --user <tool>` when missing.
- React Native dry-run crashed before a panel because Gemfile Ruby floor specs like `>= 2.6.10` reached the shell-safety gate as raw unsafe strings. Fixed by normalizing Ruby version requirements to installable tokens.
- Dry-run clone failures for nonexistent/private repos were misreported as `UNSUPPORTED STACK`. Fixed by recording clone failure as a critical step and prioritizing `INCOMPLETE`.
- Dry-run inspection clones could be left behind if a fatal error happened after clone/detect. Fixed with idempotent `finally` cleanup.

Verified now:
- `npx tsc --noEmit` clean.
- `yarn vitest run` clean: 191 tests passing, up from the 186-test baseline.
- `npm run build` succeeds.
- Zero legacy `offline` naming hits in `src`, `test`, `docs`, README/CHANGELOG/CONTRIBUTING, and `stress-test`.
- Clean Linux core sweep: 9/9 READY across Node npm, Node pnpm, Node yarn dry-run, Python uv after pyenv-from-source, Go dry-run, Rust dry-run, Ruby dry-run, and Astro monorepo dry-run.
- Broad Linux dry-run sweep: 31/31 READY across the advertised ecosystem matrix.
- `--with-services`: verified compose up + Prisma generate + Prisma migrate deploy against a real Postgres container on port 55433, then queried the DB to prove the migration applied.
- Failure panels manually verified for nonexistent/private repo and Docker daemon down; recovery tests cover DB unreachable, port in use, disk full, missing native build deps, network/registry, and repo auth/not-found.

Still best-effort / remaining risk:
- Native Windows is not end-to-end verified; WSL/Git Bash remains the supported path.
- The broad 31-repo pass is dry-run detection, not real install for every ecosystem.
- Out-of-disk and GitHub API rate-limit behavior are covered by deterministic recovery/skip logic, not by forcing the host into those exact states.

Review and merge commands:
- `git checkout hardening-production-readiness`
- `npx tsc --noEmit`
- `yarn vitest run`
- `npm run build`
- `stress-test/container-sweep.sh core`
- `stress-test/container-sweep.sh dry-run`
- `stress-test/with-services-smoke.sh`

## 2026-05-29

- Renamed the internal setup runner from `offline` naming to `setup` naming: `src/setup.ts`, `runSetup`, `SetupOptions`, and `test/run-setup.test.ts`. Root cause: stale naming from the removed AI/online mode made the current deterministic runner confusing. Fix: rename module/types/imports/docs without behavior changes. Verified: `rg -n "offline|Offline|runOffline|OfflineOptions|runoffline|src/offline|--offline|offline\\.js" src test docs README.md CHANGELOG.md CONTRIBUTING.md stress-test` returned no matches; `npx tsc --noEmit`, `yarn vitest run` (186 tests), and `npm run build` all passed.
- Added `stress-test/container-sweep.sh`, a sequential Docker sweep harness that mounts `dist` read-only, isolates caches inside per-case `/work`, records exit/panel/free-space deltas, and deletes each case workspace by default. Verified: `bash -n stress-test/container-sweep.sh stress-test/e2e-real.sh stress-test/regression.sh`; Docker core sweep ran against Node npm, Node pnpm, Node yarn dry-run, Python uv, Go dry-run, Rust dry-run, Ruby dry-run, and Astro dry-run. Results: 8/9 READY, 1 genuine INCOMPLETE.
- Found clean-Linux Python `uv` bootstrap failure on `pallets/flask`. Root cause: detection selected `uv sync`, but the clean container had Python/pyenv after runtime install and did not have the `uv` CLI; `wrapForRuntime` only handled Python interpreter availability, not Python package-manager availability. Fix: wrap `uv`, `poetry`, and `pipenv` commands with a guarded `python3 -m pip install --user <tool>` plus `~/.local/bin` PATH export. Regression: `test/shell-quoting.test.ts` now asserts the bootstrap prefix. Verified: local typecheck/tests/build passed; exact clean-container re-run of `pallets/flask` reached READY.
- Found dry-run fatal-path failure on `facebook/react-native`. Root cause: the Gemfile declares `ruby ">= 2.6.10"`, detection stored the raw range in `rubyVersion`, and the shell-injection safety gate correctly rejected the unsafe `>`/space characters before any panel could render. Fix: normalize Gemfile Ruby floor specs to concrete installable tokens before safety validation. Regression: `test/versions.test.ts` covers `normalizeRubyVersion`. Verified: local gate passed with 189 tests; exact clean Linux dry-run of `facebook/react-native` reached READY.
- Verified `--with-services` end-to-end with a throwaway local fixture in `stress-test/with-services-smoke.sh`. The script creates a temporary Prisma/Postgres project on host port 55433, runs `devhelp --with-services`, then queries Postgres to assert the `Smoke` table exists. A first harness attempt accidentally queried a different compose project name and was fixed to use the same compose-file project semantics devhelp uses. Verified: `stress-test/with-services-smoke.sh` passed and only the user-owned `prisma-postgres-1` container remained afterward.
- Found dry-run clone failure misclassification on a nonexistent repo. Root cause: a failed dry-run inspection clone left `nothingDetected=true`, and status/rendering checked unsupported detection before critical failures, so users saw `UNSUPPORTED STACK` instead of a repo/access failure. Fix: record the clone failure as a critical failed step and prioritize `INCOMPLETE` over unsupported detection. Regression: `test/failure-summary.test.ts` covers status priority. Verified: local gate passed with 190 tests; manual dry-run of a nonexistent repo now exits 1 with an actionable clone/auth panel.
- Verified Docker-daemon failure panel without stopping Docker by running a throwaway compose fixture with `DOCKER_HOST=unix:///private/tmp/devhelp-no-docker.sock`. Result: `INCOMPLETE`, cause "Docker isn't running", and fix "Start Docker Desktop..., then re-run devhelp." The user-owned `prisma-postgres-1` container was not touched.
- Re-ran the post-fix core container sweep. Result: 9/9 READY. Cases: `expressjs/express` (Node npm real install), `vitejs/vite` (Node pnpm real install), `facebook/react` (Node yarn dry-run), `pallets/flask` (Python uv real install after clean pyenv-from-source), `astral-sh/uv` (Python uv dry-run), `gohugoio/hugo` (Go dry-run), `sharkdp/bat` (Rust dry-run), `rails/rails` (Ruby dry-run), `withastro/astro` (Node monorepo dry-run). Disk stayed at 6 GB free before/after the sweep.
- Re-ran the post-fix broad Linux dry-run container sweep. Result: 31/31 READY across Node, Python, Go, Rust, Ruby, PHP, Java, Kotlin, Elixir, Swift, Android, React Native, Expo, Haskell, Scala, Clojure, R, Julia, Zig, Nix, and C/C++ representative repos. Disk stayed at 6-7 GB free and per-case workspaces were deleted.
- Found a cleanup robustness gap: dry-run inspection clones were removed only on the normal completion path, so a fatal error after clone/detect could leave the temporary checkout behind. Fix: moved dry-run clone removal into an idempotent `finally` cleanup path. Regression: `test/run-setup.test.ts` covers idempotent cleanup. Verified: local gate passed with 191 tests.

## NEEDS HUMAN

- None yet.
