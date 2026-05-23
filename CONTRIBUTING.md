# Contributing to devhelp

Thanks for considering a contribution. The most impactful PRs add **detectors** (new ecosystem support) or **error-recovery rules** (more failures handled offline). Drive-by typo fixes are also welcome.

## Dev setup

```bash
git clone https://github.com/devhelp/devhelp.git
cd devhelp
npm install
npm run build
```

Run the CLI in dev (TypeScript, no build step):

```bash
npm run dev -- --offline --dry-run "set up this project"
```

Run the built binary:

```bash
node dist/cli.js --offline "set up this project"
```

Type-check:

```bash
npx tsc --noEmit
```

## Project layout

```
src/
  cli.ts        Entry point + flag parsing. Routes to offline or agent.
  offline.ts    Deterministic playbook (no LLM). Detection + install.
  agent.ts      Claude tool-use loop for AI-assisted mode.
  tools.ts      Tool schemas + implementations for the agent.
```

The two modes share almost nothing on purpose — offline must work with zero AI deps, and the agent should be free to grow without dragging the playbook with it.

## Adding a detector

Detectors live in `src/offline.ts` inside `detect()`. A detector should:

1. Read manifest files via `tryRead(...)` (returns `null` if missing — never throw).
2. Set the appropriate field on `Detected` (e.g. `out.nodeVersion`).
3. Push install commands onto `out.installCommands` in the right order.
4. Set `testHint` / `devHint` where obvious.

Keep precedence explicit. If two sources can name a version, document the order in the README's precedence table and respect it in code.

## Adding an agent tool

Tools live in `src/tools.ts`:

1. Add a `Tool` entry to the `tools` array — name, description, JSON schema for inputs.
2. Add a `case` to `dispatch()` that calls your implementation.
3. Implementations return `ToolResult { output, isError }`. Never throw out of `dispatch` — wrap errors in `err(...)`.
4. Honor `ctx.dryRun` for anything mutating.

Write the description from the model's perspective: when *should* it pick this tool over others, what does it accept, what does it return?

## Style

- TypeScript strict mode is on. Don't loosen it.
- No new top-level dependencies without a reason in the PR description.
- Match existing formatting; no formatter is enforced yet, but Prettier defaults are fine.
- Comments only when the *why* is non-obvious. Identifiers should carry the *what*.

## Tests

There's no test suite yet. If you add one (please do — `vitest` is the obvious pick), keep it offline-only — no API keys in CI.

For now, the manual smoke tests live in the README examples and in commit messages. When you change detection, run a few of them and paste the output into the PR.

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
