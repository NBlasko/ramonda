/**
 * `registered-never-set`: a `@@property` every block reads and nothing sets, so every element gets
 * its initial value.
 *
 * A typed rule — see `index.ts` for what separates these from the rules in `rules/`.
 */
import { type RegisteredSite } from "../variables";
import { type TypedFinding } from "./index";
import { type VirtualFile } from "../virtual";
import ts from "typescript";

/**
 * A registered property that every block READS and nothing SETS.
 *
 * ## What the fault is
 *
 * `@@property` requires an `initial-value` for every syntax but `*`, so a name nothing sets still
 * resolves — every element gets the initial, the page renders, and nothing anywhere says the value
 * the author meant to vary never arrives. That is the same silence the style prop's two rules exist
 * for, from the other end: there the value was handed over and never consumed, here it is consumed
 * and never handed over.
 *
 * With no hole, `@@property` is how a value that changes at run time reaches CSS at all — so a
 * forgotten setter is not an unusual mistake, it is THE mistake this door makes possible.
 *
 * ## What counts as setting it, and why the bar is so low
 *
 * Two things: a block that declares the name, which the CSS half already knows, and **any reference
 * to the binding in TypeScript at all**. The second is deliberately not narrowed to `style={{
 * [angle]: v }}` or to `toStyle`: the binding is a string, so it reaches a setter through any
 * expression a person can write — an array, a helper, a prop, a re-export. Narrowing would have to
 * follow all of them, and the one it missed would be a false report on working code.
 *
 * So what is reported is the case where the name is written in exactly one place — its own
 * declaration — and read from blocks. Nothing else in the program mentions it. There is no
 * expression that could set it, so the report cannot be wrong about that.
 *
 * ## The one shape it is wrong about
 *
 * A library that EXPORTS a registered property for its consumers to set. The program is the
 * library, the consumers are not in it, and `export const accent = @@property( … )` is a reference
 * to nothing this can see. It is still reported, because within one project that same shape — a
 * theme module everything reads and nothing sets — is the fault itself, and telling the two apart
 * would mean guessing which of them the author is. The escape is the ordinary one: a
 * `ramonda-css-ignore` on the declaration, or the rule turned off in `ramonda.css.ts`.
 */
export function registeredNeverSet(
  program: ts.Program,
  overlays: ReadonlyMap<string, { virtual: VirtualFile; source: string }>,
  candidates: readonly { readonly file: string; readonly site: RegisteredSite }[],
): TypedFinding[] {
  if (candidates.length === 0) return [];

  const checker = program.getTypeChecker();

  /**
   * Each candidate's own symbol, found in the file that declares it.
   *
   * The virtual file rewrote the block into `__property({ … })`, so the DECLARATION is an ordinary
   * variable declaration with the author's own name on it — which is the one part of the site this
   * compiler did not touch, and so the one part a symbol can be asked for.
   */
  const wanted = new Map<ts.Symbol, { file: string; site: RegisteredSite }>();
  for (const candidate of candidates) {
    const file = program.getSourceFile(candidate.file);
    if (file === undefined) continue;
    const declared = declarationOf(file, candidate.site.binding);
    if (declared === undefined) continue;
    const symbol = checker.getSymbolAtLocation(declared);
    if (symbol !== undefined) wanted.set(symbol, candidate);
  }
  if (wanted.size === 0) return [];

  /**
   * One walk over the program, not one per candidate.
   *
   * Every identifier is resolved once and struck off; what is left named nothing but itself. An
   * import is followed to what it imports — `getAliasedSymbol` — because `import { accent }` and
   * the `const accent` it names are the same property and a reference through either is a set.
   */
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile || wanted.size === 0) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const found = checker.getSymbolAtLocation(node);
        const symbol =
          found !== undefined && (found.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(found) : found;
        // Its own declaration is not a reference to it — that is the site being reported.
        if (symbol !== undefined && wanted.has(symbol) && !isJustNaming(node)) wanted.delete(symbol);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  const findings: TypedFinding[] = [];
  for (const { file, site } of wanted.values()) {
    // Already an offset in the AUTHOR's file: a registered site comes from the CSS walk, which
    // reads the source as written. Nothing to map home.
    void overlays;
    findings.push({
      rule: "registered-never-set",
      file,
      at: site.at,
      length: site.length,
      message:
        `\`${site.binding}\` is read by a block and set by nothing, so every element gets its ` +
        `\`initial-value\`. Set it — \`style={{ [${site.binding}]: value }}\`, \`toStyle\`, or a ` +
        `block writing \`$(${site.binding}): <value>;\` — or write the value straight into the block if ` +
        `it never changes.`,
    });
  }
  return findings;
}

/**
 * Whether this identifier only NAMES the property, rather than using it.
 *
 * Four shapes name it and set nothing: its own `const`, the `import { angle }` that brings it in,
 * the `export { angle }` that passes it on, and a namespace import. The import one is not an edge
 * case — it is what every cross-module read looks like. A block writes `{angle}`, the compiler
 * resolves that to the generated name and writes the NAME into the CSS, so after the transform the
 * import is referenced by nothing and the bundler drops it. Counting it as a set would mean the rule
 * could never fire on a shared theme, which is the one place it is worth most.
 *
 * Measured: without this, a property declared in `theme.ts`, read by a block in `Card.tsx` and set
 * nowhere reported nothing at all.
 */
function isJustNaming(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (ts.isVariableDeclaration(parent)) return parent.name === node;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return true;
  return ts.isImportClause(parent) || ts.isNamespaceImport(parent);
}

/** The `const <name> =` this file declares at any depth, as the identifier a symbol can be had from. */
function declarationOf(file: ts.SourceFile, name: string): ts.Identifier | undefined {
  let found: ts.Identifier | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node.name;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
