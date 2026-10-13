/**
 * A value an engine takes must not be refused by `invalid-value`.
 *
 *     node scripts/css/check-value-grammar.mjs
 *     node scripts/css/check-value-grammar.mjs --collect FILE…   # rebuild the corpus from CSS files
 *     SELFTEST=refuse node scripts/css/check-value-grammar.mjs   # a valid value refused; must fail
 *     SELFTEST=blind node scripts/css/check-value-grammar.mjs    # a checker that reads nothing; must fail
 *
 * ## Why
 *
 * `invalid-value` reads every value against the grammar `mdn-data` publishes, and every rule here is
 * an error: a value it refuses wrongly stops somebody's build. `mdn-data` has been measured wrong
 * before — `circle(50%)` was the first one this rule met — so the grammar is not trusted; the
 * ENGINES are. Each declaration in `value-corpus.json` is put to Chromium, Firefox and WebKit, and to
 * `valueMatchesGrammar`. One an engine accepts and the grammar refuses fails here, and the fix is a
 * correction in `validateValue.ts` beside its measurement — or, where refusing is right, a line in
 * {@link DECIDED} saying why.
 *
 * ## The corpus
 *
 * 1993 declarations when it was made (2026-10-12): jsdom's user-agent stylesheet, the CSS of three
 * applications shipped in this repository's dependencies, this repository's own, and the hand-written
 * pages of `check-render-equality.mjs` — whose grid line names this rule refused once, before
 * `[` and `]` were tokens. Real CSS people wrote, rather than values made to pass. `--collect` rebuilds it from whatever files it is given.
 */
import { readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { caughtIt } from "../lib-selftest.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORPUS = join(ROOT, "scripts", "css", "value-corpus.json");
const TAG = "value-grammar";
const selftest = process.env.SELFTEST;

/** Refused on purpose, each with the reason. A stale entry is reported, so none outlives its case. */
const DECIDED = {
  "vertical-align: center":
    "Firefox's own keyword: Chromium and WebKit drop it, so it works in one engine of three and saying so is right",
};

const cssRequire = createRequire(join(ROOT, "packages", "css", "package.json"));

if (process.argv.includes("--collect")) {
  const properties = cssRequire("mdn-data/css/properties.json");
  const files = process.argv.slice(process.argv.indexOf("--collect") + 1);
  const pairs = new Map();
  for (const file of files) {
    const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const found of text.matchAll(/[{;]\s*([a-z-]+)\s*:\s*([^;{}]+?)\s*(?=[;}])/g)) {
      const [, property, value] = found;
      if (properties[property] === undefined || value.length > 200) continue;
      pairs.set(`${property}: ${value.replace(/\s+/g, " ")}`, [property, value.replace(/\s+/g, " ")]);
    }
  }
  const corpus = [...pairs.values()].sort(([a, b], [c, d]) => (a + b < c + d ? -1 : 1));
  writeFileSync(CORPUS, `${JSON.stringify(corpus)}\n`);
  console.log(`[${TAG}] corpus written: ${corpus.length} declarations from ${files.length} file(s)`);
  process.exit(0);
}

/** `valueMatchesGrammar` from source, `typescript`-free, through a file so its imports resolve. */
async function loadValidator() {
  const built = await cssRequire("esbuild").build({
    entryPoints: [join(ROOT, "packages", "css", "src", "compiler", "validateValue.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  const dir = mkdtempSync(join(tmpdir(), "ramonda-value-grammar-"));
  const file = join(dir, "validate.mjs");
  writeFileSync(file, built.outputFiles[0].text);
  try {
    return (await import(pathToFileURL(file).href)).valueMatchesGrammar;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const corpus = JSON.parse(readFileSync(CORPUS, "utf8"));
const { sweepCases } = await import("./engine-sweep-cases.mjs");
for (const one of sweepCases()) {
  if (!one.isBase || one.site !== "decl") continue;
  const colon = one.text.indexOf(":");
  corpus.push([one.text.slice(0, colon).trim(), one.text.slice(colon + 1).trim()]);
}

const real = await loadValidator();
// The break the selftest plants: a validator that refuses one value every engine takes.
const valueMatchesGrammar =
  selftest === "refuse"
    ? (p, v) => (p === "color" && v === "red" ? false : real(p, v))
    : selftest === "blind"
      ? () => undefined
      : real;

/**
 * How much of the corpus must be READ, not only not refused. A checker answering "cannot say" to
 * everything refuses nothing and would pass — the shape a broken reader takes. Found in review: 1752
 * of 2037 are read, the rest a `var()` or a budget; this floor is well under that and well over none.
 */
const MUST_READ = 0.75;
if (selftest === "refuse") corpus.push(["color", "red"]);

const pw = createRequire(join(ROOT, "apps", "playground-core", "package.json"))("@playwright/test");
const accepted = corpus.map(() => false);
for (const engine of ["chromium", "firefox", "webkit"]) {
  const browser = await pw[engine].launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html></html>");
    const said = await page.evaluate((all) => all.map(([p, v]) => CSS.supports(p, v)), corpus);
    said.forEach((one, index) => {
      if (one) accepted[index] = true;
    });
  } finally {
    await browser.close();
  }
}

const refused = [];
let read = 0;
for (const [index, [property, value]] of corpus.entries()) {
  const says = valueMatchesGrammar(property, value);
  if (says !== undefined) read++;
  if (says === false && accepted[index]) refused.push(`${property}: ${value}`);
}
const wrong = refused.filter((one) => DECIDED[one] === undefined);
const stale = Object.keys(DECIDED).filter((one) => !refused.includes(one));

const blind = read < corpus.length * MUST_READ;

if (selftest !== undefined) {
  if (selftest === "blind" && blind) caughtIt(TAG, selftest, [`read ${read} of ${corpus.length}`]);
  if (selftest !== "blind" && wrong.length > 0) caughtIt(TAG, selftest, wrong);
  console.error(`[${TAG}] SELFTEST=${selftest} caught nothing — the comparison is not working.`);
  process.exit(1);
}

for (const one of wrong) console.error(`[${TAG}] REFUSED, and an engine takes it: ${one}`);
for (const one of stale) console.error(`[${TAG}] decided, and no longer refused — take it out of DECIDED: ${one}`);
if (blind)
  console.error(`[${TAG}] only ${read} of ${corpus.length} declarations were read — the checker is not reading`);
if (wrong.length + stale.length > 0 || blind) process.exit(1);
console.log(`[${TAG}] ${corpus.length} declarations, ${read} read, none an engine takes refused`);
