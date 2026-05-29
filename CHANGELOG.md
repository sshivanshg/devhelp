# Changelog

## [Unreleased]

### Changed
- Renamed the internal setup runner module from the legacy AI-era naming to `setup.ts` (`runSetup` / `SetupOptions`) with no behavior change.

### Fixed
- Python `uv`/`poetry`/`pipenv` installs now bootstrap the missing tool CLI on clean machines before running the project install command. Verified with a clean Linux container real run of `pallets/flask`.
- Ruby versions declared as Gemfile floor requirements (for example `ruby ">= 2.6.10"`) now normalize to an installable version token instead of tripping the shell-safety gate. Verified with a clean Linux dry-run of `facebook/react-native`.
- Dry-run clone failures now report `INCOMPLETE` with the real clone/access cause instead of falling through to an `UNSUPPORTED STACK` panel.
- Dry-run inspection clones are now removed from a `finally` cleanup path, so fatal errors after clone/detect do not leave temporary checkouts behind.

## [0.6.0] — 2026-05-28

First public beta. devhelp clones a repo and gets you to a running dev environment for conventional Node/Python/Go/Rust projects; when it can't finish, it tells you exactly what's missing. Deterministic — no LLM, no API keys, no telemetry.

### Changed
- **Failure panel never dead-ends.** When a step fails, the INCOMPLETE panel now shows, per failure, *what* failed, *why* (the real cause line pulled from the output, not the "Command failed (exit 1)" banner), and a concrete *fix* — a matched remediation, a stack-specific hint, or the exact command to re-run (unwrapped from the nvm/runtime preamble). The old generic "Check the log above for details" is gone. Recovery rules now cover the common execution-path stalls: Docker not running, database unreachable (P1001), missing Prisma schema, conflicting `.env` files, port in use, no disk space, network/registry failures.
- **Fatal errors are diagnosed, not dumped.** Errors thrown outside the step framework (a failed clone, the security gate) used to print the raw multi-page error — for a clone that meant a wall of git progress output with the real cause buried at the end. They now go through the same what/why/fix treatment and always end in an actionable line.
- **Cleaner cause extraction.** Captured output is ANSI-stripped, progress/download chatter is filtered out before choosing the cause line, the tail kept on failure grew from 12→25 lines so the real error survives noisy installers, and a killed/timed-out process now reports "timed out after 10m" / "killed by SIGKILL" instead of "exit undefined".

### Added
- **`npm ci` falls back to `npm install` on an out-of-sync lockfile.** `npm ci` aborts (EUSAGE) when a repo's committed `package-lock.json` drifts from its `package.json` — common in fast-moving monorepos (hit on `documenso/documenso`). For onboarding, reaching a working install beats lockfile purity, so devhelp now retries once with `npm install` and records a warning. The fallback is narrow: only `npm ci`, only on a lockfile-sync error — unrelated failures (network, build scripts) still surface honestly.
- **Progress notes on slow steps.** Long-running steps that go quiet — pyenv compiling Python from source (minutes), downloading Node, installing a large monorepo's dependencies — now carry an upfront note in the step title so the silence reads as "working", not "hung". No fabricated ETAs; the note just says what's happening and that it's slow, and the last line of live output still streams below it.
- **Automatic clone retry on transient network errors.** Mid-transfer disconnects (`curl 56/92`, `early EOF`, `RPC failed`, connection reset) are retried once automatically — the partial clone is removed first. Since clones are shallow this is cheap, and it turns the most common flaky failure into a non-event. Non-network failures (bad URL, no access) are not retried.

### Fixed
- **Full clone failed on large repos.** The real (non-dry-run) clone fetched complete history, so huge repos (e.g. `calcom/cal.diy`, 400k+ objects) hit HTTP/2 pack-transfer disconnects (`curl 92 … fetch-pack: invalid index-pack output`) and aborted setup. Clones are now shallow (`--depth 1`) — faster and disconnect-resistant; history can be restored with `git fetch --unshallow`.
- **`--secrets` 1Password path quoting.** The `op inject -i <template>` command interpolated the template path unquoted, so a template path containing spaces or shell metacharacters would break or mis-parse. The path is now quoted.
- **`prisma generate`/`migrate` failed in monorepos with a relative `--schema`.** When a nested workspace package also carries a `prisma` field (e.g. `packages/prisma/package.json`), Prisma resolved the relative schema path against that package's directory instead of the repo root and reported `file or directory not found` (notably under yarn berry). The schema path is now passed absolute.
- **Wrong docker compose started for host dev.** Setup ran every detected compose file, including full-stack app composes (those with a `build:` directive) whose DB isn't published to the host — so migrations couldn't reach the database. Auto-start now targets only pure service-dependency composes (Postgres/Redis/Mailhog, no `build:`), falling back to all only when every compose builds the app. Manual hints name the right file with `-f`.
- **Local-DB hint missed custom ports.** The "DATABASE_URL points at localhost" warning only matched ports 5432/6379/27017; it now matches datastore connection URLs by scheme, so custom ports (e.g. `localhost:5450`) are flagged too.
- **Python pip/venv setup failed on macOS (`command not found: python`).** The venv-bootstrap path ran bare `python -m venv`, but the non-interactive login shell devhelp spawns doesn't load pyenv's shims (pyenv init lives in `.zshrc`), and macOS ships no `python` — only `python3`. The command now uses `python3` and is wrapped to load pyenv and pin the installed version, so the interpreter resolves. Caught by a real `tiangolo/fastapi` run, which now reaches READY. (uv/poetry paths were unaffected — they self-manage their interpreter.)
- **Python version resolved to unreleased versions.** CI workflows commonly list a pre-release row in their `python-version` matrix (e.g. `"3.15"`); devhelp picked the max and then tried to `pyenv install` a version that doesn't exist (seen on `psf/requests`). CI-derived versions are now capped at the latest known stable, falling through to the constraint / latest-stable logic if every hint is unreleased.

### Removed
- **AI-assisted mode.** devhelp is now fully deterministic — the Claude tool-use loop (`agent.ts`/`tools.ts`), the `@anthropic-ai/sdk` dependency, and the old AI-mode flags are gone. Setup is pure rules + lockfile reading, with no LLM and no network calls to AI providers.

### Fixed
- **zsh glob crash on `lts/*`.** Node version tokens like `lts/*` were interpolated unquoted into `nvm install`/`nvm use`; under zsh (the macOS default shell) the `*` glob-expanded and failed with `zsh: no matches found`, breaking setup for any Node repo without an explicit version pin. Version tokens are now quoted. Regression-guarded in `test/shell-quoting.test.ts`.
- **`doctor` false mismatch on `>=` engines.** A `>=N` lower bound (e.g. `engines.node: ">=18"`) was compared as an exact pin, so a newer installed runtime (v20) was wrongly flagged as a mismatch and exited non-zero — a false alarm for the CI use case. Floors are now satisfied by any newer version; exact pins, carets, and tildes still compare strictly. Regression tests in `test/versions.test.ts`, `test/doctor-version.test.ts`, `test/detect-node.test.ts`.
- **`--dry-run` showed nothing useful.** Dry-run skipped the clone, so detection always saw an empty directory and reported `UNSUPPORTED`. It now does a shallow clone to inspect the real manifests, prints an accurate plan, and removes the clone before exiting so the working directory is left untouched.
- **`--vscode` ran on unrecognized stacks.** The launch.json step is now skipped when nothing is detected, instead of offering to write a config for an `UNSUPPORTED` project.
- **`--version` was hardcoded.** The CLI version is now read from `package.json` rather than a literal, so it tracks releases automatically. The three duplicate version readers are consolidated into one `pkgVersion()`.

### Security
- Version/toolchain strings read from cloned manifests are validated before being interpolated into shell commands; values containing shell metacharacters are refused, closing a command-injection vector. New "Security / trust model" section in the README.

### Added
- **`--verify`**: after a `READY` setup, runs the test command and boots the dev server, polling the real dev URL for a response, then tears the server down. Reports pass/fail in the panel and exits non-zero if a check fails (useful in CI). Operationalizes the project's "did `pnpm dev` actually work afterwards?" metric per-run.
- **`--with-services`**: opt-in `docker compose up -d --wait` for detected compose files, followed by database migrations. Default behaviour is unchanged — services are only surfaced unless the flag is passed. Falls back to legacy `docker-compose` (v1, no `--wait`) when Compose v2 isn't present.
- **Multi-ORM DB provisioning** under `--with-services`: Prisma (`migrate deploy` + seed), Drizzle (`drizzle-kit migrate`), Django (`manage.py migrate`, with the right venv/poetry/uv/pipenv prefix), and Rails (`db:prepare`). Ecto is already covered by the Phoenix `mix ecto.setup` install step.
- **`.devhelp.lock` drift detection**: when a lock is present, detection is compared against it and any drift (changed/added/removed runtime, package-manager switch) is surfaced as a warning.
- **`doctor` version-mismatch flagging**: reports `⚠` and exits non-zero when an installed runtime's version disagrees with what the repo wants (at the granularity of the wanted spec), not just present/absent.
- **`--fix`**: auto-recovery for native-build failures. On a matching error (node-gyp Python, OpenSSL/pkg-config), installs the missing system package via the detected OS package manager and retries the failed step once.
- **`--write-lock`**: writes a `.devhelp.lock` pinning the concrete resolved runtime versions, package manager, and install commands for reproducible/shareable setups.
- **`--json`**: machine-readable run output (status, detected stack, steps, failures, verify results) for CI and automation. Suppresses the panels and uses a silent task renderer.
- **`--vscode`**: generate a `.vscode/launch.json` for the detected stack (node-terminal for the dev command, debugpy for Django/FastAPI/Flask). Never overwrites an existing config.
- **`--secrets`**: populate `.env` from a detected secrets provider — 1Password (`op inject` when the template has `op://` refs) or Doppler (`doppler secrets download` when `doppler.yaml` is present). Opt-in; relies on the provider CLI being signed in. Like the env-template copy, it won't overwrite a `.env` you already had — only one devhelp created from the template this run.
- **`devhelp mcp`**: run devhelp as an MCP server over stdio, exposing `detect` and `doctor` as tools. Hand-rolled JSON-RPC 2.0, no new dependency.
- **Windows handling**: cross-platform command probing (`where` vs `command -v`) and a clear up-front guard recommending WSL/Git Bash when native Windows lacks a bash-compatible shell, instead of cryptic per-step failures. (Full native Windows support remains on the roadmap.)
- **`devhelp doctor`**: read-only diagnosis of the current checkout — detected stack vs. what's installed on PATH, plus service/env/prisma needs — without cloning or mutating anything. Supports `--json`.
- **`.devhelp.yml` recipes**: a repo can declare `postInstall:` steps and `dev`/`test`/`build` overrides, merged into the playbook (parsed with a dependency-free YAML subset reader).
- System package-manager detection (`apt`/`dnf`/`yum`/`pacman`/`zypper`/`apk`/`brew`) with logical→package mapping (`src/platform.ts`), backing `--fix`.
- Fixture-driven detection tests (`test/detect-fixtures.test.ts`) asserting the expected stack for every fixture in `test-fixtures/`, run in CI.

## [0.4.0] — 2026-05-23

### Added — 14 new ecosystems (~99% OSS coverage)
- **Swift / iOS / macOS**: SPM, CocoaPods, Carthage, Xcode projects. swiftenv installer on macOS, swiftly hint on Linux. Targets parsed from Package.swift. Xcode required for iOS targets.
- **Android native**: Gradle + AndroidManifest detection, ANDROID_HOME check, surfaces `./gradlew assembleDebug` + test commands.
- **React Native**: hybrid Node + CocoaPods coordination — `npm/yarn install` then `cd ios && pod install`. Metro bundler dev command.
- **Expo**: managed workflow with `npx expo start` and platform targets from app.json.
- **Haskell**: Stack and Cabal. GHCup installer, GHC version inferred from `resolver:` line. `stack/cabal build`+`test`.
- **Scala**: sbt, Mill, and Maven. Coursier (`cs`) installer. Framework detection: Play, Akka HTTP, http4s, Spark, ZIO.
- **Clojure**: tools.deps (deps.edn), Leiningen (project.clj), shadow-cljs. Ring/Compojure/Pedestal/Luminus framework detection.
- **R**: renv lockfile and R-package DESCRIPTION. `rig` installer on macOS. Shiny app detection → port 3838.
- **Julia**: Project.toml + Manifest.toml. `juliaup` installer. `Pkg.instantiate()` + Web app detection.
- **Zig**: build.zig + build.zig.zon. `zvm`/brew installer. Custom `run`/`test` step detection.
- **OCaml**: opam + dune. opam switch + dune install. `.ocamlversion` file support.
- **Bazel**: WORKSPACE detection adds Bazel as build layer. `bazelisk` installer. Languages parsed from rules.
- **Nx**: `nx.json` workspace surfaces `npx nx serve`/`run-many` commands.
- **Infrastructure (INFORM)**: Terraform (`.tf` + `.terraform-version`), Ansible (playbook.yml + requirements.yml), Helm (Chart.yaml), Pulumi (Pulumi.yaml). INFO panels with the right commands. No auto-install — these need human judgment.

### Improvements
- asdf `.tool-versions` now supports `swift`, `haskell`, `scala`, `ocaml`, `julia`, `zig`, `r`.
- READY panel: when an ecosystem has a build command but no dev command (compiled languages: OCaml, Android, Haskell), the build command shows in the panel instead of being hidden.
- UNRECOGNIZED_MANIFEST_FILES pruned — manifests now handled by detectors no longer false-trigger the "unrecognized" path.

### Coverage table
29 ecosystems total. Full install+detect for 21 of them; INFORM-only panels for 8 where auto-install would be premature (C/C++, Nix, Terraform, Ansible, Helm, Pulumi, plus partial Bazel and Android-SDK).

## [0.3.0]

### Added — Ruby, PHP, Elixir, Java/Kotlin, .NET, Dart/Flutter, Deno, Bun
- Ruby/Rails/Jekyll/Sinatra via rbenv + bundle
- PHP/Laravel/Symfony/WordPress via brew/composer
- Elixir/Phoenix via asdf (Erlang + Elixir)
- Java/Kotlin/Spring Boot via Maven or Gradle
- .NET via dotnet-install or brew
- Dart and Flutter (with fvm)
- Deno (deno.json/jsonc + import maps)
- Bun as runtime (skips Node install entirely)
- asdf/mise `.tool-versions` parsing
- C/C++ INFORM panel (CMake, Make, Meson, Autotools)
- Nix INFORM panel (flake, shell, default)

## [0.2.0]
- Initial release: Node/JS/TS, Python, Rust, Go
- Frameworks: Next.js, Nuxt, Remix, Astro, SvelteKit, Vite, Angular, Expo, RN, NestJS, Express, Hono, Fastify
- Python: Poetry, uv, pipenv, pip
- Prisma generation, Playwright install, env templates, Docker Compose hint
