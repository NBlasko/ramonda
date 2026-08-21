import { join } from "node:path";
import ts from "typescript";

/**
 * One fact, two packages: what a SECOND application of a single-use decorator does.
 *
 * ## The fault it exists for
 *
 * `@ramonda/check` tells a developer what writing `@StableProps` twice will do — "they MERGE, both
 * take effect, nothing is lost" — and that sentence lives in the analyzer. What actually happens lives
 * in core. **The analyzer does not import core** (deliberately: it reads source with TypeScript and
 * never loads the framework), so the two could disagree and nothing would notice. Change core so a
 * second `@StableProps` throws and the analyzer would keep advising people that it merges.
 *
 * The quiet direction is worse than the loud one: a NEW single-use decorator in core that the rule
 * never learns about is not a wrong report, it is silence — the rule simply does not mention it, and
 * silence is what an analyzer is trusted for.
 *
 * ## Why it reads the source instead of importing it
 *
 * Neither table is a published export, and neither should become one to satisfy a check.
 * `apps/docs/scripts/check-api-coverage.mjs` already reads core's `SPECS` from source for the same
 * reason. This uses the TypeScript AST rather than regexes, so a reformat cannot make it pass or fail
 * by accident.
 *
 * ## What it compares
 *
 * `decorator → effect`, both ways, built from:
 * - core's `SPECS`, where a code about a doubled decorator carries `duplicate: { decorators, effect }`
 * - the analyzer's `EFFECT` table in `rules/duplicate-decorators.ts`
 *
 * And the codes: every spec carrying a `duplicate` field must be claimed by the rule's
 * `alsoReportedAs`, so a new duplication code cannot be minted without the rule that answers it.
 */

const root = join(import.meta.dirname, "..");
const CORE = join(root, "packages/core/src/debug/diagnostics.ts");
const RULE = join(root, "packages/check/src/rules/duplicate-decorators.ts");

const parse = (file) =>
  ts.createSourceFile(file, ts.sys.readFile(file) ?? "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** A string literal's text, or undefined for anything else — a computed value is not a fact to compare. */
const literal = (node) => (node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined);

const propertyNamed = (object, name) =>
  object.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === name);

/** core: every `RMDxxx: { duplicate: { decorators: [...], effect: "..." } }`. */
function fromCore() {
  const effects = new Map();
  const codes = new Set();
  const source = parse(CORE);

  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      /^RM[A-Z]\d{3}$/.test(node.name.getText()) &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const duplicate = propertyNamed(node.initializer, "duplicate");
      if (duplicate && ts.isObjectLiteralExpression(duplicate.initializer)) {
        const decorators = propertyNamed(duplicate.initializer, "decorators");
        const effect = literal(propertyNamed(duplicate.initializer, "effect")?.initializer);
        if (!decorators || !ts.isArrayLiteralExpression(decorators.initializer) || effect === undefined) {
          throw new Error(`${node.name.getText()}: \`duplicate\` must be { decorators: ["..."], effect: "..." }`);
        }
        codes.add(node.name.getText());
        for (const element of decorators.initializer.elements) {
          const name = literal(element);
          if (name === undefined) throw new Error(`${node.name.getText()}: every decorator must be a string literal`);
          effects.set(name, effect);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { effects, codes };
}

/** the analyzer: the `EFFECT` table, and the codes the rule says it answers. */
function fromRule() {
  const effects = new Map();
  const codes = new Set();
  const source = parse(RULE);

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === "EFFECT" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const effect = literal(property.initializer);
        if (effect === undefined) throw new Error(`EFFECT.${property.name.getText()} is not a string literal`);
        effects.set(property.name.getText(), effect);
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText() === "alsoReportedAs" &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const element of node.initializer.elements) {
        const code = literal(element);
        if (code !== undefined) codes.add(code);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { effects, codes };
}

const core = fromCore();
const rule = fromRule();

if (core.effects.size === 0 || rule.effects.size === 0) {
  console.error(
    `[decorators] read ${core.effects.size} decorator(s) from core and ${rule.effects.size} from the rule — ` +
      "one of the two tables was not found, so this check proved nothing.",
  );
  process.exit(1);
}

const faults = [];

for (const [name, effect] of core.effects) {
  const said = rule.effects.get(name);
  if (said === undefined) faults.push(`@${name} — core says "${effect}", the rule does not mention it at all`);
  else if (said !== effect) faults.push(`@${name} — core says "${effect}", the rule says "${said}"`);
}

for (const [name, said] of rule.effects) {
  if (!core.effects.has(name)) faults.push(`@${name} — the rule says "${said}", core does not describe it`);
}

for (const code of core.codes) {
  if (!rule.codes.has(code)) faults.push(`${code} is about a doubled decorator and no rule claims it`);
}

if (faults.length > 0) {
  console.error(`\n[decorators] core and @ramonda/check disagree about ${faults.length} thing(s):\n`);
  for (const fault of faults) console.error(`  ${fault}`);
  console.error(
    "\nThe runtime is the authority. Core's `duplicate` field on the diagnostic and the `EFFECT` table\n" +
      "in `rules/duplicate-decorators.ts` have to say the same thing, or the analyzer gives advice about\n" +
      "behaviour this framework does not have.\n",
  );
  process.exit(1);
}

console.log(
  `[decorators] core and @ramonda/check agree on all ${core.effects.size} single-use decorators, across ${core.codes.size} codes`,
);
