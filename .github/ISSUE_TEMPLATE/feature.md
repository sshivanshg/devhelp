---
name: Feature request
about: A stack, recovery rule, or recipe devhelp should handle
title: ""
labels: enhancement
---

**What you wanted to set up** — repo, stack, or scenario.

**What devhelp does today** — e.g. "exits with UNSUPPORTED", "runs the wrong
install command", "doesn't know about <tool>".

**What it should do** — the minimum behavior change that would fix it. If
this is a new stack, paste the manifest files that should drive detection.

**Is this a recipe?** — if the gap is genuinely repo-specific (a seed script,
a "Postgres must be running first" note), consider running `devhelp init` in
the repo and opening a PR adding the file to `recipes/`. See
[`recipes/README.md`](../../recipes/README.md).
