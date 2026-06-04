---
name: Bug report
about: devhelp didn't set a repo up correctly
title: ""
labels: bug
---

**Repo you tried to set up** — `owner/repo` or the GitHub URL.

**Command you ran** — full `devhelp …` invocation, including flags.

**What happened** — paste the failure panel (or the full output if there
wasn't one). Include the *cause* line if there is one.

**What you expected** — usually "setup reaches READY".

**Environment**
- devhelp version (`devhelp --version`):
- OS + arch (e.g. macOS 15 arm64, Ubuntu 24 x86_64, WSL2):
- Node version (`node --version`):
- Anything unusual on `PATH` (mise, asdf, volta, nix):

**Anything that might matter**
- Was this a fresh machine / container?
- Did the same `git clone && <install>` work manually?
- A `--dry-run` of the same command — does it show the right plan?
