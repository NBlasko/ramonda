#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Links this folder into an editor's extensions directory, for the editors on this machine.
 *
 * A LINK rather than a copy, deliberately: the grammars are the ones the package's tests read, and a
 * copy would let the two drift with nothing to say so. Linked, a change to a grammar reaches the
 * editor on the next reload, and there is one file to be wrong.
 *
 * Marketplace publishing is not this script's job — until the extension is published, this is how it
 * gets installed, and `pnpm dlx @vscode/vsce package` is how a `.vsix` is made for anyone else.
 */

const here = dirname(fileURLToPath(import.meta.url));
const NAME = "ramonda.ramonda-css-vscode-0.0.0";

/** Every editor that reads VS Code extensions in the usual place. */
const EDITORS = [
  [".vscode", "VS Code"],
  [".vscode-insiders", "VS Code Insiders"],
  [".cursor", "Cursor"],
  [".windsurf", "Windsurf"],
  [".vscode-oss", "VSCodium"],
];

const found = EDITORS.filter(([folder]) => existsSync(join(homedir(), folder, "extensions")));

if (found.length === 0) {
  console.error("No editor extensions folder found. Nothing installed.");
  process.exit(1);
}

for (const [folder, what] of found) {
  const at = join(homedir(), folder, "extensions", NAME);
  mkdirSync(dirname(at), { recursive: true });

  if (existsSync(at) || lstatSync(at, { throwIfNoEntry: false })) {
    // An earlier link to this same folder is not a conflict; anything else is left alone.
    const linked = lstatSync(at).isSymbolicLink() && readlinkSync(at) === here;
    if (!linked) {
      console.error(`  ${what}: ${at} already exists and is not this folder — left alone.`);
      continue;
    }
    rmSync(at);
  }

  symlinkSync(here, at, "dir");
  console.log(`  ${what}: linked`);
}

console.log("\nReload the window (Developer: Reload Window) for the colours to appear.");
