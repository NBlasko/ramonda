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
import { existsSync, readFileSync, statSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const here = join(root, "packages", "css", "vscode");

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
  console.error(`\n[extension] Nothing was written. packages/css/vscode/PUBLISHING.md has the whole list.\n`);
  process.exit(1);
}

/* ---- package ---------------------------------------------------------------------------------- */

// A stale bundle beside a new one is the easiest wrong file to upload, so the name carries the
// version and the old ones go. `*.vsix` is gitignored, so none of this was ever committed.
for (const name of ["ramonda-css.vsix", out]) rmSync(join(here, name), { force: true });

console.log(`[extension] ${id} ${manifest.version} — packaging\n`);
execFileSync("pnpm", ["dlx", "@vscode/vsce@3", "package", "--no-dependencies", "--out", out], {
  cwd: here,
  stdio: "inherit",
});

const size = statSync(join(here, out)).size;
const where = relative(process.cwd(), join(here, out));

console.log(`\n[extension] ${where}  (${(size / 1024).toFixed(0)} KB)`);
console.log(`[extension] to publish it, by hand, with no token:`);
console.log(`[extension]   1. https://marketplace.visualstudio.com/manage/publishers/${manifest.publisher}`);
console.log(`[extension]   2. the \`…\` beside ${id} → Update`);
console.log(`[extension]   3. drop the file above in`);
console.log(`[extension] it is live for new installs in a few minutes, and the version is spent either way.\n`);
