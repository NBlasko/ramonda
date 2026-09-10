/**
 * The cascade, in Chromium: is the sheet's order independent of the order the stylesheets load in?
 *
 * ## Why a script rather than a test
 *
 * The question is one only a browser answers. A test can read the CSS and say every rule is in the
 * layer its rank asks for and every stylesheet declares the whole order — `sheet.test.ts` and
 * `viteBuild.test.ts` do, the second on a real production build — but whether that MEANS what it is
 * supposed to mean is the cascade's answer, and the cascade lives in the browser.
 *
 *     node prototype-layers.mjs
 *
 * Chromium and lightningcss are not dependencies of this package, so both are resolved out of
 * `apps/playground-core`, which has them. The stylesheets come from the REAL `Sheet` through a
 * `vite-node` subprocess: a probe that re-implements the scheme it is checking measures nothing.
 *
 * ## The fault
 *
 * One rule is written into the stylesheet of every file that names it — that is what lets a chunk
 * stand on its own, and an owner-per-rule was measured to leave a lazily-loaded route naming a class
 * no stylesheet held. But a stylesheet is a SEQUENCE, so a file re-emitting a shared rule puts it
 * after the rules of whichever file loaded first, and same-specificity later-wins undoes the order.
 *
 * `Card.tsx` writes `color: red` and `@media { color: blue }`; `Panel.tsx` writes only `color: red`.
 * Card alone renders blue. Card then Panel renders RED. Adding an unrelated component moved a page
 * nobody edited, and nothing could report it: Card is internally correct and Panel is innocent.
 *
 * ## What is measured
 *
 * 1. the fault, and that the layers fix it — the conditional shape and the shorthand shape;
 * 2. that the WHOLE statement has to be in every stylesheet;
 * 3. what must not change: the app's own CSS, its `!important`, its ordering of `ramonda`, and a
 *    layer still outranking specificity;
 * 4. a sweep of random rule sets across three files, every load order, through both minifiers;
 * 5. two BREAKPOINTS, which a layer per rank could not tell apart until the sheet read the query;
 * 6. what is still open — two conditions the sheet cannot order at all.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const fromPlayground = createRequire(join(HERE, "..", "..", "apps", "playground-core", "package.json"));
const { chromium } = fromPlayground("@playwright/test");
const esbuild = createRequire(join(HERE, "package.json"))("esbuild");
const lightning = createRequire(fromPlayground.resolve("vite"))("lightningcss");

/** One declaration in the shape `Sheet.add` takes, with the CSS text the sheet would have written. */
const plain = (className, property, value) => ({
  className,
  property,
  css: `${property}:${value};`,
});
const under = (className, property, value, query) => ({
  className,
  property,
  value,
  query,
  css: `${property}:${value};`,
  conditions: [query],
});

/**
 * Every case's stylesheets, from the real `Sheet`, in ONE subprocess.
 *
 * A case is `{ file: [declaration] }` and comes back as `{ file: css }`. All of them at once because
 * starting `vite-node` costs a second and a sweep asks for hundreds.
 */
function stylesheetsFor(cases) {
  const source =
    `import { Sheet } from "./src/compiler/sheet";\n` +
    `const cases = JSON.parse(process.env.RAMONDA_CASES);\n` +
    `const out = cases.map((files) => {\n` +
    `  const sheet = new Sheet();\n` +
    `  for (const [name, rules] of Object.entries(files)) sheet.add(name, rules.map((one) => ({\n` +
    `    className: one.className, css: one.css, properties: [], selector: "",\n` +
    `    property: one.property, conditions: one.conditions,\n` +
    `  })));\n` +
    `  return Object.fromEntries(Object.keys(files).map((name) => [name, sheet.cssFor(name)]));\n` +
    `});\n` +
    `process.stdout.write(\`<<<\${JSON.stringify(out)}>>>\`);\n`;

  // A file rather than stdin, which `vite-node` does not read; inside the package, so its own
  // relative import of the sheet resolves.
  const room = mkdtempSync(join(HERE, "prototype-layers-"));
  try {
    writeFileSync(join(room, "ask.ts"), source.replaceAll("./src/", "../src/"));
    const printed = execFileSync("npx", ["vite-node", join(room, "ask.ts")], {
      cwd: HERE,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, RAMONDA_CASES: JSON.stringify(cases) },
    });
    return JSON.parse(printed.slice(printed.indexOf("<<<") + 3, printed.lastIndexOf(">>>")));
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
}

/** The layer statement the sheet begins every stylesheet with. */
const statementIn = (css) => /^@layer [^;]*;/.exec(css)?.[0] ?? "";

/**
 * The same stylesheet as it was BEFORE the layers: one `@layer ramonda`, the rules in the order the
 * sheet already put them in. Derived from the real output, so the comparison stays honest.
 */
function withoutLayers(css) {
  const body = css.slice(statementIn(css).length);
  let out = "";
  let depth = 0;
  for (let at = 0; at < body.length; at++) {
    const opener = /^@layer [\w.,]* ?\{/.exec(body.slice(at));
    if (opener !== null) {
      at += opener[0].length - 1;
      depth++;
      continue;
    }
    if (body[at] === "}" && depth > 0) {
      // A rule's own brace, or a layer's — a layer's is the one at the depth we are tracking.
      const rest = body.slice(at + 1).trimStart();
      if (rest === "" || rest.startsWith("@layer") || rest.startsWith("}")) {
        depth--;
        continue;
      }
    }
    if (/^@layer [\w.,]*;/.test(body.slice(at))) {
      at += /^@layer [\w.,]*;/.exec(body.slice(at))[0].length - 1;
      continue;
    }
    out += body[at];
  }
  return `@layer ramonda {${out}}`;
}

/** The statement trimmed to the layers this stylesheet actually uses. */
function subsetStatement(css) {
  const statement = statementIn(css);
  const used = new Set([...css.matchAll(/@layer (u\d+|c) \{/g)].map((one) => `ramonda.${one[1]}`));
  const kept = statement
    .slice("@layer ".length, -1)
    .split(",")
    .filter((one) => used.has(one));
  return kept.length === 0 ? css.slice(statement.length) : `@layer ${kept.join(",")};${css.slice(statement.length)}`;
}

/** No statement at all, so the order is first-USE order. */
const withoutStatement = (css) => css.slice(statementIn(css).length);

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

// ── 1. The fault, and the fix ───────────────────────────────────────────────────────────────────
const RED = plain("rRed", "color", "red");
const BLUE = under("rBlue", "color", "blue", "@media (min-width:1px)");
const MARGIN = plain("rM", "margin", "0px");
const LEFT = plain("rML", "margin-left", "4px");

const [colour, sides, leftOnly] = stylesheetsFor([
  { "Card.tsx": [RED, BLUE], "Panel.tsx": [RED] },
  { "Card.tsx": [MARGIN, LEFT], "Panel.tsx": [MARGIN] },
  { "Left.tsx": [LEFT], "Card.tsx": [MARGIN, LEFT] },
]);
const COLOURED = "rRed rBlue";
const SIDES = "rM rML";
const BLUEISH = "rgb(0, 0, 255)";
const card = colour["Card.tsx"];
const panel = colour["Panel.tsx"];

await row("before · card alone", [withoutLayers(card)], COLOURED, "color", BLUEISH);
await row("before · card, panel", [withoutLayers(card), withoutLayers(panel)], COLOURED, "color", BLUEISH);
await row("before · panel, card", [withoutLayers(panel), withoutLayers(card)], COLOURED, "color", BLUEISH);
await row("layers · card alone", [card], COLOURED, "color", BLUEISH);
await row("layers · card, panel", [card, panel], COLOURED, "color", BLUEISH);
await row("layers · panel, card", [panel, card], COLOURED, "color", BLUEISH);

await row(
  "before · margin card, panel",
  [withoutLayers(sides["Card.tsx"]), withoutLayers(sides["Panel.tsx"])],
  SIDES,
  "margin-left",
  "4px",
);
await row("layers · margin card, panel", [sides["Card.tsx"], sides["Panel.tsx"]], SIDES, "margin-left", "4px");
await row("layers · margin panel, card", [sides["Panel.tsx"], sides["Card.tsx"]], SIDES, "margin-left", "4px");
report("the fault, and the fix");

// ── 2. Why the whole statement ──────────────────────────────────────────────────────────────────
// A file holding only `margin-left` loading first: CSS appends a name it has not seen to the END of
// the order, so the shorthand's layer lands after the longhand's and the override dies.
const left = leftOnly["Left.tsx"];
const both = leftOnly["Card.tsx"];
await row(
  "subset       · left-only, then card",
  [subsetStatement(left), subsetStatement(both)],
  SIDES,
  "margin-left",
  "4px",
);
await row(
  "no statement · left-only, then card",
  [withoutStatement(left), withoutStatement(both)],
  SIDES,
  "margin-left",
  "4px",
);
await row("whole list   · left-only, then card", [left, both], SIDES, "margin-left", "4px");
report("why every stylesheet declares the whole order");

// ── 3. What must not change ─────────────────────────────────────────────────────────────────────
const GREEN = "rgb(0, 128, 0)";
await row("the app's own stylesheet wins", [card, ".rRed{color:green}"], COLOURED, "color", GREEN);
await row("the app's !important wins", [card, ".rRed{color:green!important}"], COLOURED, "color", GREEN);
await row(
  "the app can put ramonda after its own layer",
  ["@layer app,ramonda;", card, "@layer app{.rRed{color:green}}"],
  COLOURED,
  "color",
  BLUEISH,
);
await row(
  "the app can put ramonda before it",
  ["@layer ramonda,app;", card, "@layer app{.rRed{color:green}}"],
  COLOURED,
  "color",
  GREEN,
);
await row(
  "a layer still outranks specificity",
  [card, ".rRed{color:green}".replace(".rRed", "#nothing")],
  COLOURED,
  "color",
  BLUEISH,
);
const [specific] = stylesheetsFor([{ "One.tsx": [{ ...RED, css: "color:red;" }, BLUE] }]);
await row(
  "an #id in an earlier layer loses to a later layer",
  [specific["One.tsx"].replace(".rRed", "#probe.rRed")],
  COLOURED,
  "color",
  BLUEISH,
);
report("what the layers must not change, and do not");

// ── 4. The sweep ────────────────────────────────────────────────────────────────────────────────
let seed = 20260910;
const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

/**
 * A ladder of declarations of one property, each of which must beat the one before it: the shorthand
 * first, then the longhand, then the same under narrowing `max-width`s and widening `min-width`s.
 *
 * **Every rung has to MATCH the page**, or it decides nothing and the ladder measures nothing —
 * which is how this probe was wrong once: `@media print` never applies to a screen, so the rung
 * looked like a failure of the layers rather than of the fixture. The viewport is Playwright's
 * default 1280×720, so these are chosen around it.
 */
const LADDER = [
  plain("g0", "padding", "0px"),
  plain("g1", "padding-left", "1px"),
  under("g2", "padding-left", "2px", "@media (max-width: 4000px)"),
  under("g3", "padding-left", "3px", "@media (max-width: 2000px)"),
  under("g4", "padding-left", "4px", "@media (min-width: 1px)"),
  under("g5", "padding-left", "5px", "@media (min-width: 40rem)"),
  under("g6", "padding-left", "6px", "@media (min-width: 64rem)"),
];

const rounds = [];
for (let round = 0; round < 200; round++) {
  const files = [0, 1, 2].map(() => LADDER.filter(() => random() < 0.5)).filter((one) => one.length > 0);
  if (files.length > 0) rounds.push(files);
}
const swept = stylesheetsFor(rounds.map((files) => Object.fromEntries(files.map((one, at) => [`f${at}.tsx`, one]))));

console.log("\n## swept: random rule sets across three files, every load order");
for (const [label, minify] of Object.entries(minifiers)) {
  let checked = 0;
  const wrong = [];
  for (const [index, files] of rounds.entries()) {
    const sheets = Object.values(swept[index]).map(minify);
    const all = files.flat();
    const want = `${Math.max(...all.map((one) => LADDER.indexOf(one)))}px`;
    const classes = [...new Set(all.map((one) => one.className))].join(" ");
    for (const order of [sheets, [...sheets].reverse(), [sheets.at(-1), ...sheets.slice(0, -1)]]) {
      const got = await computed(order, classes, "padding-left");
      checked++;
      if (got !== want)
        wrong.push({ want, got, files: files.map((one) => one.map((each) => each.className).join("+")) });
    }
  }
  console.log(`   ${label.padEnd(14)} ${String(checked).padStart(4)} load orders  ${wrong.length} wrong`);
  for (const one of wrong.slice(0, 3)) console.log(`      ${JSON.stringify(one)}`);
}

// The last rung of that ladder, before the sheet read the query: `g5` and `g6` are two breakpoints,
// and until the width came off the query they ranked the same and shared a layer.
const [breaks] = stylesheetsFor([{ "Card.tsx": [LADDER[5], LADDER[6]], "Panel.tsx": [LADDER[5]] }]);
await row("two breakpoints · card, panel", [breaks["Card.tsx"], breaks["Panel.tsx"]], "g5 g6", "padding-left", "6px");
await row("two breakpoints · panel, card", [breaks["Panel.tsx"], breaks["Card.tsx"]], "g5 g6", "padding-left", "6px");
report("two breakpoints, which the rank alone could not separate");

// ── 5. What is still open ───────────────────────────────────────────────────────────────────────
/**
 * Two conditions with no width in them — `min-height` against `@supports` — land in the same slot,
 * because there is no number to compare. The sheet falls back to the order the file wrote, so a
 * second file writing one of the two can still reverse it. That is the half no layer settles, and
 * `PLAN.md` holds the two routes out.
 */
const TALL = under("hA", "padding-left", "1px", "@media (min-height: 1px)");
const SUPPORTED = under("hB", "padding-left", "2px", "@supports (display: grid)");
const [tied] = stylesheetsFor([{ "Card.tsx": [TALL, SUPPORTED], "Panel.tsx": [TALL] }]);
await row("same slot · card alone", [tied["Card.tsx"]], "hA hB", "padding-left", "2px");
await row("same slot · card, panel", [tied["Card.tsx"], tied["Panel.tsx"]], "hA hB", "padding-left", "2px");
report("still open: two conditions carrying no width");

// ── What it costs ───────────────────────────────────────────────────────────────────────────────
const [sized] = stylesheetsFor([{ "Card.tsx": LADDER }]);
const whole = sized["Card.tsx"];
console.log(`\n## what the scheme costs, on a file holding all ${LADDER.length} rungs`);
console.log(
  `   with layers    ${String(whole.length).padStart(5)} bytes  ${gzipSync(Buffer.from(whole)).length} gzipped`,
);
const bare = withoutLayers(whole);
console.log(
  `   without them   ${String(bare.length).padStart(5)} bytes  ${gzipSync(Buffer.from(bare)).length} gzipped`,
);

await browser.close();
