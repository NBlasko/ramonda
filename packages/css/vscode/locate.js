const { existsSync } = require("node:fs");
const { dirname, join } = require("node:path");

/**
 * Where the project keeps its `ramonda-css`, walked up from the file being formatted.
 *
 * The PROJECT's own, never a copy of this extension's: what runs on save has to be the same command
 * `pnpm format` runs, with the same biome and the same config, or a file formatted on save is one
 * two commands disagree about.
 *
 * Its own file so it can be measured without an editor: everything else in `formatter.js` needs
 * `vscode` to be loadable, and this is the only part with a decision in it.
 */
function commandFor(file) {
  let at = dirname(file);

  for (;;) {
    /**
     * The spellings an install writes, plain one first — see `toolIn` in `tooling.ts`, which had the
     * same gap. On Windows npm and pnpm write `ramonda-css`, `ramonda-css.cmd` and `ramonda-css.ps1`,
     * and the extensionless one is a shell script that `execFileSync` cannot run.
     */
    for (const spelling of ["", ".cmd", ".exe", ".ps1"]) {
      const binary = join(at, "node_modules", ".bin", `ramonda-css${spelling}`);
      if (existsSync(binary)) return binary;
    }

    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
  }
}

module.exports = { commandFor };
