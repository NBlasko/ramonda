/**
 * Asks the extension's staged plugin what it does for one project directory, and prints what it
 * logged.
 *
 *     node askTheShim.mjs <extension dir> <project dir>
 *
 * A separate process on purpose, and the test runs it with `NODE_PATH` cleared. pnpm puts its
 * hoisted directory on `NODE_PATH`, so `createRequire` resolves `@ramonda/css` from anywhere inside
 * a test run — including a directory that has nothing, which made the control pass for the wrong
 * reason. No editor sets `NODE_PATH`, so this is also the environment the shim really meets.
 */

import { createRequire } from "node:module";
import { join } from "node:path";

const [extension, directory] = process.argv.slice(2);

const from = createRequire(join(extension, "node_modules", "x.js"));
const made = from("@ramonda/css/plugin")({ typescript: from("typescript") });

const said = [];
made.create({
  languageService: {},
  config: {},
  languageServiceHost: { getScriptSnapshot: () => undefined, getScriptVersion: () => "1" },
  project: {
    getCurrentDirectory: () => directory,
    projectService: { logger: { info: (one) => said.push(one) } },
  },
});

process.stdout.write(said.join("\n"));
