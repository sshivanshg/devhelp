# Contributing to devhelp

Thanks for considering a contribution. The most impactful PRs add **detectors** (new ecosystem support) or **error-recovery rules** (more failures handled automatically). Drive-by typo fixes are also welcome.

## Dev setup

```bash
git clone https://github.com/sshivanshg/devhelp.git
cd devhelp
npm install
npm run build
```

Run the CLI in dev (TypeScript, no build step):

```bash
npm run dev -- --dry-run "set up this project"
```

Run the built binary:

```bash
node dist/cli.js "set up this project"
```

Type-check:

```bash
npx tsc --noEmit
```

## Project layout

```
src/
  cli.ts        Entry point + flag parsing.
  detect.ts     Manifest/lockfile detection → a Detected description.
  setup.ts      Deterministic playbook. Runs the install steps for what was detected.
  recovery.ts   Pattern-matched "likely fix" hints for known install failures.
```

## Adding a detector

Detectors live in `src/detect.ts`. A detector should:

1. Read manifest files via `tryRead(...)` (returns `null` if missing — never throw).
2. Set the appropriate field on `Detected` (e.g. `out.nodeVersion`).
3. Push install commands onto `out.installCommands` in the right order.
4. Set `testHint` / `devHint` where obvious.

Keep precedence explicit. If two sources can name a version, document the order in the README's precedence table and respect it in code.

## Style

- TypeScript strict mode is on. Don't loosen it.
- No new top-level dependencies without a reason in the PR description.
- Match existing formatting; no formatter is enforced yet, but Prettier defaults are fine.
- Comments only when the *why* is non-obvious. Identifiers should carry the *what*.

## Tests

Tests run on `vitest`:

```bash
npm test
```

`test/detect-fixtures.test.ts` runs `detect()` against every fixture in `test-fixtures/` and asserts the expected stack — add a fixture and a row there when you add a detector. When you change detection, also paste a `devhelp --dry-run` run against a couple of real repos into the PR.

## Commits and PRs

- Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`) — keeps the changelog easy to generate later.
- Keep PRs focused. One detector per PR. One bug per PR.
- Reference an issue if one exists; if not, the PR description is the spec.

## Reporting issues

Use the issue templates. The most useful bug reports include:

- OS + arch (`uname -a`)
- Node version
- The full `devhelp --dry-run "<your command>"` output
- What you expected vs. what happened

## License

By contributing, you agree your work is licensed under MIT (see [LICENSE](./LICENSE)).
