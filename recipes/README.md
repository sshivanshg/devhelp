# Bundled recipe registry

These are curated `.devhelp.yml` recipes that devhelp ships and applies
automatically when it sets up a repo that **doesn't yet commit its own**
`.devhelp.yml`. They're the reliability floor: the popular repos newcomers
actually pick should "just work."

## How it works

- One file per repo, named `<owner>__<repo>.yml` (a `/` can't be in a filename,
  so we use `__`). Lowercase. Example: `vercel__next.js.yml` → `vercel/next.js`.
- The format is exactly the [`.devhelp.yml`](../src/recipe.ts) format a
  maintainer would commit. A bundled recipe is just a worked example.
- Precedence: a repo's **own committed `.devhelp.yml` always wins**. The bundled
  recipe is only the fallback. CI-mined commands only fill gaps neither set.

## The format

A [JSON Schema](./devhelp.schema.json) describes the supported keys; point your
editor at it for inline validation and autocomplete.

```yaml
# Command overrides (each optional) — surfaced in the final panel:
dev: pnpm dev
test: pnpm test
build: pnpm build

# Extra setup steps no detector can infer — run after install/env/codegen:
postInstall:
  - make seed
  - ./scripts/setup.sh

# Reminders shown to a first-time contributor (these never run):
notes:
  - "Postgres must be running first: docker compose up -d db"
```

## Adding a recipe

The fastest, most reliable way is to **generate one from a real, working
setup**: clone the repo, run `devhelp init` in it, then move the generated file
here and rename it `<owner>__<repo>.yml`.

Rules for what we accept:

- **Verifiable.** Only commands you've actually run to a working state. We never
  ship a guess — a wrong command is worse than no recipe (it breaks trust).
- **`postInstall` runs the repo's code** with the same trust as its install
  scripts. Keep steps minimal and standard (a seed script, a codegen command).
- **`notes` never execute** — use them freely for "you'll also need X running"
  caveats that no detector can infer.
- Prefer fixing detection over a recipe when the gap is general (open a PR to
  `src/detect.ts`); use a recipe only for genuinely repo-specific steps.

Open a PR adding the file. CI parses every recipe here and fails if one is
malformed or empty.
