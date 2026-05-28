# devhelp launch demo — render with:  vhs demo/devhelp.tape  (from the repo root)
#
# Shows devhelp reading a real Prisma/Next.js monorepo (documenso) and printing
# the exact plan it would execute: runtime, package manager, .env copy, prisma
# generate, Playwright, and the framework dev URL.
#
# The repo is shallow-cloned inside the Hide block below (VHS runs it but
# captures no frames), so the recorded GIF is fast and deterministic and focuses
# on the detection + plan. --dry-run prints the plan without installing
# anything; a real run executes exactly these steps.

Output demo/devhelp.gif

Set Shell "bash"
Set FontSize 16
Set Width 1480
Set Height 1040
Set Padding 26
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

# --- setup (hidden: no frames captured) -------------------------------------
Hide
Type 'REPO="$PWD"' Enter
Type 'devhelp() { node "$REPO/dist/cli.js" "$@"; }' Enter
Type "mkdir -p /tmp/devhelp-demo" Enter
Type "test -d /tmp/devhelp-demo/documenso || git clone --depth 1 https://github.com/documenso/documenso.git /tmp/devhelp-demo/documenso" Enter
Wait@180s
Type "cd /tmp/devhelp-demo && clear" Enter
Show

# --- the demo ---------------------------------------------------------------
Type "devhelp --dry-run 'Set me up to contribute to documenso/documenso'"
Sleep 700ms
Enter
Sleep 6s

Type "# READY — and that's exactly what a real run executes, step for step."
Sleep 1500ms
Enter
Sleep 2500ms
