# Test Fixtures

Each directory is a minimal project used to verify devhelp detection.
Run: `devhelp --dry-run --cwd test-fixtures/<name> "set up"`

| Fixture | Ecosystem | Key test |
|---|---|---|
| ruby-rails | Ruby + Rails | rbenv, bundle install, localhost:3000 |
| ruby-jekyll | Ruby + Jekyll | bundle exec jekyll serve |
| php-laravel | PHP + Laravel | composer install, localhost:8000 |
| php-wordpress | PHP + WordPress | composer install |
| elixir-phoenix | Elixir + Phoenix | mix deps.get, localhost:4000 |
| java-spring | Java + Spring Boot | mvn install, localhost:8080 |
| kotlin-gradle | Kotlin + Gradle + Spring | gradle, JavaVersion 21 |
| dotnet-webapi | .NET 8 + ASP.NET | dotnet restore, localhost:5000 |
| flutter-app | Flutter | flutter pub get, flutter run |
| dart-package | Dart | dart pub get, dart test |
| deno-app | Deno | no npm step, deno task dev |
| bun-runtime | Bun runtime | bun install, no nvm |
| asdf-project | asdf .tool-versions | ruby 3.3.0 pinned |
| broken-python | Broken install | INCOMPLETE panel, exit 1 |
| unsupported | C/CMake | INFORM panel, exit 0 |
| swift-spm | Swift Package Manager | swift package resolve, swift test |
| swift-cocoapods | iOS + CocoaPods | pod install, Xcode required |
| android-app | Android (Gradle + Manifest) | ./gradlew assembleDebug, ANDROID_HOME |
| react-native | RN bare (Node + iOS Podfile) | npm + pod install, Metro bundler |
| expo-app | Expo managed | npx expo start, app.json platforms |
| haskell-stack | Haskell + Stack | GHCup, stack build/test |
| haskell-cabal | Haskell + Cabal | cabal build/test |
| scala-sbt | Scala + sbt | coursier, sbt compile |
| scala-mill | Scala + Mill | ./mill _.compile |
| clojure-deps | Clojure + tools.deps | clojure -P, framework hint |
| clojure-lein | Clojure + Leiningen | lein deps, lein ring server |
| r-renv | R + renv + Shiny | renv::restore(), localhost:3838 |
| r-package | R package + DESCRIPTION | devtools::install_deps + test |
| julia-pkg | Julia Project.toml | juliaup, Pkg.instantiate() |
| zig-project | Zig + build.zig | zvm/brew, zig build |
| ocaml-dune | OCaml + dune + opam | opam install, dune build |
| bazel-project | Bazel WORKSPACE | bazelisk, bazel build //... |
| terraform | Terraform (.tf) | INFORM panel, terraform init/plan/apply |
| ansible | Ansible playbook | INFORM panel, ansible-galaxy + playbook |
| helm-chart | Helm Chart.yaml | INFORM panel, helm lint/template |
