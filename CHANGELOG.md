# Changelog

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
