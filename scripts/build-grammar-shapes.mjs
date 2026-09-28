/**
 * A shorthand's own GRAMMAR, opened until every leaf belongs to a longhand, and measured.
 *
 *     node scripts/build-grammar-shapes.mjs
 *     node scripts/build-grammar-shapes.mjs --check
 *
 * ## Why this replaces the slot table
 *
 * `build-token-shapes.mjs` writes a flat list of slots and `splitTokens` fills them. That answers
 * every family whose value is a bag of tokens and cannot answer three things, each measured:
 *
 * - **where two slots take a token.** The passes hand it to the closed one; CSS hands it to
 *   whichever part the grammar reaches first. `animation: --zz` is a name in all three engines and
 *   a timeline to the passes.
 * - **a separator.** A slot list has nowhere to put one, so `<bg-position> [ / <bg-size> ]?` cannot
 *   be described at all and every family carrying a slash stays whole.
 * - **an order inside the value.** `transition`'s two `<time>`s are the same component written
 *   twice, and which is the duration is not in the grammar.
 *
 * A parse answers the first two by construction. The third is answered here, by measurement.
 *
 * ## How an ambiguous leaf is settled
 *
 * Where several leaves claim the SAME set of longhands, each is given a distinct sample, the whole
 * value is written to a real element, and each longhand's computed value is matched back to the
 * sample that produced it. `transition: 4s 9s` reads back `duration: 4s, delay: 9s`, so the first
 * `<time>` is the duration. No prose, no table of special cases; a family this cannot settle is
 * refused and keeps its shorthand.
 *
 * A single leaf claiming several longhands is NOT this. `border`'s `<line-width>` claims all four
 * sides and feeds all four — that is a broadcast, and `1px` really does set every side.
 *
 * ## Verification is inside this generator
 *
 * Every family is reproduced before it is written: each value goes on one element as the shorthand
 * and on another as our longhands, and the WHOLE computed style is compared. A family that fails
 * one value is rejected, and so is one this engine HAS but compared nothing for — a row nothing
 * checked is the fault `list-corpus-never-ran` names.
 *
 * The corpus shuffles the written order only where the item grammar is `||` or `&&`. A family whose
 * item is a juxtaposition has an order, and a shuffled value is not a value; the engine refuses it
 * and a refusal is skipped, which is how a corpus stops testing without saying so.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeOrCheck } from "./engine-facts.mjs";
import { loadTs } from "./lib-load-ts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes("--check");

const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const mdn = createRequire(join(HERE, "build-css-properties.mjs"))("mdn-data");
const COMPILER = join(HERE, "..", "packages", "css", "src", "compiler");
const { parseValueSyntax } = await loadTs(join(COMPILER, "valueSyntax.ts"));
const { acceptedBy, isOpen, resolving } = await loadTs(join(COMPILER, "classify.ts"));
const { openedFor } = await loadTs(join(COMPILER, "openGrammar.ts"));
const { splitByGrammar } = await loadTs(join(COMPILER, "split.ts"));
const { LEAVES } = await loadTs(join(COMPILER, "leaves.generated.ts"));
const { INITIAL_VALUES } = await loadTs(join(COMPILER, "initials.generated.ts"));
const { SHAPES } = await loadTs(join(COMPILER, "shapes.generated.ts"));

/** A type the splitter tests DIRECTLY is not opened into its words — `<color>` alone is 192 of them. */
const DIRECT = new Set(["color"]);
const grammarOf = (name) =>
  DIRECT.has(name) ? "" : (mdn.css.syntaxes[name]?.syntax ?? mdn.css.properties[name]?.syntax ?? "");
const syntaxOf = resolving((property) => mdn.css.properties[property]?.syntax ?? "");

/** One ITEM of a comma-separated family, or nothing if it is not one. */
function itemOf(grammar) {
  const found = /^(.*)#\??$/s.exec(grammar.trim());
  if (found === null) return undefined;
  const inside = (found[1] ?? "").trim();
  return /^\[.*\]$/s.test(inside) ? inside.slice(1, -1).trim() : inside;
}

/** Several samples per type, so one that equals a longhand's own initial can be passed over. */
const SAMPLES = {
  length: ["7px", "13px", "29px"],
  time: ["4s", "9s", "17s"],
  percentage: ["30%", "70%"],
  angle: ["45deg", "90deg"],
  number: ["3", "5"],
  integer: ["2", "6"],
  "custom-ident": ["zzz", "yyy"],
  "dashed-ident": ["--zz", "--yy"],
  url: ["url(a.png)", "url(b.png)"],
  "hex-color": ["#abcdef", "#fedcba"],
  color: ["rebeccapurple", "goldenrod"],
  string: ['"zz"', '"yy"'],
  flex: ["3fr", "5fr"],
};

const LEAF_KINDS = new Set(["keyword", "data", "property", "function"]);
function leavesOf(term, out = []) {
  if (term.kind === "literal") return out;
  if (LEAF_KINDS.has(term.kind)) {
    out.push(term);
    return out;
  }
  for (const one of term.terms ?? []) leavesOf(one, out);
  return out;
}

/** Whether the ITEM may be written in any order. The item may BE a named type, so it is followed. */
function reorders(name) {
  const syntax = mdn.css.properties[name]?.syntax ?? "";
  if (syntax === "") return false;
  try {
    let term = parseValueSyntax(itemOf(syntax) ?? syntax);
    for (let depth = 0; term.kind === "data" && term.name !== undefined && depth < 3; depth++) {
      const inner = grammarOf(term.name);
      if (inner === "") break;
      term = parseValueSyntax(inner);
    }
    return term.kind === "or" || term.kind === "and";
  } catch {
    return false;
  }
}

/** The opened grammar of a family, with a description per leaf, or nothing. */
function openedShape(name) {
  const syntax = mdn.css.properties[name]?.syntax ?? "";
  const longhands = LEAVES[name];
  if (syntax === "" || longhands === undefined) return undefined;
  const item = itemOf(syntax);
  let opened;
  try {
    opened = openedFor(parseValueSyntax(item ?? syntax), longhands, grammarOf, syntaxOf);
  } catch {
    return undefined;
  }
  if (opened === undefined) return undefined;
  const leaves = opened.leaves.map((one) => {
    const takes = acceptedBy(one.term, grammarOf);
    return { longhands: one.longhands, ...takes, open: isOpen(takes) };
  });
  return { tree: opened.tree, terms: leavesOf(opened.tree), leaves, list: item !== undefined, longhands };
}

/** Samples this leaf takes, preferring ones no longhand of its own group starts out at. */
function samplesFor(leaf) {
  const out = [...leaf.words];
  for (const type of leaf.types) for (const one of SAMPLES[type] ?? []) out.push(one);
  for (const call of leaf.functions) out.push(`${call}(1)`);
  const initial = new Set(leaf.longhands.map((one) => INITIAL_VALUES[one]));
  return [...out.filter((one) => !initial.has(one)), ...out.filter((one) => initial.has(one))];
}

/**
 * Settle every leaf that claims the same longhands as another, by asking the engine.
 *
 * Returns a longhand per ambiguous leaf, or nothing where the engine's answer is not one-to-one —
 * which refuses the family rather than guessing at an order.
 */
async function settle(tab, name, shape) {
  const groups = new Map();
  shape.leaves.forEach((leaf, index) => {
    if (leaf.longhands.length < 2) return;
    const key = [...leaf.longhands].sort().join("|");
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });

  const settled = {};
  for (const [key, where] of groups) {
    if (where.length < 2) continue; // One leaf claiming several longhands FEEDS all of them.
    const longhands = key.split("|");
    const used = new Set();
    const chosen = where.map((index) => {
      const one = samplesFor(shape.leaves[index]).find((sample) => !used.has(sample));
      if (one !== undefined) used.add(one);
      return one;
    });
    if (chosen.some((one) => one === undefined)) return undefined;

    const held = await tab.evaluate(
      ([property, value, wanted]) => {
        const element = document.getElementById("x");
        element.style.cssText = "";
        element.style.setProperty(property, value);
        if (element.style.length === 0) return null;
        const computed = getComputedStyle(element);
        return Object.fromEntries(wanted.map((one) => [one, computed.getPropertyValue(one)]));
      },
      [name, chosen.join(" "), longhands],
    );
    if (held === null) return undefined;

    for (const [at, index] of where.entries()) {
      const found = longhands.filter((one) => held[one] === chosen[at]);
      if (found.length !== 1) return undefined;
      settled[index] = found[0];
    }
    if (new Set(Object.values(settled)).size !== Object.values(settled).length) return undefined;
  }
  return settled;
}

/** Each leaf alone, then all of them, then — for a list — two items, and shuffles where allowed. */
function corpusFor(shape, shuffle) {
  const per = shape.leaves.map((leaf) => samplesFor(leaf)[0]).filter((one) => one !== undefined);
  if (per.length === 0) return [];
  const out = [...per, per.join(" ")];
  if (shuffle && per.length > 1) out.push([...per].reverse().join(" "));
  if (shape.list) out.push(`${per[0]}, ${per.join(" ")}`);
  return [...new Set(out)];
}

const ENGINES = ["chromium", "firefox", "webkit"];
const candidates = Object.keys(LEAVES)
  .filter((one) => !one.startsWith("-") && one !== "all")
  .filter((one) => (LEAVES[one]?.length ?? 0) > 1 && SHAPES[one] === undefined)
  .sort();

const perEngine = {};
for (const engine of ENGINES) {
  let browser;
  try {
    browser = await pw[engine].launch();
    const tab = await browser.newPage();
    await tab.setContent("<!doctype html><html><body><div id=x></div><div id=y></div></body></html>");

    const shapes = {};
    const rejected = [];
    const blind = [];
    for (const name of candidates) {
      const shape = openedShape(name);
      if (shape === undefined) continue;

      const has = await tab.evaluate((longhands) => {
        const element = document.getElementById("x");
        element.style.cssText = "";
        const computed = getComputedStyle(element);
        return longhands.some((one) => computed.getPropertyValue(one) !== "");
      }, shape.longhands);
      if (!has) continue; // This engine does not have the family, so it says nothing about it.

      const settled = await settle(tab, name, shape);
      if (settled === undefined) {
        rejected.push(name);
        continue;
      }
      const leaves = shape.leaves.map((leaf, index) =>
        settled[index] === undefined ? leaf : { ...leaf, longhands: [settled[index]] },
      );
      const written = { longhands: shape.longhands, tree: shape.tree, leaves, ...(shape.list ? { list: true } : {}) };

      let compared = 0;
      let wrong = 0;
      for (const value of corpusFor({ ...shape, leaves }, reorders(name))) {
        const split = splitByGrammar(written, value);
        if (split === undefined) continue;
        const differ = await tab.evaluate(
          ([property, one, mapped]) => {
            const x = document.getElementById("x");
            const y = document.getElementById("y");
            x.style.cssText = "";
            y.style.cssText = "";
            x.style.setProperty(property, one);
            if (x.style.length === 0) return null;
            for (const [longhand, held] of Object.entries(mapped)) y.style.setProperty(longhand, held);
            const wrote = getComputedStyle(x);
            const ours = getComputedStyle(y);
            for (let index = 0; index < wrote.length; index++) {
              const held = wrote[index];
              if (wrote.getPropertyValue(held) !== ours.getPropertyValue(held)) return held;
            }
            return "";
          },
          [name, value, split],
        );
        if (differ === null) continue; // The engine will not take the value; nothing to compare.
        compared++;
        if (differ !== "") wrong++;
      }

      if (wrong > 0) {
        rejected.push(name);
        continue;
      }
      if (compared === 0) {
        blind.push(name);
        continue;
      }
      shapes[name] = written;
    }

    if (blind.length > 0) console.error(`[grammar] ${engine} compared NOTHING for: ${blind.join(", ")}`);
    if (process.env.WHY) console.error(`[why] ${engine} rejected: ${rejected.join(" ")}`);
    perEngine[engine] = { shapes, rejected: new Set(rejected) };
    console.log(
      `[grammar] ${engine.padEnd(10)} ${Object.keys(shapes).length} families, ` +
        `${rejected.length} rejected, ${blind.length} unmeasured`,
    );
  } catch (error) {
    console.error(`[grammar] ${engine} would not launch: ${String(error).slice(0, 90)}`);
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
}

const engines = Object.keys(perEngine);
if (engines.length === 0) {
  console.error("[grammar] no engine ran, so nothing was measured");
  process.exit(1);
}

/** An unbounded repeat is written as `Infinity`, which TypeScript takes and JSON does not. */
const printed = (value) =>
  value === undefined
    ? ""
    : JSON.stringify(value, (_, one) => (one === Number.POSITIVE_INFINITY ? "@INF@" : one)).replaceAll(
        '"@INF@"',
        "Infinity",
      );

/**
 * The INTERSECTION over the engines that HAVE the family, for the reason the other two tables give:
 * a mapping that is WRONG writes the author's value into the wrong longhand, silently. A
 * disagreement leaves the shorthand whole — the answer that cannot be wrong.
 *
 * **An engine without the family says nothing rather than voting against it.** Firefox has neither
 * timeline family; counting its silence as a disagreement dropped three families that the engines
 * having them agreed about completely. An engine that HAS the family and rejects it is a different
 * answer and does veto — Firefox does that to `animation`.
 */
const agreed = {};
for (const name of [...new Set(engines.flatMap((one) => Object.keys(perEngine[one].shapes)))].sort()) {
  // An engine that HAS the family and turned it down votes against it; one without it abstains.
  if (engines.some((one) => perEngine[one].rejected.has(name))) continue;
  const said = engines.map((one) => perEngine[one].shapes[name]).filter((one) => one !== undefined);
  const mine = printed(said[0]);
  if (said.every((one) => printed(one) === mine)) agreed[name] = said[0];
}

const rows = Object.keys(agreed)
  .sort()
  .map((name) => `  ${JSON.stringify(name)}: ${printed(agreed[name])},`)
  .join("\n");

const file = join(COMPILER, "grammarShapes.generated.ts");
const contents =
  `// Generated by scripts/build-grammar-shapes.mjs. The GRAMMAR is read from mdn-data; every\n` +
  `// placement in it is MEASURED in Chromium, Firefox and WebKit — each browser is launched, the\n` +
  `// shorthand and our longhands are written to two elements, and the whole computed style is\n` +
  `// compared. No engine source is used. See THIRD-PARTY.md. Do not edit.\n` +
  `//\n` +
  `// ${Object.keys(agreed).length} families, written only where every engine that has one agreed.\n` +
  `\n` +
  `import type { Term } from "./valueSyntax";\n` +
  `\n` +
  `/** One leaf of an opened grammar: what it takes, and where a token it takes goes. */\n` +
  `export interface GrammarLeaf {\n` +
  `  readonly longhands: readonly string[];\n` +
  `  /** Keywords it takes, exactly. */\n` +
  `  readonly words: readonly string[];\n` +
  `  /** Primitive types it takes — \`length\`, \`color\`, \`custom-ident\`. */\n` +
  `  readonly types: readonly string[];\n` +
  `  /** Functions it takes, by name. */\n` +
  `  readonly functions: readonly string[];\n` +
  `  /** It takes a free identifier, so it stands down for any leaf that NAMES the token. */\n` +
  `  readonly open: boolean;\n` +
  `}\n` +
  `\n` +
  `/** One family: the grammar a value is read against, and a leaf description per leaf of it. */\n` +
  `export interface GrammarShape {\n` +
  `  readonly longhands: readonly string[];\n` +
  `  /** The opened grammar of ONE value, or of one ITEM where {@link GrammarShape.list} is set. */\n` +
  `  readonly tree: Term;\n` +
  `  /** One per leaf of \`tree\`, in the order a pre-order walk reaches them. */\n` +
  `  readonly leaves: readonly GrammarLeaf[];\n` +
  `  /** A COMMA-separated family: every item takes this shape, and each longhand is a list. */\n` +
  `  readonly list?: boolean;\n` +
  `}\n` +
  `\n` +
  `export const GRAMMAR_SHAPES: Readonly<Record<string, GrammarShape>> = {\n${rows}\n};\n`;

const wrote = writeOrCheck(file, contents, "build-grammar-shapes", check);
if (!check) console.log(`[grammar] ${wrote ? "wrote" : "up to date —"} ${Object.keys(agreed).length} families`);
