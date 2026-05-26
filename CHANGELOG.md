# Changelog

## [Unreleased]

### Removed
- **AI-assisted mode.** devhelp is now fully deterministic — the Claude tool-use loop (`agent.ts`/`tools.ts`), the `@anthropic-ai/sdk` dependency, and the `--yes` / `--model` / `--max-steps` / `--offline` flags are gone. Setup is pure rules + lockfile reading, with no LLM and no network calls to AI providers.

### Fixed
- **zsh glob crash on `lts/*`.** Node version tokens like `lts/*` were interpolated unquoted into `nvm install`/`nvm use`; under zsh (the macOS default shell) the `*` glob-expanded and failed with `zsh: no matches found`, breaking setup for any Node repo without an explicit version pin. Version tokens are now quoted. Regression-guarded in `test/shell-quoting.test.ts`.

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
