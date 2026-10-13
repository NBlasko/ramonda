const { existsSync, readFileSync } = require("node:fs");
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
     * The script the PACKAGE names as its bin, run by `node` — see `toolIn` in `tooling.ts`, which
     * had the same gap. The shim in `.bin` is a different file on every system: on Windows npm and
     * pnpm write `ramonda-css`, `ramonda-css.cmd` and `ramonda-css.ps1`, the extensionless one a shell
     * script `execFileSync` cannot run, and since Node 20.12 it refuses a `.cmd` without a shell.
     * `node` is the one the shim itself would have started, from the same PATH.
     */
    const own = join(at, "node_modules", "@ramonda", "css");
    const manifest = join(own, "package.json");
    if (existsSync(manifest)) {
      const script = JSON.parse(readFileSync(manifest, "utf8")).bin?.["ramonda-css"];
      return script === undefined ? undefined : { command: "node", args: [join(own, script)] };
    }

    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
  }
}

module.exports = { commandFor };
