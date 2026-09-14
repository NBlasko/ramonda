/**
 * What stricter property types cost `tsc`, measured before any are written.
 *
 *     node packages/css/prototype-strict-types.mjs
 *
 * ## The question
 *
 * 623 of 766 properties are typed `CssValue`, which is `string | number` — so `gap: 12` and
 * `letter-spacing: 12` compile, and a browser drops both. 100 standard non-vendor properties state
 * ONE primitive type in their grammar and could say so instead.
 *
 * The user's constraint on doing that, in their words: *"posto pravimo veoma stroge tipove, pisi ih
 * performantno, dakle da nemaju neke infere i slicno, jer i typescript nekada moze biti bottle
 * neck"*. So the cost is measured first, on the shape that would ship, rather than after.
 *
 * `PLAN.md` already records two numbers that bound the design, and this checks the third:
 *
 *     a generated token scale, arity or unit rule, as TYPES   flat at 30
 *     deriving a map with `Omit<Base, …>`                     2,531 against 30
 *     a MESSAGE inside a type                                 59 -> 2,447
 *
 * What is unmeasured is a TEMPLATE LITERAL union across many properties at once, which is what
 * `CssDimension<CssLengthUnit>` is — 49 units times `${number}`, on a hundred properties, in a block
 * that sets a dozen of them. A template literal type is not free the way a keyword union is, and
 * "flat at 30" was measured on keywords.
 *
 * Three shapes, each checked with the same block written the same way:
 *
 *   1. `CssValue` — what ships today, the baseline.
 *   2. `CssDimension<CssLengthUnit>` — the real candidate.
 *   3. a written-out keyword union of the same size — the control, so the template literal's own
 *      cost is separated from the union's.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "css-strict-"));

/**
 * The REPOSITORY's tsc, resolved rather than assumed.
 *
 * `npx tsc` from a temp directory finds nothing and prints "This is not the tsc command you are
 * looking for" — and a probe that measured some other TypeScript would be measuring the wrong thing
 * even if it ran.
 */
const TSC = createRequire(import.meta.url).resolve("typescript/bin/tsc");

/** The 49 length units, as the generated file has them. */
const UNITS = [
  "cap",
  "ch",
  "cm",
  "cqb",
  "cqh",
  "cqi",
  "cqmax",
  "cqmin",
  "cqw",
  "dvb",
  "dvh",
  "dvi",
  "dvmax",
  "dvmin",
  "dvw",
  "em",
  "ex",
  "ic",
  "in",
  "lh",
  "lvb",
  "lvh",
  "lvi",
  "lvmax",
  "lvmin",
  "lvw",
  "mm",
  "pc",
  "pt",
  "px",
  "q",
  "rcap",
  "rch",
  "rem",
  "rex",
  "ric",
  "rlh",
  "svb",
  "svh",
  "svi",
  "svmax",
  "svmin",
  "svw",
  "vb",
  "vh",
  "vi",
  "vmax",
  "vmin",
  "vw",
];

/**
 * How many properties the interface declares, and how many a block then sets.
 *
 * The counts are a SERIES rather than one pair, because "flat" is a claim about scaling: a shape
 * that costs four instantiations on twelve declarations and four hundred on sixty is not flat, and
 * one reading cannot tell the two apart.
 */
const DECLARED = 100;
const USED_SERIES = [1, 12, 40, 80];

const preamble = `
type CssGlobal = "inherit" | "initial" | "unset" | "revert" | "revert-layer";
type CssValue = string | number;
type CssLengthUnit = ${UNITS.map((u) => JSON.stringify(u)).join(" | ")};
type CssDimension<Unit extends string = CssLengthUnit> = \`\${number}\${Unit}\` | 0 | "0" | \`\${string}(\${string})\`;
type Keyword<K extends string> = K | CssGlobal | \`var(\${string})\`;
`;

/** A property name that is not a real one, so nothing else in the program can be consulted. */
const name = (i) => `p${String(i).padStart(3, "0")}`;

/**
 * Each shape declares a property AND supplies a value its own type accepts.
 *
 * The value has to come with the shape: a control typed as keywords cannot be measured with `"12px"`
 * — it would be measuring an error path, which is a different amount of work from checking a value
 * that fits. The first version of this did exactly that and every row of the control failed.
 */
const shapes = {
  "1. CssValue (ships today)": {
    declare: (i) => `  "${name(i)}": CssValue;`,
    value: () => `"12px"`,
  },
  "2. CssDimension<CssLengthUnit>": {
    declare: (i) => `  "${name(i)}": CssDimension<CssLengthUnit> | CssGlobal;`,
    value: () => `"12px"`,
  },
  "3. a keyword union of 49": {
    declare: (i) => `  "${name(i)}": Keyword<${UNITS.map((u) => JSON.stringify(`k-${u}`)).join(" | ")}>;`,
    value: () => `"k-px"`,
  },
};

function measure(label, shape, USED) {
  const properties = Array.from({ length: DECLARED }, (_, i) => shape.declare(i)).join("\n");
  const used = Array.from({ length: USED }, (_, i) => `  "${name(i)}": ${shape.value(i)},`).join("\n");

  writeFileSync(
    join(dir, "probe.ts"),
    `${preamble}\ninterface CssProperties {\n${properties}\n}\n\n` +
      `declare function block(value: Partial<CssProperties>): void;\n\n` +
      `block({\n${used}\n});\nexport {};\n`,
  );
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, target: "ES2022", types: [] },
      files: ["probe.ts"],
    }),
  );

  /**
   * `tsc` exits non-zero on a type error, and the diagnostics are still on stdout — so the numbers
   * are read either way and a row that did not compile SAYS SO rather than being reported as a
   * measurement. A shape that errors is not comparable: an error path is a different amount of work.
   */
  let out;
  let clean = true;
  try {
    out = execFileSync("node", [TSC, "-p", join(dir, "tsconfig.json"), "--diagnostics"], {
      encoding: "utf8",
      cwd: dir,
    });
  } catch (error) {
    out = `${error.stdout ?? ""}`;
    clean = false;
  }
  const read = (what) => Number(new RegExp(`${what}:\\s+([\\d.]+)`).exec(out)?.[1] ?? 0);
  return { label, clean, instantiations: read("Instantiations"), types: read("Types") };
}

console.log(`  ${DECLARED} properties declared; instantiations as a block sets more of them\n`);

const labels = Object.keys(shapes);
const pad = Math.max(...labels.map((l) => l.length));
console.log(`  ${"".padEnd(pad)}  ${USED_SERIES.map((n) => String(n).padStart(8)).join("")}`);

const first = {};
for (const [label, shape] of Object.entries(shapes)) {
  const cells = USED_SERIES.map((n) => {
    const r = measure(label, shape, n);
    if (!r.clean) return "  ERROR ";
    first[label] ??= r.instantiations;
    return String(r.instantiations).padStart(8);
  });
  console.log(`  ${label.padEnd(pad)}  ${cells.join("")}`);
}

console.log(
  `\n  At every width, the strict shape is within ` +
    `${Math.abs(first[labels[1]] - first[labels[0]])} instantiations of the loose one.`,
);

rmSync(dir, { recursive: true, force: true });
