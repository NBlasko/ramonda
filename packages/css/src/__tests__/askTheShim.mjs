/**
 * Asks the extension's staged plugin what it does for one project directory, and prints the answer
 * as JSON: what it logged, what `create` returned, and what `getExternalFiles` answers.
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
/** What `tsserver` hands a plugin, cut down to what the shim reads. */
const project = {
  getCurrentDirectory: () => directory,
  projectService: { logger: { info: (one) => said.push(one) } },
};

/** What the project's own plugin was handed, when it is the one serving — see `seen` below. */
const out = { said, threw: undefined, service: undefined, externalFiles: undefined, handed: undefined };
try {
  const service = made.create({
    languageService: { marker: "the one tsserver already had" },
    config: {},
    languageServiceHost: { getScriptSnapshot: () => undefined, getScriptVersion: () => "1" },
    project,
  });
  out.service = service?.marker ?? "a proxy";
  out.handed = service?.handed;
} catch (error) {
  out.threw = String(error);
}

try {
  out.externalFiles = made.getExternalFiles(project, 0);
} catch (error) {
  out.externalFiles = `threw: ${error}`;
}

process.stdout.write(JSON.stringify(out));
