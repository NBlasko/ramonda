/**
 * The cascade, in Chromium: does a layer per rank make the sheet's order independent of the order
 * the stylesheets load in?
 *
 * ## Why this exists as a script rather than a test
 *
 * The question is one only a browser answers. A test can read the CSS and say every rule is in the
 * layer for its rank and every stylesheet declares the whole order — `viteBuild.test.ts` does, on a
 * real production build — but whether that MEANS what it is supposed to mean is the cascade's
 * answer, and the cascade lives in the browser. Chromium is not a dependency of this package, so
 * this resolves Playwright out of `apps/playground-core`, which has it.
 *
 *     node prototype-layers.mjs
 *
 * ## The fault
 *
 * One rule is written into the stylesheet of every file that names it — that is what lets a chunk
 * stand on its own, and an owner-per-rule was measured to leave a lazily-loaded route naming a class
 * no stylesheet held. But a stylesheet is a SEQUENCE, so a file re-emitting a shared rule puts it
 * after the rules of whichever file loaded first, and same-specificity later-wins undoes the order
 * the rank promised.
 *
 * `Card.tsx` writes `color: red` and `@media { color: blue }`; `Panel.tsx` writes only `color: red`.
 * Card alone renders blue. Card then Panel renders RED. Adding an unrelated component moved a page
 * nobody edited, and nothing could report it: Card is internally correct and Panel is innocent.
 *
 * ## What is measured here
 *
 * 1. the fault, and that the layers fix it — both shapes the review found;
 * 2. that the WHOLE rank list has to be declared in every stylesheet, because a subset is worse than
 *    useless and no statement at all fails the same way;
 * 3. a sweep: random rank sets across three files, every load order, through both minifiers a Vite
 *    build can use;
 * 4. what must not change — the app's own CSS, its `!important`, its ability to place `ramonda`
 *    against its own layers, and a layer still outranking specificity;
 * 5. the same-rank case, which layers CANNOT fix, and the scheme that looked like it would.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The ranks and their layer names, copied from `sheetRank` in `src/compiler/flatten.ts`.
 *
 * Copied rather than imported because this is a script and that is TypeScript. The copy cannot drift
 * unnoticed: `sheet.test.ts` asserts a stylesheet declares exactly `SHEET_RANKS.length` layers, so a
 * change to the shorthand table shows up there, and the names here are positions in this list.
 */
const SHEET_RANKS = [
  -41, -16, -13, -10, -9, -8, -7, -6, -5, -3, -2, 0, 959, 984, 987, 990, 991, 992, 993, 994, 995, 997, 998, 1000,
];
const layerFor = (rank) => `ramonda.r${String(SHEET_RANKS.indexOf(rank)).padStart(2, "0")}`;
const LAYER_ORDER = `@layer ${SHEET_RANKS.map(layerFor).join(",")};`;

const HERE = dirname(fileURLToPath(import.meta.url));
const fromPlayground = createRequire(join(HERE, "..", "..", "apps", "playground-core", "package.json"));
const { chromium } = fromPlayground("@playwright/test");
const esbuild = createRequire(join(HERE, "package.json"))("esbuild");
/** Vite's own copy, because lightningcss is what a project opts into through Vite. */
const lightning = fromPlayground.resolve("vite") && createRequire(fromPlayground.resolve("vite"))("lightningcss");

/** What the sheet emits now: the whole rank order, then a layer per rank. */
const sheet = (rules) => {
  let out = `${LAYER_ORDER}\n`;
  for (const rank of SHEET_RANKS) {
    const mine = rules.filter(([one]) => one === rank);
    if (mine.length > 0) out += `@layer ${layerFor(rank)}{${mine.map(([, css]) => css).join("")}}\n`;
  }
  return out;
};

/** What it emitted before: one `ramonda`, the rules in rank order inside it. */
const before = (rules) =>
  `@layer ramonda{${[...rules]
    .sort((a, b) => a[0] - b[0])
    .map(([, css]) => css)
    .join("")}}`;

/** A file declaring only the ranks it uses — the version that looks like it would do. */
const subset = (rules) =>
  `@layer ${[...new Set(rules.map(([rank]) => layerFor(rank)))].join(",")};` +
  rules.map(([rank, css]) => `@layer ${layerFor(rank)}{${css}}`).join("");

/** No statement at all, so the order is first-USE order. */
const noStatement = (rules) => rules.map(([rank, css]) => `@layer ${layerFor(rank)}{${css}}`).join("");

const minifiers = {
  "not minified": (css) => css,
  esbuild: (css) => esbuild.transformSync(css, { loader: "css", minify: true }).code,
  lightningcss: (css) =>
    lightning
      .transform({ filename: "x.css", code: Buffer.from(css), minify: true, targets: { chrome: 120 << 16 } })
      .code.toString(),
};

const browser = await chromium.launch();
const tab = await browser.newPage();

async function computed(sheets, classes, property) {
  await tab.setContent(
    `${sheets.map((css) => `<style>${css}</style>`).join("")}<div id="probe" class="${classes}"></div>`,
  );
  return tab.evaluate((name) => getComputedStyle(document.getElementById("probe")).getPropertyValue(name), property);
}

const rows = [];
async function row(what, sheets, classes, property, want) {
  const got = await computed(sheets, classes, property);
  rows.push([what, got, got === want ? "ok" : `WANTED ${want}`]);
}

function report(title) {
  console.log(`\n## ${title}`);
  const width = Math.max(...rows.map(([what]) => what.length));
  for (const [what, got, verdict] of rows) console.log(`   ${what.padEnd(width)}  ${got.padEnd(16)}  ${verdict}`);
  rows.length = 0;
}

// ─── 1. The fault, and the fix ──────────────────────────────────────────────────────────────────
const RED = [0, ".rRed{color:red}"];
const BLUE = [1000, "@media (min-width:1px){.rBlue{color:blue}}"];
const CARD = [RED, BLUE];
const PANEL = [RED];
const COLOURED = "rRed rBlue";
const BLUEISH = "rgb(0, 0, 255)";

await row("before · card alone", [before(CARD)], COLOURED, "color", BLUEISH);
await row("before · card, panel", [before(CARD), before(PANEL)], COLOURED, "color", BLUEISH);
await row("before · panel, card", [before(PANEL), before(CARD)], COLOURED, "color", BLUEISH);
await row("layers · card alone", [sheet(CARD)], COLOURED, "color", BLUEISH);
await row("layers · card, panel", [sheet(CARD), sheet(PANEL)], COLOURED, "color", BLUEISH);
await row("layers · panel, card", [sheet(PANEL), sheet(CARD)], COLOURED, "color", BLUEISH);

// The shorthand half of the same finding: a longhand emitted after a shorthand, re-emitted by a
// second file that writes only the shorthand.
const MARGIN = [-3, ".rM{margin:0px}"];
const LEFT = [0, ".rML{margin-left:4px}"];
const CARD_M = [MARGIN, LEFT];
const SIDES = "rM rML";
await row("before · margin card, panel", [before(CARD_M), before([MARGIN])], SIDES, "margin-left", "4px");
await row("layers · margin card, panel", [sheet(CARD_M), sheet([MARGIN])], SIDES, "margin-left", "4px");
await row("layers · margin panel, card", [sheet([MARGIN]), sheet(CARD_M)], SIDES, "margin-left", "4px");
report("the fault, and the fix");

// ─── 2. Why the whole list ──────────────────────────────────────────────────────────────────────
// A file holding only `margin-left` loading first: CSS appends a name it has not seen to the END of
// the order, so the shorthand's layer lands after the longhand's and the override dies.
await row("subset      · left-only, then card", [subset([LEFT]), subset(CARD_M)], SIDES, "margin-left", "4px");
await row(
  "no statement · left-only, then card",
  [noStatement([LEFT]), noStatement(CARD_M)],
  SIDES,
  "margin-left",
  "4px",
);
await row("whole list  · left-only, then card", [sheet([LEFT]), sheet(CARD_M)], SIDES, "margin-left", "4px");
report("why every stylesheet declares the whole rank order");

// ─── 3. What must not change ────────────────────────────────────────────────────────────────────
await row("the app's own stylesheet wins", [sheet(CARD), ".rRed{color:green}"], COLOURED, "color", "rgb(0, 128, 0)");
await row(
  "the app's !important wins",
  [sheet(CARD), ".rRed{color:green!important}"],
  COLOURED,
  "color",
  "rgb(0, 128, 0)",
);
await row(
  "the app can put ramonda after its own layer",
  ["@layer app,ramonda;", sheet(CARD), "@layer app{.rRed{color:green}}"],
  COLOURED,
  "color",
  BLUEISH,
);
await row(
  "the app can put ramonda before it",
  ["@layer ramonda,app;", sheet(CARD), "@layer app{.rRed{color:green}}"],
  COLOURED,
  "color",
  "rgb(0, 128, 0)",
);
await row(
  "a layer still outranks specificity",
  [sheet([[0, "#probe.rRed{color:red}"], BLUE])],
  COLOURED,
  "color",
  BLUEISH,
);
report("what a sub-layer must not change, and does not");

// ─── 4. The sweep ───────────────────────────────────────────────────────────────────────────────
console.log("\n## swept: random rank sets across three files, every load order");
let seed = 20260910;
const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pickRanks = () => SHEET_RANKS.filter(() => random() < 0.25);
const ranked = (ranks) =>
  ranks.map((rank) => [rank, `.k${SHEET_RANKS.indexOf(rank)}{padding-left:${SHEET_RANKS.indexOf(rank)}px}`]);

for (const [label, minify] of Object.entries(minifiers)) {
  let checked = 0;
  const wrong = [];
  for (let round = 0; round < 250; round++) {
    const files = [pickRanks(), pickRanks(), pickRanks()].filter((one) => one.length > 0);
    if (files.length === 0) continue;
    const all = [...new Set(files.flat())];
    const want = `${Math.max(...all.map((rank) => SHEET_RANKS.indexOf(rank)))}px`;
    const classes = all.map((rank) => `k${SHEET_RANKS.indexOf(rank)}`).join(" ");
    for (const order of [files, [...files].reverse(), [files.at(-1), ...files.slice(0, -1)]]) {
      const got = await computed(
        order.map((one) => minify(sheet(ranked(one)))),
        classes,
        "padding-left",
      );
      checked++;
      if (got !== want) wrong.push({ want, got, files: order.map((one) => one.map(layerFor).join("+")) });
    }
  }
  console.log(`   ${label.padEnd(14)} ${String(checked).padStart(4)} load orders  ${wrong.length} wrong`);
  for (const one of wrong.slice(0, 3)) console.log(`      ${JSON.stringify(one)}`);
}

// ─── 5. What layers cannot fix ──────────────────────────────────────────────────────────────────
/**
 * Two declarations of the SAME rank — two overlapping conditions on one property, which is what
 * mobile-first breakpoints are. The rank does not separate them, so they share a layer and the
 * sequence decides again.
 *
 * The obvious repair is a layer per position within the rank, in the author's own order, and it is
 * measured below to be WRONG: the position is a property of the FILE, so a shared rule gets a
 * different layer in each file that names it. Any per-file scheme fails the same way, because CSS
 * appends an unseen layer name to the end of the order — a stylesheet cannot declare an order it
 * does not yet know, and a file emitting one half of a pair does not know the other half exists.
 */
/** Five overlapping conditions on one property, of which each file takes a subset. */
const POOL = [0, 1, 2, 3, 4];
const conditional = (which) => `@media (min-width:${which + 1}px){.p${which}{padding-left:${which}px}}`;

/** The scheme measured now: they share a rank, so they share a layer. */
const oneLayer = (subsetOf) => sheet(subsetOf.map((which) => [1000, conditional(which)]));

/** The obvious repair: a layer per POSITION within the rank, in the author's own order. */
const positional = (subsetOf) =>
  `@layer ${layerFor(1000)};@layer ${layerFor(1000)}{@layer ${subsetOf.map((_, at) => `s${at}`).join(",")};` +
  subsetOf.map((which, at) => `@layer s${at}{${conditional(which)}}`).join("") +
  "}";

console.log("\n## the same-rank case: overlapping conditions on one property");
seed = 7;
for (const [label, build] of [
  ["one layer", oneLayer],
  ["a layer per position", positional],
]) {
  let checked = 0;
  let wrong = 0;
  const example = [];
  for (let round = 0; round < 250; round++) {
    // Every file agrees about the order — it takes a subset of one list — so nothing is ambiguous.
    const files = [0, 1, 2].map(() => POOL.filter(() => random() < 0.5)).filter((one) => one.length > 0);
    if (files.length === 0) continue;
    const all = [...new Set(files.flat())];
    const want = `${Math.max(...all)}px`;
    const classes = all.map((which) => `p${which}`).join(" ");
    for (const order of [files, [...files].reverse(), [files.at(-1), ...files.slice(0, -1)]]) {
      const got = await computed(order.map(build), classes, "padding-left");
      checked++;
      if (got !== want) {
        wrong++;
        if (example.length === 0) example.push({ files: order, want, got });
      }
    }
  }
  console.log(`   ${label.padEnd(20)} ${String(checked).padStart(4)} load orders  ${wrong} wrong`);
  for (const one of example) console.log(`      ${JSON.stringify(one)}`);
}

/**
 * Both fail, and the reason is the same one that makes the rank layers work: a layer's place is
 * fixed by its DECLARATION, and CSS appends a name it has not seen to the END of the order. A
 * position is a property of the FILE, so a shared rule gets a different layer in each file that
 * names it; and a file emitting one half of a pair cannot declare an order for a half it has never
 * seen. No per-file scheme settles this — it needs the rank itself to separate them, or a report.
 */

await browser.close();
