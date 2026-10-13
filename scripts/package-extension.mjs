/**
 * Builds the `.vsix` a person uploads to the marketplace, and refuses to build a broken one.
 *
 *     pnpm extension:package
 *
 * ## Why a script and not a line in `package.json`
 *
 * Because the upload is by hand and it cannot be taken back. **The marketplace refuses a version it
 * has already seen, and there is no unpublish** — so a `.vsix` that is wrong is wrong for everyone
 * who installs it until the next version, and the version it occupied is spent. Everything below is
 * something that is cheap to check here and expensive to discover there.
 *
 * The checks are the ones the test suite cannot make. `grammar.test.ts` asserts what the grammars
 * MATCH; nothing asserts that the manifest still points at them. A renamed grammar file, a `main`
 * that moved, an icon deleted — each one packages without complaint and fails in a real editor,
 * silently, as "the colours just don't work".
 *
 * ## What it does not do
 *
 * It does not publish. `vsce publish` needs a token, the token needs an Azure DevOps organisation,
 * and the organisation needs an Azure subscription — a chain this repository cannot hold. The
 * upload is a drag-and-drop and the last lines printed are the route. When a token does exist,
 * `.github/workflows/extension.yml` is written and waiting.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { VENDORED } from "./vendored.mjs";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const here = join(root, "tools", "vscode-css");

const manifest = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
const id = `${manifest.publisher}.${manifest.name}`;
const out = `ramonda-css-${manifest.version}.vsix`;

/** Every complaint, so one run tells the whole story rather than one fault at a time. */
const wrong = [];

/* ---- the version ----------------------------------------------------------------------------- */

/**
 * The version has to have moved, and the CHANGELOG has to say what moved.
 *
 * These two are checked TOGETHER on purpose: the changelog is the extension's second marketplace
 * tab, so a bump without an entry ships a page that says the last release is the current one. The
 * heading is the only place a human writes the version twice, which is what makes it an assertion.
 */
if (manifest.version === "0.0.0") {
  wrong.push(`version is still 0.0.0 — the marketplace takes a version once and never again`);
}

const changelog = readFileSync(join(here, "CHANGELOG.md"), "utf8");
const top = changelog.match(/^## (.+)$/m)?.[1]?.trim();
if (top !== manifest.version) {
  wrong.push(
    `CHANGELOG.md's first entry is \`## ${top ?? "(none)"}\` and the manifest says ${manifest.version} — ` +
      `write the entry, or the marketplace's Changelog tab describes the previous release`,
  );
}

/* ---- what the manifest points at ------------------------------------------------------------- */

/** `main`, the icon, and every grammar: the files an editor loads, none of which a test opens. */
const pointed = [
  ["main", manifest.main],
  ["icon", manifest.icon],
  ...(manifest.contributes?.grammars ?? []).map((one, index) => [`grammars[${index}].path`, one.path]),
];

for (const [field, path] of pointed) {
  if (path === undefined) {
    wrong.push(`\`${field}\` is not set`);
  } else if (!existsSync(join(here, path))) {
    wrong.push(`\`${field}\` points at ${path}, which is not there`);
  }
}

/**
 * A grammar's `scopeName` has to be the one the manifest registered it under.
 *
 * They are written in two files and nothing but this compares them. Disagreeing, the grammar loads
 * and never matches — colouring simply does not happen, with no error anywhere.
 */
for (const [index, grammar] of (manifest.contributes?.grammars ?? []).entries()) {
  const file = join(here, grammar.path ?? "");
  if (!existsSync(file)) continue;
  const inside = JSON.parse(readFileSync(file, "utf8")).scopeName;
  if (inside !== grammar.scopeName) {
    wrong.push(
      `grammars[${index}] is registered as \`${grammar.scopeName}\` and the file says \`${inside}\` — ` +
        `it would load and never match`,
    );
  }
}

/**
 * The icon, at the size the item page draws it.
 *
 * 128×128 is the marketplace MINIMUM, not what it displays, and the first version of this file was
 * a 180px PNG scaled to 128 — soft beside extensions shipping vectors, and the user saw it before
 * anybody else. Read out of the PNG header rather than trusted: width and height are big-endian at
 * bytes 16 and 20, right after `IHDR`.
 */
if (existsSync(join(here, manifest.icon ?? ""))) {
  const png = readFileSync(join(here, manifest.icon));
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (width < 512 || height < 512) {
    wrong.push(`${manifest.icon} is ${width}×${height} — render it from the SVG at 512, see PUBLISHING.md`);
  }
}

if (wrong.length > 0) {
  console.error(`\n[extension] This would package, and it would be wrong:\n`);
  for (const one of wrong) console.error(`    • ${one}`);
  console.error(`\n[extension] Nothing was written. tools/vscode-css/PUBLISHING.md has the whole list.\n`);
  process.exit(1);
}

/* ---- package ---------------------------------------------------------------------------------- */

/**
 * **Every other `.vsix` goes, not just the one about to be written.**
 *
 * The comment here used to say "the old ones go" while the code deleted exactly two names — the
 * legacy fixed one and the file it was about to overwrite. So the first time a version was bumped,
 * `ramonda-css-0.1.2.vsix` sat beside `ramonda-css-0.1.3.vsix` in the folder a person drags from,
 * which is the failure the comment itself names. Caught by looking at the directory rather than at
 * the script's own output, which reported success.
 *
 * `*.vsix` is gitignored, so nothing here was ever committed and nothing is lost by removing it.
 */
for (const name of readdirSync(here)) {
  if (name.endsWith(".vsix")) rmSync(join(here, name), { force: true });
}

/**
 * The language-service plugin is staged FIRST, and from the build rather than from whatever is
 * lying in the folder.
 *
 * `contributes.typescriptServerPlugins` names `@ramonda/css/plugin`, and VS Code passes it to both
 * of an editor's TypeScript servers — including the syntax one, which has no `tsconfig.json` and so
 * would otherwise read a style block as plain TypeScript. A `.vsix` cut without the staging step
 * names a plugin that is not inside it, and an editor logs the failure at info level where nobody
 * reads it.
 */
execFileSync("node", [join(here, "build-plugin.mjs")], { stdio: "inherit" });

console.log(`[extension] ${id} ${manifest.version} — packaging\n`);
/**
 * **Without `--no-dependencies`, and that flag is why the plugin was missing.**
 *
 * `vsce` skips `node_modules` entirely under it — measured, and not only the dependencies it was
 * told not to walk: with the `node_modules/**` line taken out of `.vscodeignore` as well, it still
 * listed none. The staged plugin has to live there, because that is the only place `tsserver`
 * resolves a contributed plugin from.
 *
 * Dropping the flag costs nothing here: this extension declares no `dependencies`, so there is
 * nothing for `vsce` to walk, and `.vscodeignore` keeps the rest of `node_modules` out. Measured on
 * the archive — three files, which are the three that were staged.
 */
execFileSync("pnpm", ["dlx", "@vscode/vsce@3", "package", "--out", out], {
  cwd: here,
  stdio: "inherit",
});

/**
 * And the staged plugin really is IN the archive.
 *
 * `.vscodeignore` ignores `node_modules/**` and un-ignores this one subtree, which is a pair that
 * can drift — and either way round the failure is silent: the extension names a plugin an editor
 * cannot find. A `.vsix` is a zip, so its own listing is the assertion.
 */
const listed = execFileSync("unzip", ["-Z1", join(here, out)], { encoding: "utf8" });

/**
 * **Somebody else's bytes, looked for in the archive itself.**
 *
 * `check-third-party.mjs` watches what npm publishes, and its own note says why the check is on the
 * OUTPUT rather than on anybody's intention: copied work reaches a distribution through a bundler,
 * through a dependency that is not published, through a refactor that moves a file. A `.vsix` is now
 * one of those distributions — it carries a bundle of the whole compiler — and nothing looked at it.
 *
 * Measured when this was written: the archive holds three copyright lines and all three are this
 * extension's own MIT, `magic-string` is not inlined, and the bundle requires only Node built-ins.
 * Nothing is owed today. This is what will say so tomorrow.
 *
 * The fingerprints come from `vendored.mjs`, which is the list and nothing else: one list, two
 * artefacts, and no script that runs somebody else's gate on import.
 */
const bytes = execFileSync("unzip", ["-p", join(here, out)], { encoding: "latin1", maxBuffer: 64 * 1024 * 1024 });
const carries = VENDORED.filter((one) => bytes.includes(one.fingerprint));

if (carries.length > 0) {
  /**
   * The notice has to be in `THIRD-PARTY.md`, not merely somewhere in the archive.
   *
   * The first version asked whether the words were anywhere in the bytes, and this extension's own
   * MIT already carries *Permission is hereby granted* — so half the test was satisfied by our own
   * licence, for somebody else's work. `check-third-party.mjs` asks the same question of npm and
   * asks it of one named file; so does this.
   */
  const NOTICE = "extension/THIRD-PARTY.md";
  const said = listed.includes(NOTICE)
    ? execFileSync("unzip", ["-p", join(here, out), NOTICE], { encoding: "utf8" })
    : "";
  const owed = carries.filter((one) => !(said.includes(one.names) && /Permission is hereby granted/.test(said)));

  if (owed.length > 0) {
    console.error(`\n[extension] the .vsix carries somebody else's work and not their notice:\n`);
    for (const one of owed) console.error(`    • ${one.work}`);
    console.error(
      `\n[extension] put a THIRD-PARTY.md beside the manifest naming it, with its permission notice,` +
        `\n[extension] and make sure .vscodeignore lets it through.\n`,
    );
    rmSync(join(here, out), { force: true });
    process.exit(1);
  }
  console.log(`[extension] ${carries.length} vendored work(s) in the archive, each with its notice`);
}

const missing = [
  "extension/node_modules/@ramonda/css/plugin.js",
  "extension/node_modules/@ramonda/css/dist/plugin.cjs",
].filter((one) => !listed.includes(one));
if (missing.length > 0) {
  console.error(`\n[extension] the .vsix does not carry the plugin it contributes:\n`);
  for (const one of missing) console.error(`    • ${one}`);
  console.error(`\n[extension] check the \`!node_modules/@ramonda/**\` line in .vscodeignore.\n`);
  rmSync(join(here, out), { force: true });
  process.exit(1);
}

const size = statSync(join(here, out)).size;
const where = relative(process.cwd(), join(here, out));

console.log(`\n[extension] ${where}  (${(size / 1024).toFixed(0)} KB)`);
console.log(`[extension] to publish it, by hand, with no token:`);
console.log(`[extension]   1. https://marketplace.visualstudio.com/manage/publishers/${manifest.publisher}`);
console.log(`[extension]   2. the \`…\` beside ${id} → Update`);
console.log(`[extension]   3. drop the file above in`);
console.log(`[extension] it is live for new installs in a few minutes, and the version is spent either way.\n`);
