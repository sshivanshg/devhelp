#!/usr/bin/env bash
# Reproducible clean-machine sweep for devhelp.
#
# Runs the built CLI inside one throwaway Docker container per repo. Package
# caches and clones live under stress-test/container-results/<case>/work so each
# case can be deleted immediately on low-disk machines.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${DEVHELP_SWEEP_OUT:-$ROOT/stress-test/container-results}"
IMAGE_CLEAN="${DEVHELP_SWEEP_IMAGE_CLEAN:-node:20-bookworm}"
IMAGE_TOOLS="${DEVHELP_SWEEP_IMAGE_TOOLS:-node:20-bookworm}"
MODE="${1:-core}"
KEEP_WORK="${DEVHELP_SWEEP_KEEP_WORK:-0}"
MIN_FREE_GB="${DEVHELP_SWEEP_MIN_FREE_GB:-3}"
DEVHELP="node /devhelp/dist/cli.js"

mkdir -p "$OUT"
SUMMARY="$OUT/summary.tsv"
: > "$SUMMARY"

core_cases=(
  "clean|node-npm|expressjs/express|"
  "clean|node-pnpm|vitejs/vite|"
  "clean|node-yarn|facebook/react|--dry-run"
  "clean|python-pip|pallets/flask|"
  "clean|python-uv|astral-sh/uv|--dry-run"
  "clean|go|gohugoio/hugo|--dry-run"
  "clean|rust|sharkdp/bat|--dry-run"
  "clean|ruby|rails/rails|--dry-run"
  "tools|node-monorepo|withastro/astro|--dry-run"
)

dry_run_cases=(
  "dry|node-next|vercel/next.js|--dry-run"
  "dry|node-astro|withastro/astro|--dry-run"
  "dry|node-vite|vitejs/vite|--dry-run"
  "dry|node-svelte|sveltejs/kit|--dry-run"
  "dry|node-remix|remix-run/remix|--dry-run"
  "dry|node-express|expressjs/express|--dry-run"
  "dry|python-flask|pallets/flask|--dry-run"
  "dry|python-fastapi|tiangolo/fastapi|--dry-run"
  "dry|python-django|django/django|--dry-run"
  "dry|python-requests|psf/requests|--dry-run"
  "dry|go-hugo|gohugoio/hugo|--dry-run"
  "dry|go-cli|cli/cli|--dry-run"
  "dry|rust-bat|sharkdp/bat|--dry-run"
  "dry|rust-mdbook|rust-lang/mdBook|--dry-run"
  "dry|ruby-rails|rails/rails|--dry-run"
  "dry|php-laravel|laravel/framework|--dry-run"
  "dry|java-spring|spring-projects/spring-petclinic|--dry-run"
  "dry|kotlin-ktor|ktorio/ktor|--dry-run"
  "dry|elixir-phoenix|phoenixframework/phoenix|--dry-run"
  "dry|swift-nio|apple/swift-nio|--dry-run"
  "dry|android-nowinandroid|android/nowinandroid|--dry-run"
  "dry|react-native|facebook/react-native|--dry-run"
  "dry|expo|expo/expo|--dry-run"
  "dry|haskell-pandoc|jgm/pandoc|--dry-run"
  "dry|scala-play|playframework/playframework|--dry-run"
  "dry|clojure-clojure|clojure/clojure|--dry-run"
  "dry|r-shiny|rstudio/shiny|--dry-run"
  "dry|julia-pluto|fonsp/Pluto.jl|--dry-run"
  "dry|zig|ziglang/zig|--dry-run"
  "dry|nix|NixOS/nixpkgs|--dry-run"
  "dry|cpp-neovim|neovim/neovim|--dry-run"
)

free_gb() {
  df -g / | awk 'NR==2{print $4}'
}

image_for() {
  case "$1" in
    tools) printf '%s\n' "$IMAGE_TOOLS" ;;
    *) printf '%s\n' "$IMAGE_CLEAN" ;;
  esac
}

run_case() {
  local family="$1"
  local name="$2"
  local repo="$3"
  local flags="$4"
  local before after image case_dir work_dir log status panel elapsed start code

  before="$(free_gb)"
  printf '=== %s/%s %s (free before: %sG) ===\n' "$family" "$name" "$repo" "$before"
  if [ "${before:-0}" -lt "$MIN_FREE_GB" ]; then
    printf '%s\t%s\tSKIPPED\tlow-disk(%sG)\t-\t-\n' "$family" "$name" "$before" >> "$SUMMARY"
    return 0
  fi

  image="$(image_for "$family")"
  case_dir="$OUT/${family}-${name}"
  work_dir="$case_dir/work"
  log="$case_dir/devhelp.log"
  rm -rf "$case_dir"
  mkdir -p "$work_dir"

  start="$(date +%s)"
  docker run --rm \
    --name "devhelp-sweep-${family}-${name}" \
    -v "$ROOT:/devhelp:ro" \
    -v "$work_dir:/work" \
    -w /work \
    -e npm_config_cache=/work/.cache/npm \
    -e npm_config_store_dir=/work/.cache/pnpm \
    -e YARN_CACHE_FOLDER=/work/.cache/yarn \
    -e PIP_CACHE_DIR=/work/.cache/pip \
    -e PLAYWRIGHT_BROWSERS_PATH=/work/.cache/playwright \
    -e XDG_CACHE_HOME=/work/.cache/xdg \
    -e CARGO_HOME=/work/.cache/cargo \
    -e RUSTUP_HOME=/work/.cache/rustup \
    "$image" \
    bash -lc "$DEVHELP --cwd /work $flags '$repo'" > "$log" 2>&1
  code=$?
  elapsed=$(( "$(date +%s)" - start ))
  panel="$(grep -aoE 'READY|INCOMPLETE|UNSUPPORTED|INFORM|ERROR' "$log" | tail -1 || true)"
  status="PASS"
  if [ "$code" -ne 0 ]; then status="NONZERO"; fi
  if [ -z "$panel" ]; then panel="NO_PANEL"; fi

  if [ "$KEEP_WORK" != "1" ]; then
    rm -rf "$work_dir"
  fi
  after="$(free_gb)"
  printf '%s\t%s\texit=%s\t%s\t%s\t%ss\tfree:%sG->%sG\n' \
    "$family" "$name" "$code" "$status" "$panel" "$elapsed" "$before" "$after" | tee -a "$SUMMARY"
}

select_cases() {
  case "$MODE" in
    core) printf '%s\n' "${core_cases[@]}" ;;
    dry-run) printf '%s\n' "${dry_run_cases[@]}" ;;
    all)
      printf '%s\n' "${core_cases[@]}"
      printf '%s\n' "${dry_run_cases[@]}"
      ;;
    *)
      echo "usage: $0 [core|dry-run|all]" >&2
      return 2
      ;;
  esac
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI is not installed or not on PATH" >&2
  exit 2
fi

while IFS='|' read -r family name repo flags; do
  [ -n "$family" ] || continue
  run_case "$family" "$name" "$repo" "$flags"
done < <(select_cases)

echo "===== SUMMARY ====="
cat "$SUMMARY"
echo "Logs kept in: $OUT"
