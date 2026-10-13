/**
 * Damaged CSS that every engine drops, and the checker says nothing about — counted, and the count
 * may only go down.
 *
 *     node scripts/css/check-engine-sweep.mjs
 *     node scripts/css/check-engine-sweep.mjs --write   # take closed holes off the list; refuses a new one
 *     SELFTEST=hole node scripts/css/check-engine-sweep.mjs    # the checker silent on one drop; must fail
 *     SELFTEST=fixed node scripts/css/check-engine-sweep.mjs   # a closed hole left on it; must fail
 *     SELFTEST=blind node scripts/css/check-engine-sweep.mjs   # engines that drop nothing; must fail
 *
 * ## What it asks
 *
 * `engine-sweep-cases.mjs` writes a valid base for every place a block holds CSS text — a value, a
 * `@media`, `@container` and `@supports` condition, a selector — and damages each token of it. Every
 * case is put to Chromium, Firefox and WebKit, and to the checker exactly as a project meets it: its
 * own file, through `checkProject`, the TypeScript program and every rule.
 *
 * A HOLE is a case all three engines drop, or keep and never apply, while the checker reports
 * nothing. It ships, and the page is wrong in every browser.
 *
 * ## The engines' verdicts
 *
 * - a declaration: kept if the rule it is written in still has a declaration;
 * - a selector: kept if `insertRule` takes it;
 * - a `@media` or `@container` condition: broken if, at some size, neither it nor its negation
 *   applies — a valid condition is true or false everywhere, and an unknown one is neither. Asked at
 *   two sizes, because `(broken) and (false)` is plainly false at one of them;
 * - a `@supports` condition: broken if it answers differently from its base.
 *
 * ## Why a baseline, when it is empty
 *
 * The first run found 243 (2026-10-12), in eight families — function arguments, malformed numbers,
 * missing separators, `@container` and `@supports` unchecked, and more — and they were closed family by
 * family the same day, to none. The list stays: a new hole fails here the day it appears, and one that
 * has to be lived with is put on it on purpose, with `--write --accept-new`, where a review sees it.
 */
import { readFileSync, rmSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { caughtIt } from "../lib-selftest.mjs";
import { inABlock, keyOf, sweepCases } from "./engine-sweep-cases.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = join(ROOT, "scripts", "css", "engine-sweep.baseline.json");
const selftest = process.env.SELFTEST;
const write = process.argv.includes("--write");

const pw = createRequire(join(ROOT, "apps", "playground-core", "package.json"))("@playwright/test");
const cssRequire = createRequire(join(ROOT, "packages", "css", "package.json"));
const esbuild = cssRequire("esbuild");

/**
 * `checkProject` from source, with `typescript` left to the package's own copy. Not through
 * `lib-load-ts.mjs`: a module loaded from a `data:` URL cannot resolve a bare `typescript`, and
 * bundling the compiler in would be a second TypeScript beside the one the rules were written for.
 */
async function loadCheckProject() {
  const built = await esbuild.build({
    entryPoints: [join(ROOT, "packages", "css", "src", "adapters", "check.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    external: ["typescript"],
    logLevel: "silent",
  });
  const typescript = pathToFileURL(cssRequire.resolve("typescript")).href;
  const source = built.outputFiles[0].text.replaceAll(/from\s*"typescript"/g, `from "${typescript}"`);
  const dir = mkdtempSync(join(tmpdir(), "ramonda-sweep-check-"));
  const file = join(dir, "check.mjs");
  writeFileSync(file, source);
  try {
    return (await import(pathToFileURL(file).href)).checkProject;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Each engine's verdict on each case: `ok`, `dropped`, `unknown`, or `true` / `false` for `@supports`. */
async function askTheEngines(cases) {
  const verdicts = cases.map(() => ({}));
  for (const engine of ["chromium", "firefox", "webkit"]) {
    const browser = await pw[engine].launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      await page.setContent(
        '<!doctype html><html><head></head><body><div class="box"><div class="t"></div></div></body></html>',
      );
      const answers = await page.evaluate(async (cases) => {
        const t = document.querySelector(".t");
        const box = document.querySelector(".box");
        const sheet = (text) => {
          const one = document.createElement("style");
          one.textContent = text;
          document.head.append(one);
          return one;
        };
        const applies = () => {
          const style = getComputedStyle(t);
          return [style.getPropertyValue("--a").trim() !== "", style.getPropertyValue("--b").trim() !== ""];
        };
        // A condition is broken when, at some size, neither it nor its negation applies.
        const neitherAtSomeSize = async (resize) => {
          for (const size of [300, 1100]) {
            await resize(size);
            const [yes, no] = applies();
            if (!yes && !no) return true;
          }
          return false;
        };
        const out = [];
        for (const c of cases) {
          let verdict;
          if (c.site === "decl") {
            const one = sheet(`.t { ${c.text}; }`);
            verdict = one.sheet.cssRules[0]?.style.length > 0 ? "ok" : "dropped";
            one.remove();
          } else if (c.site === "selector") {
            const one = sheet("");
            try {
              one.sheet.insertRule(`${c.text.replaceAll("&", ".t")} { color: red }`);
              verdict = "ok";
            } catch {
              verdict = "dropped";
            }
            one.remove();
          } else if (c.site === "media") {
            // `not` takes one condition, so a group is wrapped, and `only` — which `not` cannot follow —
            // is dropped: it changes nothing in an engine that reads media queries at all.
            const not = c.text.startsWith("(") ? `not (${c.text})` : `not ${c.text.replace(/^only\s+/i, "")}`;
            const one = sheet(`@media ${c.text} { .t { --a: 1 } } @media ${not} { .t { --b: 1 } }`);
            // At this width only; the second width is asked below, once the page is resized.
            verdict = one.sheet.cssRules.length === 0 ? "dropped" : applies().some(Boolean) ? "ok" : "unknown";
            one.remove();
          } else if (c.site === "container") {
            // Wrapped, for the same reason: `not (a) and (b)` is no condition at all.
            const not = /^[a-z]/.test(c.text) ? c.text.replace(/^(\S+) (.*)$/, "$1 not ($2)") : `not (${c.text})`;
            const one = sheet(
              `.box { container-type: size; container-name: card; height: 300px }
               @container ${c.text} { .t { --a: 1 } } @container ${not} { .t { --b: 1 } }`,
            );
            const kept = [...one.sheet.cssRules].some((rule) => rule.constructor.name === "CSSContainerRule");
            verdict = !kept
              ? "dropped"
              : (await neitherAtSomeSize(async (size) => {
                    box.style.width = `${size}px`;
                  }))
                ? "unknown"
                : "ok";
            box.style.width = "";
            one.remove();
          } else {
            const one = sheet(`@supports ${c.text} { .t { --a: 1 } }`);
            verdict = one.sheet.cssRules.length === 0 ? "dropped" : CSS.supports(c.text) ? "true" : "false";
            one.remove();
          }
          out.push(verdict);
        }
        return out;
      }, cases);
      // `@media` again at a second width: `(broken) and (false)` reads as plainly false at one size.
      await page.setViewportSize({ width: 300, height: 800 });
      const narrow = await page.evaluate(
        (texts) =>
          texts.map((text) => {
            const not = text.startsWith("(") ? `not (${text})` : `not ${text.replace(/^only\s+/i, "")}`;
            return !matchMedia(text).matches && !matchMedia(not).matches;
          }),
        cases.map((c) => c.text),
      );
      for (const [index, verdict] of answers.entries()) {
        const broken = cases[index].site === "media" && verdict === "ok" && narrow[index];
        verdicts[index][engine] = broken ? "unknown" : verdict;
      }
    } finally {
      await browser.close();
    }
  }
  return verdicts;
}

/** What the checker reports about each case, read as a project would be. */
function askTheChecker(checkProject, cases) {
  const root = mkdtempSync(join(tmpdir(), "ramonda-sweep-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "src", "jsx.d.ts"),
      "declare namespace JSX { interface IntrinsicElements { div: { className?: string; children?: unknown } } interface Element { readonly _b: unique symbol } }",
    );
    // The container the engines' page names `card`, given here too, so a case asking for `card` is
    // asked the same question on both sides.
    writeFileSync(
      join(root, "src", "layout.tsx"),
      "export const l = <div className={@@( container: card / size; )}>x</div>;\n",
    );
    // One file per case: a bracket left open in one must not reach the next.
    for (const [index, one] of cases.entries()) {
      writeFileSync(
        join(root, "src", `c${index}.tsx`),
        `export const b = <div className={@@( ${inABlock(one)} )}>x</div>;\n`,
      );
    }
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
          types: [],
          skipLibCheck: true,
          paths: { "@ramonda/css/properties": [join(ROOT, "packages", "css", "src", "properties.ts")] },
        },
        include: ["src"],
      }),
    );
    const said = cases.map(() => []);
    for (const finding of checkProject(join(root, "tsconfig.json")).findings) {
      const index = /^c(\d+)\.tsx$/.exec(basename(finding.file))?.[1];
      if (index !== undefined) said[Number(index)].push(`${finding.code}: ${finding.message.split("\n")[0]}`);
    }
    return said;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const ENGINES = ["chromium", "firefox", "webkit"];
const cases = sweepCases();
const [verdicts, checkProject] = await Promise.all([askTheEngines(cases), loadCheckProject()]);
const said = askTheChecker(checkProject, cases);

const baseIndex = new Map();
for (const [index, one] of cases.entries()) if (one.isBase) baseIndex.set(`${one.site}|${one.base}`, index);

const broken = (index, engine) => {
  const one = cases[index];
  const verdict = verdicts[index][engine];
  if (one.site === "supports") return verdict !== verdicts[baseIndex.get(`${one.site}|${one.base}`)][engine];
  return verdict !== "ok";
};

/**
 * The break `SELFTEST=blind` plants: engines that drop nothing. Every case then reads as kept, no
 * hole can appear, and the run passes having asked nothing — the shape a broken page or oracle takes.
 */
if (selftest === "blind") for (const one of verdicts) for (const engine of ENGINES) one[engine] = "ok";

const faults = [];

/**
 * How many damaged cases every engine must drop, or the oracle is not answering. Found in review:
 * 791 of 989 are dropped by all three; a half is well under that and well over none.
 */
const dropped = cases.filter((one, index) => !one.isBase && ENGINES.every((engine) => broken(index, engine))).length;
if (dropped < (cases.length - cases.filter((one) => one.isBase).length) / 2) {
  faults.push(`only ${dropped} damaged case(s) are dropped by every engine — the engines are not being asked`);
}
/**
 * The break `SELFTEST=hole` plants: the checker going silent on one case every engine drops — the
 * regression this gate exists for. Planted in what the checker SAID, not in the list, so it still
 * bites when the list is empty.
 */
if (selftest === "hole") {
  const caught = cases.findIndex(
    (one, index) => !one.isBase && said[index].length > 0 && ENGINES.every((engine) => broken(index, engine)),
  );
  said[caught] = [];
}

const holes = [];
for (const [index, one] of cases.entries()) {
  if (one.isBase) {
    const notValid = ENGINES.filter((engine) => !["ok", "true", "false"].includes(verdicts[index][engine]));
    if (notValid.length > 0) faults.push(`a base is not valid in ${notValid.join(", ")}: ${keyOf(one)}`);
    if (said[index].length > 0) faults.push(`a base is reported by the checker: ${keyOf(one)} — ${said[index][0]}`);
    continue;
  }
  if (said[index].length === 0 && ENGINES.every((engine) => broken(index, engine))) holes.push(keyOf(one));
}

const listed = JSON.parse(readFileSync(BASELINE, "utf8")).holes;
if (selftest === "fixed") listed.push(keyOf(cases.find((one) => !one.isBase && !holes.includes(keyOf(one)))));

if (write) {
  /**
   * `--write` takes holes OFF the list and never puts one on. Run after a change that opened a new
   * hole, it used to list that hole as known — measured 2026-10-12, five regressions went onto the
   * list in one run, and the gate would then have passed them. A new one has to be fixed, or listed
   * on purpose with `--accept-new`.
   */
  const before = new Set(JSON.parse(readFileSync(BASELINE, "utf8")).holes);
  const opened = holes.filter((one) => !before.has(one));
  if (opened.length > 0 && !process.argv.includes("--accept-new")) {
    for (const one of opened) console.error(`[engine-sweep] NEW HOLE, not written: ${one}`);
    console.error("[engine-sweep] fix it, or run with --accept-new to list it on purpose.");
    process.exit(1);
  }
  writeFileSync(BASELINE, `${JSON.stringify({ count: holes.length, holes: holes.sort() }, null, 2)}\n`);
  console.log(`[engine-sweep] baseline written: ${holes.length} hole(s) in ${cases.length} cases`);
  process.exit(faults.length > 0 ? 1 : 0);
}

const known = new Set(listed);
const found = new Set(holes);
const appeared = holes.filter((one) => !known.has(one));
const closed = listed.filter((one) => !found.has(one));

if (selftest !== undefined) {
  const caught = selftest === "hole" ? appeared : selftest === "blind" ? faults : closed;
  if (caught.length > 0) caughtIt("engine-sweep", selftest, caught);
  console.error(`[engine-sweep] SELFTEST=${selftest} caught nothing — the comparison is not working.`);
  process.exit(1);
}

for (const fault of faults) console.error(`[engine-sweep] ${fault}`);
for (const one of appeared)
  console.error(`[engine-sweep] NEW HOLE — every engine drops it, the checker is silent: ${one}`);
for (const one of closed)
  console.error(
    `[engine-sweep] no longer a hole, take it off the list (node scripts/css/check-engine-sweep.mjs --write): ${one}`,
  );
if (faults.length + appeared.length + closed.length > 0) process.exit(1);
console.log(
  `[engine-sweep] ${cases.length} damaged cases, ${holes.length} known hole(s), none new, none closed and still listed`,
);
