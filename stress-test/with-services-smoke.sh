#!/usr/bin/env bash
# Local end-to-end smoke for --with-services:
# compose up -> prisma generate -> prisma migrate deploy -> verify table exists.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d /private/tmp/devhelp-services-smoke.XXXXXX)"
PORT="${DEVHELP_SERVICES_PORT:-55433}"
LOG="$WORK/devhelp.log"

cleanup() {
  docker compose -f "$WORK/docker-compose.yml" down -v >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
finish() {
  local status=$?
  if [ "$status" -ne 0 ] && [ -f "$LOG" ]; then
    echo "with-services smoke failed; devhelp log:" >&2
    sed -n '1,260p' "$LOG" >&2
  fi
  cleanup
  exit "$status"
}
trap finish EXIT

mkdir -p "$WORK/prisma/migrations/20260529000000_init" "$WORK/.cache"

cat > "$WORK/package.json" <<'JSON'
{
  "name": "devhelp-services-smoke",
  "private": true,
  "scripts": {
    "build": "node -e \"console.log('build')\"",
    "test": "node -e \"console.log('ok')\""
  },
  "dependencies": {
    "@prisma/client": "^6.8.2"
  },
  "devDependencies": {
    "prisma": "^6.8.2"
  }
}
JSON

cat > "$WORK/.env.example" <<EOF_ENV
DATABASE_URL="postgresql://postgres:postgres@localhost:${PORT}/devhelp_smoke?schema=public"
EOF_ENV

cat > "$WORK/prisma/schema.prisma" <<'PRISMA'
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Smoke {
  id   Int    @id @default(autoincrement())
  name String
}
PRISMA

cat > "$WORK/prisma/migrations/20260529000000_init/migration.sql" <<'SQL'
CREATE TABLE "Smoke" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL
);
SQL

cat > "$WORK/docker-compose.yml" <<EOF_COMPOSE
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: devhelp_smoke
    ports:
      - "127.0.0.1:${PORT}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d devhelp_smoke"]
      interval: 1s
      timeout: 5s
      retries: 30
EOF_COMPOSE

export npm_config_cache="$WORK/.cache/npm"
export npm_config_store_dir="$WORK/.cache/pnpm"
export YARN_CACHE_FOLDER="$WORK/.cache/yarn"
export PLAYWRIGHT_BROWSERS_PATH="$WORK/.cache/playwright"

node "$ROOT/dist/cli.js" --with-services --cwd "$WORK" "set up this project" > "$LOG" 2>&1

applied="$(
  docker compose -f "$WORK/docker-compose.yml" exec -T db \
    psql -U postgres -d devhelp_smoke -tAc "select to_regclass('public.\"Smoke\"') is not null"
)"

if [ "$applied" != "t" ]; then
  echo "Migration did not create Smoke table" >&2
  sed -n '1,220p' "$LOG" >&2
  exit 1
fi

echo "PASS: --with-services applied Prisma migration and Smoke table exists"
