/**
 * Two stylesheets from two releases on one page, and the right declaration still wins.
 *
 *     node scripts/check-layer-skew.mjs
 *     SELFTEST=order node scripts/check-layer-skew.mjs
 *
 * ## The fault this is for
 *
 * A published package ships CSS it built with one release of this compiler; the application that
 * pulls it in built its own with another. Nothing on the page reconciles them — they agree only
 * about the layer names in their opening statement. Get that wrong and a rule in a package silently
 * beats a narrower rule in the application, in a page nobody edited, with the answer depending on
 * which file the bundler happened to put first.
 *
 * ## Why a browser, and why the REAL `Sheet`
 *
 * Whether a layer order MEANS what it is supposed to mean is the cascade's answer, and the cascade
 * lives in a browser. `prototype-package-skew.mjs` modelled the naming because the scheme was not
 * built; it is built now, so this drives the real compiler, the real `Sheet` and the real
 * `mergeClassNames`, and only the two-sheets-on-one-page arrangement is set up here.
 *
 * **The merge is not optional in the arrangement**, and leaving it out is what made an early version
 * of this report a failure that was not one. For a family the compiler SPLITS, both declarations are
 * longhands with the same key, so `mergeClassNames` settles them before the browser sees a class and
 * the element never carries two. Putting both classes on by hand asks the cascade a question the
 * system never asks it.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./lib-load-ts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const selftest = process.env.SELFTEST;

const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const COMPILER = join(HERE, "..", "packages", "css", "src", "compiler");
const { Sheet } = await loadTs(join(COMPILER, "sheet.ts"));
const { transform } = await loadTs(join(COMPILER, "transform.ts"));
const { mergeClassNames, shorthands } = await loadTs(join(HERE, "..", "packages", "css", "src", "merge.ts"));

/** One release's stylesheet, through the real compiler and the real sheet. */
function sheetFor(name, css) {
  const sheet = new Sheet();
  const built = transform(`const a = @@( ${css} );\nexport default a;\n`, { filename: `${name}.tsx` });
  sheet.add(`${name}.tsx`, built?.blocks ?? []);
  /**
   * The classes the MODULE hands the page — the emitted `_merge("…")`, split's markers and all —
   * not the list of rules. The markers have no rule and are what the merge clears by, so reading
   * the rules instead handed the merge something no page ever gets. The module's own registration
   * of what its shorthands clear runs too, as it would on load.
   */
  const table = /_clears\((\{.*?\})\);/.exec(built?.code ?? "");
  if (table) shorthands(JSON.parse(table[1]));
  const emitted = /_merge\("([^"]*)"\)/.exec(built?.code ?? "")?.[1] ?? "";
  return { css: sheet.cssFor(`${name}.tsx`), classes: String(mergeClassNames(emitted)).split(" ").filter(Boolean) };
}

/**
 * Each row: what the package writes, what the application writes, and what the page must show.
 *
 * The cases are chosen for the four ways a declaration can reach the sheet — a shorthand no table
 * can split, one that splits, one whose split was REFUSED, and `all`.
 */
const CASES = [
  ["a shorthand no table splits", "background: red;", "background-color: blue;", "backgroundColor", "rgb(0, 0, 255)"],
  ["a shorthand that splits", "padding: 8px;", "padding-left: 40px;", "paddingLeft", "40px"],
  ["a split REFUSED for a var()", "padding: var(--w);", "padding-left: 40px;", "paddingLeft", "40px"],
  ["`all` against a shorthand", "all: unset;", "background: red;", "backgroundColor", "rgb(255, 0, 0)"],
  // A shorthand holding a var() never splits and sits in `v`, a word: a longhand beats it, and it
  // beats a counted shorthand wider than itself.
  [
    "a var() shorthand against a longhand",
    "border: var(--b);",
    "border-top-color: blue;",
    "borderTopColor",
    "rgb(0, 0, 255)",
  ],
];

/**
 * Every case again, inside a `@media` both sheets agree about — and the reason is a bug this gate
 * did not see.
 *
 * A conditional rule's layer path is `c`, five digit levels, then the breadth step, and the digit
 * levels are named `d0`…`d9`. When a derived step became `d1` (it is `p` now), the code choosing which names to
 * declare above a level read the first child's initial and handed the conditional level the DIGITS
 * — so `u` sat in a level its own statement had never declared. Every case here was unconditional,
 * so the gate had nothing to say about it.
 */
/**
 * `!important` reverses layer order in CSS — among important declarations the layer declared FIRST
 * wins — so every boundary has to be checked again with it. Measured before the mirror existed, all
 * three of these gave the opposite of what the same two lines give in one hand-written rule.
 */
const IMPORTANT_CASES = [
  [
    "a shorthand against its longhand, both !important",
    "background: red !important;",
    "background-color: blue !important;",
    "backgroundColor",
    "rgb(0, 0, 255)",
  ],
  [
    "`all` against a shorthand, both !important",
    "all: unset !important;",
    "background: red !important;",
    "backgroundColor",
    "rgb(255, 0, 0)",
  ],
  [
    "a split against a written longhand, both !important",
    "padding: 8px !important;",
    "padding-left: 40px !important;",
    "paddingLeft",
    "40px",
  ],
];

const CONDITIONAL = "@media (min-width: 1px)";
const inMedia = (css) => `${CONDITIONAL} { ${css} }`;
const ALL_CASES = [
  ...CASES,
  ...IMPORTANT_CASES,
  ...IMPORTANT_CASES.map(([what, a, b, read, wanted]) => [`${what}, joined not merged`, a, b, read, wanted, true]),
  // Joined instead of merged: the shape `blocks-joined-not-merged` reports, and the only one where
  // a layer decides between two classes that set the same property.
  ...CASES.map(([what, fromPackage, fromApp, read, wanted]) => [
    `${what}, joined not merged`,
    fromPackage,
    fromApp,
    read,
    wanted,
    true,
  ]),
  ...[...CASES, ...IMPORTANT_CASES].map(([what, fromPackage, fromApp, read, wanted]) => [
    `${what}, inside ${CONDITIONAL}`,
    inMedia(fromPackage),
    inMedia(fromApp),
    read,
    wanted,
  ]),
];

const wrong = [];
let tried = 0;

for (const engine of ["chromium", "firefox", "webkit"]) {
  let browser;
  try {
    browser = await pw[engine].launch();
    const tab = await browser.newPage();
    // A doctype, once: replacing `documentElement.innerHTML` keeps the page's mode, and about:blank
    // is QUIRKS — measured, every arrangement here used to run in `BackCompat`.
    await tab.setContent("<!doctype html><html><head></head><body></body></html>");
    if ((await tab.evaluate(() => document.compatMode)) !== "CSS1Compat")
      throw new Error("the page is in quirks mode, and no real page is");

    for (const [what, packageCss, appCss, read, wanted, joinedInstead] of ALL_CASES) {
      const fromPackage = sheetFor("package", packageCss);
      const fromApp = sheetFor("app", appCss);
      /**
       * Merged where the framework merges, and JOINED where it cannot — which is the path the
       * derived layer exists for and the one this gate could not see.
       *
       * `mergeClassNames` settles two classes with one key before the browser is shown either, so
       * routing everything through it asks the cascade nothing about them. A component that joins
       * its caller's `className` into a string never calls it, both class sets land, and the
       * stylesheet decides alone. That is where a split `padding-left` has to lose to a written one.
       */
      const merged = joinedInstead
        ? `${fromPackage.classes.join(" ")} ${fromApp.classes.join(" ")}`
        : String(mergeClassNames(fromPackage.classes.join(" "), fromApp.classes.join(" ")));

      for (const appFirst of [true, false]) {
        const sheets = appFirst ? [fromApp.css, fromPackage.css] : [fromPackage.css, fromApp.css];
        // The break: the layer statement stripped, which is the one thing holding the order
        // together across two files. Without it the answer follows the load order, which is the
        // fault this whole scheme exists to remove.
        const written = selftest === "order" ? sheets.map((one) => one.replace(/^@layer [^;]*;\n/, "")) : sheets;

        tried++;
        const shown = await tab.evaluate(
          ([written, merged, read]) => {
            // A DOCTYPE, because quirks mode is a different CSS and no real page is in it.
            document.documentElement.innerHTML =
              `<head>${written.map((one) => `<style>${one}</style>`).join("")}</head>` +
              `<body><div id=x style="--w:1px;--b:3px solid red;--p:7px 9px;--v:small-caps;--t:10px / 20px" class="${merged}"></div></body>`;
            const found = document.getElementById("x");
            return found === null ? "" : getComputedStyle(found)[read];
          },
          [written, merged, read],
        );
        if (shown !== wanted)
          wrong.push(
            `${engine} ${what}, ${appFirst ? "app's sheet first" : "package's first"}: ${shown} not ${wanted}`,
          );
      }
    }
  } catch (error) {
    // A browser that will not launch is a check that asked LESS, silently.
    console.error(`[skew] ${engine} would not launch: ${String(error).slice(0, 120)}`);
    process.exit(1);
  } finally {
    await browser?.close();
  }
}

console.log(`[skew] ${tried} arrangements across three engines`);

if (wrong.length > 0) {
  console.error(`[skew] ${wrong.length} of ${tried} gave the page the wrong declaration:`);
  for (const one of wrong.slice(0, 6)) console.error(`[skew]   ${one}`);
  process.exit(selftest ? 0 : 1);
}

if (selftest) {
  console.error(`[skew] SELFTEST=${selftest} changed nothing — this check would not catch it.`);
  process.exit(1);
}
console.log(`[skew] every arrangement gives the page the same declaration, in either load order`);
