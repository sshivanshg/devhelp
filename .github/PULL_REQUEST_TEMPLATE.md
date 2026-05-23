<!-- Thanks for the PR. A few quick things: -->

## What this changes

<!-- One or two sentences. -->

## Why

<!-- The user-visible pain this fixes, or the capability it adds. Link an issue if there is one. -->

## How to verify

<!-- The exact commands you ran to test this. Include `devhelp --dry-run` output for any detection or playbook change. -->

```
$ devhelp --offline --dry-run "<request>"
...
```

## Checklist

- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` produces a working `dist/cli.js`
- [ ] Detection changes are documented in the README precedence table
- [ ] New tool/detector is mentioned in `CHANGELOG.md` under `[Unreleased]`
