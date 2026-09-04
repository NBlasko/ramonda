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
    const binary = join(at, "node_modules", ".bin", "ramonda-css");
    if (existsSync(binary)) return binary;

    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
  }
}

module.exports = { commandFor };
