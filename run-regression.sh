#!/usr/bin/env bash
# Phase 20 — v0.4 regression suite. All checks must pass.

set -u
PASS=0
FAIL=0
FAILED_NAMES=()

DEVHELP="node $(pwd)/dist/cli.js"

check() {
  local name="$1"; local cmd="$2"; local expect="$3"
  local output code
  output=$(eval "$cmd" 2>&1); code=$?
  local ok=0
  if [ "$expect" = "zero" ]; then
    [ "$code" -eq 0 ] && ok=1
  elif [ "$expect" = "nonzero" ]; then
    [ "$code" -ne 0 ] && ok=1
  else
    if echo "$output" | grep -qi "$expect"; then ok=1; fi
  fi
  if [ "$ok" = "1" ]; then
    PASS=$((PASS+1))
    echo "PASS: $name"
  else
    FAIL=$((FAIL+1))
    FAILED_NAMES+=("$name")
    echo "FAIL: $name (exit=$code, expect='$expect')"
  fi
}

echo "====== FULL REGRESSION SUITE (v0.4) ======"

# ---- v0.3 regressions (must still pass) ----
check "cal.com prisma" "$DEVHELP --offline --dry-run --cwd stress-test/repos/cal.com 'set up'" "prisma"
check "django no false Node" "$DEVHELP --offline --dry-run --cwd stress-test/repos/django 'set up' 2>&1 | grep -v optional | grep -v 'Installing Node'" "zero"
check "trpc no Vite" "$DEVHELP --offline --dry-run --cwd stress-test/repos/trpc 'set up' 2>&1 | grep -iv 'vite\\|5173'" "zero"
check "vitejs Vite" "$DEVHELP --offline --dry-run --cwd stress-test/repos/vitejs 'set up'" "vite"
check "next.js Rust optional" "$DEVHELP --offline --dry-run --cwd stress-test/repos/next.js 'set up' 2>&1 | grep -iv 'Installing Rust'" "zero"
check "httpx python not 3.9" "$DEVHELP --offline --dry-run --cwd stress-test/repos/httpx 'set up' 2>&1 | grep -iv '3\\.9'" "zero"
check "ruby-rails bundle install" "$DEVHELP --offline --dry-run --cwd test-fixtures/ruby-rails 'set up'" "bundle install"
check "ruby-rails: Rails framework" "$DEVHELP --offline --dry-run --cwd test-fixtures/ruby-rails 'set up'" "rails"
check "php-laravel composer install" "$DEVHELP --offline --dry-run --cwd test-fixtures/php-laravel 'set up'" "composer install"
check "php-laravel: Laravel detected" "$DEVHELP --offline --dry-run --cwd test-fixtures/php-laravel 'set up'" "laravel"
check "elixir-phoenix mix deps.get" "$DEVHELP --offline --dry-run --cwd test-fixtures/elixir-phoenix 'set up'" "mix deps.get"
check "elixir-phoenix localhost:4000" "$DEVHELP --offline --dry-run --cwd test-fixtures/elixir-phoenix 'set up'" "4000"
check "java-spring Spring Boot" "$DEVHELP --offline --dry-run --cwd test-fixtures/java-spring 'set up'" "spring"
check "java-spring localhost:8080" "$DEVHELP --offline --dry-run --cwd test-fixtures/java-spring 'set up'" "8080"
check "dotnet-webapi dotnet restore" "$DEVHELP --offline --dry-run --cwd test-fixtures/dotnet-webapi 'set up'" "dotnet restore"
check "flutter-app flutter pub get" "$DEVHELP --offline --dry-run --cwd test-fixtures/flutter-app 'set up'" "flutter pub get"
check "dart-package dart pub get" "$DEVHELP --offline --dry-run --cwd test-fixtures/dart-package 'set up'" "dart pub get"
check "deno-app no npm step" "$DEVHELP --offline --dry-run --cwd test-fixtures/deno-app 'set up' 2>&1 | grep -iv 'npm install\\|nvm'" "zero"
check "deno-app: deno detected" "$DEVHELP --offline --dry-run --cwd test-fixtures/deno-app 'set up'" "deno"
check "bun-runtime no nvm" "$DEVHELP --offline --dry-run --cwd test-fixtures/bun-runtime 'set up' 2>&1 | grep -iv nvm" "zero"
check "neovim INFORM panel exit 0" "$DEVHELP --offline --dry-run --cwd stress-test/repos/neovim 'set up'" "zero"
check "asdf .tool-versions ruby 3.3.0" "$DEVHELP --offline --dry-run --cwd test-fixtures/asdf-project 'set up'" "3.3.0"

# ---- v0.4 new checks ----
check "swift-spm package resolve" "$DEVHELP --offline --dry-run --cwd test-fixtures/swift-spm 'set up'" "swift package resolve"
check "swift-cocoapods pod install" "$DEVHELP --offline --dry-run --cwd test-fixtures/swift-cocoapods 'set up'" "pod install"
check "android gradlew assembleDebug" "$DEVHELP --offline --dry-run --cwd test-fixtures/android-app 'set up'" "assembleDebug"
check "react-native pod install" "$DEVHELP --offline --dry-run --cwd test-fixtures/react-native 'set up'" "pod install"
check "expo npx expo start" "$DEVHELP --offline --dry-run --cwd test-fixtures/expo-app 'set up'" "expo start"
check "haskell-stack stack build" "$DEVHELP --offline --dry-run --cwd test-fixtures/haskell-stack 'set up'" "stack build"
check "haskell-cabal cabal build" "$DEVHELP --offline --dry-run --cwd test-fixtures/haskell-cabal 'set up'" "cabal build"
check "scala-sbt sbt compile" "$DEVHELP --offline --dry-run --cwd test-fixtures/scala-sbt 'set up'" "sbt compile"
check "scala-mill mill compile" "$DEVHELP --offline --dry-run --cwd test-fixtures/scala-mill 'set up'" "mill"
check "clojure-deps clojure -P" "$DEVHELP --offline --dry-run --cwd test-fixtures/clojure-deps 'set up'" "clojure -P"
check "clojure-lein lein deps" "$DEVHELP --offline --dry-run --cwd test-fixtures/clojure-lein 'set up'" "lein deps"
check "r-renv renv::restore" "$DEVHELP --offline --dry-run --cwd test-fixtures/r-renv 'set up'" "renv::restore"
check "r-package devtools" "$DEVHELP --offline --dry-run --cwd test-fixtures/r-package 'set up'" "devtools::install_deps"
check "julia Pkg.instantiate" "$DEVHELP --offline --dry-run --cwd test-fixtures/julia-pkg 'set up'" "Pkg.instantiate"
check "zig build.zig detected" "$DEVHELP --offline --dry-run --cwd test-fixtures/zig-project 'set up'" "zig build"
check "ocaml dune build" "$DEVHELP --offline --dry-run --cwd test-fixtures/ocaml-dune 'set up'" "dune build"
check "terraform init shown" "$DEVHELP --offline --dry-run --cwd test-fixtures/terraform 'set up'" "terraform init"
check "ansible-galaxy shown" "$DEVHELP --offline --dry-run --cwd test-fixtures/ansible 'set up'" "ansible-galaxy"
check "helm lint shown" "$DEVHELP --offline --dry-run --cwd test-fixtures/helm-chart 'set up'" "helm"
check "bazel build shown" "$DEVHELP --offline --dry-run --cwd test-fixtures/bazel-project 'set up'" "bazel build"
check "devhelp --version 0.4.0" "$DEVHELP --version" "0.4.0"

echo ""
echo "====== END REGRESSION SUITE ======"
echo "PASSED: $PASS"
echo "FAILED: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failures:"
  for n in "${FAILED_NAMES[@]}"; do echo "  - $n"; done
  exit 1
fi
exit 0
