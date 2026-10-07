/**
 * A PUBLISHED package's stylesheet meeting an application's, when the two were compiled by
 * different releases of this package.
 *
 *     node prototype-package-skew.mjs
 *
 * ## Why a script rather than a test
 *
 * Same reason as `prototype-layers.mjs`: whether a layer order MEANS what it is supposed to mean is
 * the cascade's answer, and the cascade lives in a browser. A test can assert that two stylesheets
 * carry the names we intended; only Chromium says which declaration wins once they are both on the
 * page.
 *
 * ## What is different about this one, and it has to be said
 *
 * **SUPERSEDED — the scheme it modelled is built, and `scripts/check-layer-skew.mjs` checks the
 * real thing.** That gate drives the real compiler, the real `Sheet` and the real
 * `mergeClassNames`, in all three engines and both load orders, and it runs in `pnpm check`.
 * This is kept for the measurement it made while the design was still a proposal: seven
 * arrangements, three of which had to FAIL, and event C — the newcomer having to LOSE — is what
 * made the pre-declared range load-bearing rather than merely tidy.
 *
 * What it does is model the NAMING: the rule bodies, the `@layer ramonda { }` wrapper and the
 * nesting are taken from the real `Sheet` and only the layer names are rewritten. That was the
 * right shape for a proposal and is the wrong shape for a gate, because it can agree with a
 * compiler that no longer writes what it models.
 *
 * That makes the CONTROLS load-bearing rather than decorative. A probe for an unbuilt scheme can
 * always be made to agree with itself, so this one is arranged to fail in four places on purpose:
 * today's naming under a table that grew, the proposed naming under the collision event, the shift
 * applied in the wrong direction, and an unchanged table (which must be silent, or the probe says
 * nothing when it fires).
 *
 * ## The two events, which are not the same event
 *
 * **A — the set of distinct breadths changes.** Today's name is an INDEX into that set, so every
 * name below the change moves, and the two statements end up different LENGTHS. CSS fixes the order
 * on the first statement it sees and can only append an unseen name to the END, past `ramonda.c`.
 * This is what breaks today.
 *
 * **B — a LEAF grows into a shorthand, to exactly the count its own shorthand used to have.**
 * `background-position` covers 2 and `background-position-x` covers 0, the tightest margin in the
 * table (2, across 86 pairs). If the leaf grows to 2, a count-based name puts it where the old
 * package put its shorthand. This is the residual flaw, and the uniform shift is what answers it.
 *
 * ## What is measured
 *
 * One element carrying both classes, which is the shape an application gets when it passes a block
 * into a package's component: `background-position` from the package, `background-position-x` from
 * the application. Different keys, so `mergeClassNames` keeps both and the CASCADE decides. The
 * longhand has to win, in either load order.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { builtFromThisSource } from "../built.mjs";

builtFromThisSource();

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const fromPlayground = createRequire(join(HERE, "..", "..", "apps", "playground-core", "package.json"));
const { chromium } = fromPlayground("@playwright/test");

/**
 * The rules, through the real `Sheet`, so the bodies and the `@layer ramonda { }` nesting are real.
 *
 * TWO pairs, because the two events are not the same event and do not break on the same shape:
 *
 * - **A** needs a CONDITIONAL rule against an unconditional one. What breaks is the statement's
 *   LENGTH, and the name that gets appended lands past `ramonda.c` — so the pair has to straddle
 *   `c`. A shorthand/longhand pair does not: measured, event A leaves it correct by luck.
 * - **B** needs a shorthand against its own longhand, which is where the count collides.
 */
function realSheets() {
  const source =
    `import { Sheet } from "../src/compiler/sheet";\n` +
    `const one = (className, property, css, conditions = []) => ({ className, css, properties: [], selector: "", property, conditions });\n` +
    `const a = new Sheet();\n` +
    `a.add("Button.tsx", [one("r-0cond-4px", "background-position-x", "background-position-x:4px;", ["@media (min-width:1px)"])]);\n` +
    `a.add("App.tsx", [one("r-bgpx-10px", "background-position-x", "background-position-x:10px;")]);\n` +
    `const b = new Sheet();\n` +
    `b.add("Button.tsx", [one("r-bgp-10px", "background-position", "background-position:10px 10px;")]);\n` +
    `b.add("App.tsx", [one("r-bgpx-4px", "background-position-x", "background-position-x:4px;")]);\n` +
    `process.stdout.write(\`<<<\${JSON.stringify({\n` +
    `  aPkg: a.cssFor("Button.tsx"), aApp: a.cssFor("App.tsx"),\n` +
    `  bPkg: b.cssFor("Button.tsx"), bApp: b.cssFor("App.tsx"),\n` +
    `})}>>>\`);\n`;
  const room = mkdtempSync(join(HERE, "prototype-package-skew-"));
  try {
    writeFileSync(join(room, "ask.ts"), source);
    const printed = execFileSync("npx", ["vite-node", join(room, "ask.ts")], {
      cwd: HERE,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(printed.slice(printed.indexOf("<<<") + 3, printed.lastIndexOf(">>>")));
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
}

/**
 * Put a different statement on a stylesheet, and optionally a different layer PATH on its rule.
 *
 * A PATH rather than a name, because the shift is a NESTED layer rather than a smaller number.
 * Measured, and it is the finding that sent the first draft of this probe back: a uniform shift
 * needs room between adjacent names, and room has to be DECLARED — a scale of 1000 over 1024 counts
 * is a million names, about 14 MB of statement. A nested layer needs none: it sits between the
 * layer declared before its parent and its parent's own rules, and the top-level statement does not
 * change at all.
 *
 *     shift 0             ["u0002"]            the count's own layer
 *     one step stronger   ["u0001", "s"]       inside the next-stronger name
 *     one step weaker     ["u0002", "s"]       inside its own — the direction control
 *
 * `path` of `null` leaves the body alone, which is what the conditional half of event A needs: its
 * rule lives in `ramonda.c` under the sheet's own digit layers, and `c` is last in both statements.
 */
function renamed(css, statement, path) {
  if (path === null) return css.replace(/^@layer [^;]*;/, statement);
  const shape = /@layer ramonda \{\n@layer u\d+ \{\n([\s\S]*?)\n\}\n\}\n$/.exec(css);
  if (shape === null) throw new Error("the sheet's shape changed — this probe rewrites it by hand");
  const opened = path.map((step) => `@layer ${step} {`).join("\n");
  const closed = path.map(() => "}").join("\n");
  return `${statement}\n@layer ramonda {\n${opened}\n${shape[1]}\n${closed}\n}\n`;
}

// ── The two namings ─────────────────────────────────────────────────────────────────────────────

/** TODAY: the name is the POSITION in the sorted set of distinct breadths, and `c` comes last. */
const today = (table) => ({
  statement: `@layer ${table.breadths.map((_, at) => `ramonda.u${String(at).padStart(2, "0")}`).join(",")},ramonda.c;`,
  pathFor: (count) => [`u${String(table.breadths.indexOf(count)).padStart(2, "0")}`],
});

/**
 * PROPOSED: the name IS the count, over a dense range declared in full, largest first — broadest is
 * weakest. Every version emits the identical statement, so no name is ever new and nothing is ever
 * appended. 1024 names cost 2156 B gzipped, once per page.
 */
const RANGE = 1024;
const STATEMENT = `@layer ${[...Array(RANGE).keys()]
  .reverse()
  .map((i) => `ramonda.u${String(i).padStart(4, "0")}`)
  .join(",")},ramonda.c;`;
const name = (count) => `u${String(count).padStart(4, "0")}`;
const proposed = (steps) => (_table, side) => ({
  statement: STATEMENT,
  // `side` is 0 for the package, 1 for the application: only the NEW build carries the shift.
  pathFor: (count) => {
    const shift = side === 1 ? steps : 0;
    return shift === 0 ? [name(count)] : shift > 0 ? [name(count - 1), "s"] : [name(count), "s"];
  },
});

// ── The tables ──────────────────────────────────────────────────────────────────────────────────

/** Today's distinct breadths. `bgp` and `bgpx` are what our two properties cover in it. */
const T0 = { breadths: [559, 53, 25, 21, 20, 16, 15, 12, 11, 10, 8, 7, 6, 5, 4, 3, 2, 0], bgp: 2, bgpx: 0, wide: 2 };
/** EVENT A: CSS gained a shorthand covering 9, a count nothing held — one more name, and every
 *  index below it moves. Neither of our properties changed; the STATEMENT did. */
const A = { breadths: [559, 53, 25, 21, 20, 16, 15, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 0], bgp: 2, bgpx: 0, wide: 9 };
/** EVENT B: `background-position-x` grew into a shorthand over two sub-properties, so it now covers
 *  exactly what `background-position` covered when the package was built. The tightest pair there
 *  is: a margin of 2, one of 86 such pairs. */
const B = { breadths: [559, 53, 25, 21, 20, 16, 15, 12, 11, 10, 8, 7, 6, 5, 4, 3, 2, 0], bgp: 4, bgpx: 2, wide: 4 };

const SHEETS = realSheets();

const browser = await chromium.launch();
const tab = await browser.newPage();

async function winner(sheets, classes) {
  await tab.setContent(
    `<!doctype html>${sheets.map((css) => `<style>${css}</style>`).join("")}` +
      `<div id="probe" class="${classes}"></div>`,
  );
  return tab.evaluate(() => getComputedStyle(document.getElementById("probe")).backgroundPositionX);
}

/** What the package writes must win in both events: the `@media` rule in A, the longhand in B. */
const WANT = "4px";
const rows = [];
let wrong = 0;

/**
 * One case, in BOTH load orders — which stylesheet a bundler puts first is not ours to decide.
 *
 * `expect` is what the row is supposed to DO, not what we hope: `"breaks"` marks the rows this
 * probe has to see fail. A probe for a scheme that is not built can always be made to agree with
 * itself, so those rows are what make the others mean anything.
 */
async function measure(what, event, naming, was, now, expect) {
  const { pkg, app, classes, pkgPath, appCount = "bgpx" } = event;
  // TWO namings, and keeping them apart is the whole point: the package is the OLD build. It was
  // compiled against `was` and knows nothing of any shift the application applies. Handing both
  // sides one naming is what the first run of this probe did, and it quietly passed the shift to
  // the frozen half.
  const old = naming(was, 0);
  const fresh = naming(now, 1);
  const left = renamed(SHEETS[pkg], old.statement, pkgPath === null ? null : old.pathFor(was[pkgPath]));
  const right = renamed(SHEETS[app], fresh.statement, fresh.pathFor(now[appCount]));

  const packageFirst = await winner([left, right], classes);
  const appFirst = await winner([right, left], classes);
  const held = packageFirst === WANT && appFirst === WANT;
  const got = held ? "ok" : "breaks";
  if (got !== expect) wrong++;
  rows.push([what, `${packageFirst} / ${appFirst}`, got, got === expect ? "" : `  EXPECTED ${expect}`]);
}

/** A: the package's rule is CONDITIONAL, so it lives in `c` and the appended name lands past it. */
const STRADDLES_C = { pkg: "aPkg", app: "aApp", classes: "r-0cond-4px r-bgpx-10px", pkgPath: null };
/** B: the package's rule is the SHORTHAND, the application's its longhand. */
const SHORTHAND = { pkg: "bPkg", app: "bApp", classes: "r-bgp-10px r-bgpx-4px", pkgPath: "bgp" };
/**
 * C: the sides SWAPPED — the package holds the longhand and the application the shorthand, so the
 * application's rule has to LOSE.
 *
 * This is the row that makes the pre-declared range load-bearing, and without it the range can be
 * cut to three names and every other row still passes. Appending an unseen name puts it at the END,
 * which is the STRONGEST position — so it only does damage where the newcomer was supposed to be
 * weak. Every other pair here wants the newer half to win, and is rescued by the very thing that is
 * meant to be the fault.
 */
const SWAPPED = { pkg: "bApp", app: "bPkg", classes: "r-bgp-10px r-bgpx-4px", pkgPath: "bgpx", appCount: "wide" };

// Controls first: an unchanged table must be silent under both namings, or the probe says nothing
// when it fires.
await measure("control · today, table unchanged", STRADDLES_C, today, T0, T0, "ok");
await measure("control · proposed, table unchanged", SHORTHAND, proposed(0), T0, T0, "ok");

await measure("event A · today", STRADDLES_C, today, T0, A, "breaks");
await measure("event A · proposed", STRADDLES_C, proposed(0), T0, A, "ok");

await measure("event C · proposed, newcomer must LOSE", SWAPPED, proposed(0), T0, A, "ok");

await measure("event B · proposed, no shift", SHORTHAND, proposed(0), T0, B, "breaks");
await measure("event B · proposed, shift stronger", SHORTHAND, proposed(1), T0, B, "ok");
await measure("event B · proposed, shift weaker", SHORTHAND, proposed(-1), T0, B, "breaks");

const width = Math.max(...rows.map(([what]) => what.length));
console.log(`\n  package-first / app-first — what the package wrote must win (${WANT})\n`);
for (const [what, got, verdict, note] of rows) {
  console.log(`   ${what.padEnd(width)}  ${got.padEnd(14)}  ${verdict.padEnd(7)}${note}`);
}
console.log(
  wrong === 0
    ? "\n  every row did what it was supposed to, including the three that had to fail.\n"
    : `\n  ${wrong} row(s) did NOT — read the EXPECTED notes above.\n`,
);

await browser.close();
process.exit(wrong === 0 ? 0 : 1);
