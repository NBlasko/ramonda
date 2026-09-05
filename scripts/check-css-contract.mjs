import { join } from "node:path";
import ts from "typescript";

/**
 * One shape, two packages: what a compiled style block IS.
 *
 * ## The fault it exists for
 *
 * `@ramonda/css` compiles a `css=@@( … )` block into a value, and `@ramonda/core` applies that value
 * to an element. Neither package may name the other's type:
 *
 * - **`@ramonda/css` may not import the framework**, at any depth, not even as a peer — the whole
 *   point is that a wrapper can put a `css` prop on another JSX library and drag nothing in behind
 *   it;
 * - **`@ramonda/core` may not depend on `@ramonda/css`** either, which today is also unpublished.
 *
 * So the shape is declared twice, on purpose, and twice is a place to drift. A field renamed on one
 * side, or a value type widened on the other, compiles cleanly in both packages and fails only in an
 * application — where the symptom is a style that silently does not apply.
 *
 * This is the same arrangement core and `@ramonda/check` have for the single-use decorators, and it
 * reads the source with the TypeScript AST for the same reason: neither declaration is a published
 * export, and neither should become one to satisfy a check.
 *
 * ## What it compares
 *
 * Field name -> field type, both ways, between `StyleValue` in the compiler and `CssBlockValue` in
 * the framework. Names and types both, because a field that quietly changed from `string` to
 * `string | number` is exactly as wrong as one that disappeared.
 */

const root = join(import.meta.dirname, "..");

const SIDES = [
  { label: "@ramonda/css", file: join(root, "packages/css/src/types.ts"), name: "StyleValue" },
  { label: "@ramonda/core", file: join(root, "packages/core/src/types/cssBlock.ts"), name: "CssBlockValue" },
];

/**
 * The interface's fields as `name -> type`, read off the AST.
 *
 * `getText()` on the type node, so the comparison is the written type rather than a resolved one.
 * Two declarations in two packages with no shared import cannot be resolved against each other
 * anyway, and the written form is what a person maintaining either file is looking at.
 *
 * With one exception, and the first run needed it: a **local type alias is inlined**. `@ramonda/css`
 * writes `readonly StyleVarValue[]` and the framework writes `readonly (string | number)[]`, which
 * are the same type spelled two ways — and a check that called those a disagreement would be asking
 * both packages to name the alias identically, which is coupling by another route. Names declared in
 * the same file are substituted; a name from anywhere else is left alone and compared as written,
 * because that is a difference somebody chose.
 */
function fieldsOf(file, interfaceName) {
  const source = ts.createSourceFile(file, ts.sys.readFile(file) ?? "", ts.ScriptTarget.Latest, true);
  const found = source.statements.find((node) => ts.isInterfaceDeclaration(node) && node.name.text === interfaceName);

  if (found === undefined) return undefined;

  /** Every `type X = …` in this file, so `X` can be replaced by what it stands for. */
  const aliases = new Map();
  for (const node of source.statements) {
    if (ts.isTypeAliasDeclaration(node)) aliases.set(node.name.text, node.type.getText().replace(/\s+/g, " ").trim());
  }

  const fields = {};
  for (const member of found.members) {
    if (!ts.isPropertySignature(member) || member.type === undefined) continue;
    // Whitespace collapsed: a field broken across lines by the formatter is the same field.
    fields[member.name.getText()] = inline(member.type.getText().replace(/\s+/g, " ").trim(), aliases);
  }
  return fields;
}

/**
 * One alias substitution pass, repeated until nothing changes.
 *
 * Parenthesised, because an alias for a union inside `readonly X[]` means `readonly (a | b)[]` and
 * pasting the union bare would mean something else entirely. The bound stops an alias that refers to
 * itself from spinning here rather than in somebody's build.
 */
function inline(type, aliases) {
  let out = type;
  for (let round = 0; round < 5; round++) {
    let next = out;
    for (const [name, value] of aliases) {
      next = next.replace(new RegExp(`\\b${name}\\b`, "g"), `(${value})`);
    }
    if (next === out) return out;
    out = next;
  }
  return out;
}

const read = SIDES.map((side) => ({ ...side, fields: fieldsOf(side.file, side.name) }));

const missing = read.filter((side) => side.fields === undefined || Object.keys(side.fields).length === 0);
if (missing.length > 0) {
  for (const side of missing) {
    console.error(`[css-contract] could not read \`${side.name}\` from ${side.file} — it declares no fields.`);
  }
  console.error(
    `\n  Either the interface was renamed or it stopped being an interface, and this check would\n` +
      `  otherwise pass against nothing. Point SIDES in scripts/check-css-contract.mjs at it.\n`,
  );
  process.exit(1);
}

const [compiler, framework] = read;
const faults = [];

for (const name of new Set([...Object.keys(compiler.fields), ...Object.keys(framework.fields)])) {
  const a = compiler.fields[name];
  const b = framework.fields[name];

  if (a === undefined) faults.push(`\`${name}\` is declared by ${framework.label} and not by ${compiler.label}`);
  else if (b === undefined) faults.push(`\`${name}\` is declared by ${compiler.label} and not by ${framework.label}`);
  else if (a !== b) faults.push(`\`${name}\` is \`${a}\` in ${compiler.label} and \`${b}\` in ${framework.label}`);
}

if (faults.length > 0) {
  console.error(`\n[css-contract] the two declarations of a compiled block disagree:\n`);
  for (const fault of faults) console.error(`  - ${fault}`);
  console.error(
    `\n  ${compiler.label} compiles the value and ${framework.label} applies it, and neither may import\n` +
      `  the other — so the shape is written down twice and both copies have to say the same thing.\n` +
      `  The contract is packages/css/CONTRACT.md.\n`,
  );
  process.exit(1);
}

const count = Object.keys(compiler.fields).length;
console.log(`[css-contract] ${compiler.name} and ${framework.name} agree on all ${count} fields of a compiled block`);
