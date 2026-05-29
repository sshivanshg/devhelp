# Hardening Log

## Status — 2026-05-29

The earlier two-agent hardening session has concluded; this branch is now being
finished by a single pass. All work from that session is committed (see `git log`
on `hardening-production-readiness` after `e22daf1`). The follow-up pass added the
remaining clean-machine PATH preambles (Elixir/Java/Scala/Haskell/.NET/Julia/
OCaml/Zig) and cleared the old "NEEDS HUMAN" list — both documented below.

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
- Found a publish bug: the tarball shipped a stale `dist/offline.js` (+ map, ~170 kB) left over from the `offline`→`setup` rename, because `tsc` never deletes the output of a removed source file. Fix: added a cross-platform `clean` npm script (`node -e "fs.rmSync('dist',…)"`) and made `build` run it first. Verified: `npm pack --dry-run` now ships only `dist/setup.js`; package size dropped 133 kB → 100 kB; build/typecheck/tests still green.
- Found a silent-fallback footgun: a request with no parseable repo (a typo like `facbook/react`, or any non-repo text) fell straight through to setting up the **current directory** with no indication, so devhelp could start installing runtimes and running `npm ci` in whatever directory the user was in. Fix: `runCloneStep` now prints an explicit "No repo in your request — setting up the current directory: <path>" notice (with a hint to pass owner/repo) before proceeding. Behavior for the legitimate "run inside a checkout" case is unchanged, just visible. Verified manually via `--dry-run` on garbage input.
- Found the clean-machine PATH bug class extends to Go, Rust, and Ruby real installs (previously only dry-run tested, so command-not-found never surfaced). Root cause: `wrapForRuntime` only added runtime PATH/init for Node and Python. Go on Linux installs to `/usr/local/go/bin` (installGo only warns, doesn't export); cargo lives in `~/.cargo/bin`; rbenv shims need `rbenv init` — none are on PATH in the fresh `bash -lc` the deps step spawns, so `go mod download` / `cargo build` / `bundle install` would die with "command not found". Fix: added self-guarded preambles in `wrapForRuntime` for `go*` (prepend `/usr/local/go/bin`), `cargo*` (source `~/.cargo/env`), and `bundle|gem|ruby|rake|rails` (init rbenv); each is a no-op when the tool is already on PATH (brew/macOS) or the manager is absent. Regression: `test/shell-quoting.test.ts` adds 4 tests. Verified: 195 tests green; confirmed in the real flow via local go.mod/Cargo.toml/Gemfile fixtures run through `--dry-run` (current-dir mode), each deps command now carries the correct preamble.
- Restored a missing `@rolldown/binding-darwin-arm64` optional dependency (vitest 4 native binding) that npm had pruned (npm bug #4828), which had broken `vitest run` with a startup error; `npm install` re-added it and also synced the stale `package-lock.json` version `0.4.0` → `0.6.0`.
- Extended the PATH fix to Bun and Deno. Bun is the sharpest case: a bun-runtime project sets no `nodeVersion`, so `bun install` never matched the nvm branch and passed through completely unwrapped — and bun's installer drops it in `~/.bun/bin`, off PATH in the fresh login shell. Fix: a dedicated `bun`/`bunx` branch (moved bun out of the node regex, since bun is self-contained and needs no nvm) prepending `~/.bun/bin`, and a `deno` branch prepending `~/.deno/bin`. Regression: 2 more `shell-quoting` tests (197 total). Verified in the real flow via local `bun.lockb` and `deno.json` fixtures.

- Ran a real clean-Linux Go install (not dry-run) for the first time and it exposed two Verified-tier bugs the dry-run sweeps couldn't: (1) `installGo` hardcoded `go${version}.linux-amd64.tar.gz`, so on the arm64 test container the x86_64 `go` binary died with `rosetta error: failed to open elf at /lib64/ld-linux-x86-64.so.2` (SIGTRAP); (2) the URL was built from the go.mod `go` directive, which is a *minimum language version* — `go 1.22` → `go1.22.linux-….tar.gz` 404s (the real first release is `go1.22.0`), and `go 1.7` predates modules so `go mod download` can't run. Fix: detect arch via `uname -m` and install the latest stable Go (`https://go.dev/VERSION?m=text`), which satisfies any floor and matches the macOS brew-latest path; also `sudo` only when not root (root containers/CI lack `sudo`). The PATH preamble from the previous pass was confirmed working in the same run (go resolved; no command-not-found). Verified: `julienschmidt/httprouter` reached **READY** in a real arm64 `node:20-bookworm` container. 197 tests green.

- Ran a real clean-Linux Rust install. The `~/.cargo/env` PATH preamble from the earlier pass was confirmed working (cargo resolved — the error was "rustup could not choose a version of cargo," i.e. found-but-no-default, not command-not-found). The rustup install itself failed in my harness only because I had pointed `RUSTUP_HOME`/`CARGO_HOME` at a virtiofs bind mount, where rustup's component hardlink/rename ops fail — a test-setup artifact, not a devhelp bug (a real machine uses the local fs).
- That same Rust run exposed a real failure-panel UX bug: a failed `cargo build` printed the fix "Install Go manually from https://go.dev/dl/". Root cause: `hintFor` matched step names with naive substring `lower.includes("go")`, and "car**go** build" contains "go"; meanwhile the deps hint checked for "dependencies" but the actual step title is "Installing deps · …", so it never matched. Fix: check the deps step first (so a deps failure points at re-running the install command, not reinstalling a runtime) and switch the runtime matches to word boundaries (`/\bgo\b/`, etc.). Exported `remedyFor`; `test/failure-summary.test.ts` adds 3 tests (cargo≠go, correct runtime hints, recovery precedence). Verified: 200 tests green.
- The Rust "rustup could not choose a version of cargo" error (seen above) is also reachable on a real machine: `installRust`'s already-have-rustup branch ran `rustup toolchain install ${toolchain}` but never selected it, so a rustup with no default (e.g. installed `--default-toolchain none`) leaves cargo unable to pick a toolchain. Fix: also `rustup override set ${toolchain}` — project-scoped (doesn't touch the global default), and superseded by any repo `rust-toolchain.toml`. The fresh-install branch already pins via `--default-toolchain`. `toolchain` is validated by the version-safety gate, so interpolation is safe.

## Best-effort PATH risks — now hardened (2026-05-29, follow-up pass)

The clean-machine PATH class that was fixed for Node/Python/Go/Rust/Ruby/Bun/Deno is now extended to the remaining best-effort ecosystems. `wrapForRuntime` gained self-guarded preambles (no-op when the tool is already on PATH or its manager is absent):
- **Elixir** (`mix`) → `~/.asdf/shims` on PATH (asdf init usually lives in `~/.bashrc`, which a login shell skips).
- **Java/Kotlin** (`mvn`/`gradle` + `./mvnw`/`./gradlew`) → source `~/.sdkman/bin/sdkman-init.sh` (and asdf shims); the wrappers fetch their own build tool but still need a JDK.
- **Scala** (`sbt`/`mill`/`scala`/`cs`) → `~/.local/share/coursier/bin` + SDKMAN + asdf (need a JVM too). `installScala`'s `cs install …` calls also get the Coursier preamble since `cs setup` only edits `~/.profile`.
- **Haskell** (`stack`/`cabal`/`ghc`) → source `~/.ghcup/env` (mirrors rust's `~/.cargo/env`).
- **.NET** (`dotnet`) → `~/.dotnet` on PATH + `DOTNET_ROOT` (dotnet-install.sh's dir, which `installDotnet` only warned about).
- **Julia** (`julia`) → `~/.juliaup/bin`. `installJulia`'s `juliaup add` (run in a new shell after the curl install) also gets the preamble.
- **OCaml** (`dune`/`opam`) → `eval $(opam env)` for the active switch.
- **Zig** (`zig`) → glob `~/.local/share/zig-*` onto PATH (arch/version aren't known to `wrapForRuntime`, so a glob replaces the old `~/.bashrc` append that a login shell never sources).

Validation: each wrapped command is syntactically valid bash; each preamble is a clean no-op against a bare `$HOME` (the guard fails, the real command still runs) and correctly resolves the tool when its install dir is present (verified for the two trickiest — `dotnet`'s `&& { … }` group and Zig's glob loop). Regression: `test/shell-quoting.test.ts` "PATH for best-effort ecosystems" (9 cases). Still **best-effort** in the README sense: these have shell-level proof but not yet a full real clean-machine install per ecosystem (that needs a container run each).

- **Scala (arch)** — already resolved earlier this branch: `installScala` selects the launcher via `coursierArch()` (`cs-aarch64-pc-linux.gz` on arm64), guarded by `test/shell-injection.test.ts`. (Clojure's `linux-install.sh` is arch-independent.)

## Agent B — security pass (shell injection via repo-controlled paths)

Coordinating alongside the PATH-hardening pass above. This pass is orthogonal (touches `composeUpCommand`, `prismaGenerate`, `dbProvision`, `secretsCommand`, and adds `shellQuote` to `platform.ts`) — no overlap with the runtime/PATH installers.

- Found a shell-injection gap the version-string gate (`findUnsafeVersionField`) does **not** cover: it only validates fields whose name ends in `version`/`toolchain`/`sdk`, but **repo-derived file *paths*** are interpolated into `bash -lc` strings unquoted. A cloned repo controls its own directory names, so a monorepo with `apps/$(cmd)/prisma/schema.prisma` or `apps/$(cmd)/docker-compose.yml` achieves command execution during the normal Prisma step (`prisma generate --schema <path>`) or `--with-services` (`docker compose -f <file>`), and `--secrets` (`op inject -i <template>`). This contradicts the README's "version strings are validated… closing a shell-injection vector" claim, since paths weren't covered. Fix: added `shellQuote()` (safe-token passthrough so clean paths stay readable; single-quote-escape otherwise) and applied it to the Prisma `--schema` path (generate + migrate deploy), the compose `-f` file, and the 1Password `-i` template. Regression: `test/shell-injection.test.ts` (shellQuote + composeUpCommand) and updated `test/vscode-secrets.test.ts` 1Password assertion + an injection case.
- Hardened the Doppler `--secrets` path: `doppler secrets download … > .env` truncated `.env` the moment the shell opened it, so a failed/partial download corrupted the file. Now downloads to `.env.devhelp.tmp` and `mv`s it into place only on success. Regression in `test/vscode-secrets.test.ts`.
- Verified: `npx tsc --noEmit` clean; `npx vitest run` 208 tests green (was 200).

## Previously-flagged items — resolved (2026-05-29 follow-up)

The earlier "NEEDS HUMAN" list (written during the two-agent session) is now cleared; that session has concluded and the tree is being hardened by a single pass:
- **Zig `~/.bashrc`** — fixed via the `ZIG_PREAMBLE` glob in `wrapForRuntime` (see the PATH section above).
- **`verify.ts` shell + kill** — reviewed and left as-is: the dev-server probe spawns `detached: true` (own process group) and `killProcessTree` signals the negative pid (SIGTERM then SIGKILL after 2s), correctly tearing down the server's child tree; the test command runs with the same shell selection as the install steps. No bug found.
- **`--dry-run` doc accuracy** — verified accurate: every mutating step (`setupEnv`, `writeDevhelpLock`, `writeVscodeLaunch`, `startServices`, `prismaGenerate`, `dbProvision`, `populateSecrets`) is gated on `ctx.dryRun`/short-circuits in `runShell`, and the only thing dry-run touches is its own throwaway shallow clone (removed in `finally`), exactly as the README's "Security / trust model" section states.

Remaining genuinely-open item (not a blocker): the best-effort ecosystems now have shell-level PATH proof but not a full real clean-machine install each — see the PATH section. Native Windows is still WSL/Git-Bash only.
