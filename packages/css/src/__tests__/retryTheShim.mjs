/**
 * Drives the extension's plugin through a project whose own plugin is BROKEN, then repaired — the
 * shape a rebuild of `@ramonda/css` leaves while `tsserver` starts — and prints what happened.
 *
 *     node retryTheShim.mjs <extension dir> <project dir> <plugin file> <scenario>
 *
 * `scenario` is `repaired` (the file is rewritten with a working plugin) or `unchanged` (it is
 * left broken, and nothing about it changes). A separate process for the reason `askTheShim.mjs`
 * gives: `NODE_PATH` cleared, as an editor has it.
 */

import { utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const [extension, directory, pluginFile, scenario] = process.argv.slice(2);
const from = createRequire(join(extension, "node_modules", "x.js"));
const made = from("@ramonda/css/plugin")({ typescript: from("typescript") });

const said = [];
const project = { getCurrentDirectory: () => directory, projectService: { logger: { info: (one) => said.push(one) } } };
const service = made.create({
  languageService: { marker: "the one tsserver already had" },
  config: {},
  languageServiceHost: { getScriptSnapshot: () => undefined, getScriptVersion: () => "1" },
  project,
});

// The extension's copy wraps the service tsserver had, so it shows that one's marker through.
const who = () => (service.marker === "theirs" ? "theirs" : "the extension's copy");
const markers = [who()];
// Past the shim's own wait between two tries, so only the FILE decides whether it tries again.
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
await wait(3200);

if (scenario === "repaired") {
  writeFileSync(
    pluginFile,
    `globalThis.__loads = (globalThis.__loads ?? 0) + 1;\nmodule.exports = () => ({ create: () => ({ marker: "theirs" }) });\n`,
  );
  const later = new Date(Date.now() + 5000);
  utimesSync(pluginFile, later, later);
}
markers.push(who());
await wait(3200);
markers.push(who());

process.stdout.write(JSON.stringify({ said, markers, loads: globalThis.__loads ?? 0 }));
