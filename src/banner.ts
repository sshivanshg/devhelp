import chalk from "chalk";

/**
 * The "devhelp" wordmark (ANSI Shadow figlet). Six rows; each gets its own hue
 * so the logo reads as a cyan→violet vertical gradient.
 */
const LOGO = [
  "██████╗ ███████╗██╗   ██╗██╗  ██╗███████╗██╗     ██████╗ ",
  "██╔══██╗██╔════╝██║   ██║██║  ██║██╔════╝██║     ██╔══██╗",
  "██║  ██║█████╗  ██║   ██║███████║█████╗  ██║     ██████╔╝",
  "██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══██║██╔══╝  ██║     ██╔═══╝ ",
  "██████╔╝███████╗ ╚████╔╝ ██║  ██║███████╗███████╗██║     ",
  "╚═════╝ ╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝     ",
];

const ROW_HUES = ["#5eead4", "#22d3ee", "#38bdf8", "#3b82f6", "#6366f1", "#818cf8"];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface BannerOptions {
  request: string;
  dryRun: boolean;
}

/**
 * Animated startup banner: reveals the wordmark row by row so the logo "builds
 * up", then prints the request line. Animation only runs on an interactive TTY;
 * piped/CI/JSON callers get the same frame printed instantly so logs stay clean.
 */
export async function printBanner(opts: BannerOptions): Promise<void> {
  const animate = !!process.stdout.isTTY && !process.env.CI;

  console.log();
  for (let i = 0; i < LOGO.length; i++) {
    console.log("  " + chalk.hex(ROW_HUES[i]).bold(LOGO[i]));
    if (animate) await sleep(45);
  }

  const tag = chalk.dim("clone a repo → a working dev environment");
  const mode = opts.dryRun ? "  " + chalk.yellow.bold("DRY RUN") : "";
  console.log("  " + tag + mode);
  console.log();
  console.log(chalk.cyan("  ›"), opts.request);
  console.log();
}
