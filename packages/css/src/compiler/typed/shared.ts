/**
 * What the typed rules share: how a block's TYPE is told apart from a look-alike (its brand), the
 * allow-list a block type carries, and the helper names the virtual file gives a block.
 *
 * A typed rule — see `index.ts` for what separates these from the rules in `rules/`.
 */
import ts from "typescript";

/** The names the virtual file gives its helpers, which is how a block is recognised in the AST. */
export interface Helpers {
  readonly block: string;
  readonly from: string;
  readonly hole: string;
  readonly cond?: string;
  readonly vars?: string;
}

/**
 * The brand a compiled block carries, as TypeScript spells a `unique symbol` member.
 *
 * `properties.ts` declares `[COMPILED]: true` on `CssBlock`, and a member keyed by a unique symbol
 * is escaped to `__@<name>@<id>`. That is the block's IDENTITY, and asking for it is the only way
 * to tell one from a look-alike: asked by NAME, a project declaring its own `type CssBlock = {
 * className: string }` is reported by these rules — and the extension opens this plugin on every
 * project an editor has.
 *
 * Keying on the brand is also what makes an import alias and a generated module work: neither
 * changes the members, and `css-system/index.ts` re-exports the very same interface.
 */
export const BRAND = "__@COMPILED@";

/** Where the allow-list is written down — see {@link allowedBy}. */
const ALLOWS = "__@ALLOWS@";

/** Is this the compiled-block type? */
export function isBlock(checker: ts.TypeChecker, type: ts.Type): boolean {
  void checker;
  return branded(type) !== undefined;
}

/** The branded constituent of a type, which a union may hold beside `undefined`. */
export function branded(type: ts.Type): ts.Type | undefined {
  for (const one of type.isUnion() ? type.types : [type]) {
    if (one.getProperties().some((each) => (each.escapedName as string).startsWith(BRAND))) return one;
  }
  return undefined;
}

/**
 * The allow-list a block type carries, or nothing when it carries the default.
 *
 * **Told apart by INDEX SIGNATURES rather than by a name or a count.** `CssBlockShape` has three —
 * one each for a nested rule, an at-rule and a dashed name — and a narrowed list is a plain object
 * type with none. Measured: 828 properties and 3 index infos against 1 and 0. A project's own
 * generated shape reads as the default too, which a name comparison would get wrong the day
 * somebody renamed theirs.
 */
export function allowedBy(checker: ts.TypeChecker, type: ts.Type): readonly string[] | undefined {
  const block = branded(type);
  if (block === undefined) return undefined;

  /**
   * Read off the `[ALLOWS]` MEMBER rather than off a type argument.
   *
   * `CssBlock` is `string & { [ALLOWS]: A }`, which is a type alias of an intersection and not a
   * type REFERENCE — so `getTypeArguments` answers with nothing, and a slot that narrowed anything
   * would silently stop being read. The member is where the list is written down and is what the
   * phantom is for; asking it directly works whichever shape the type is declared in.
   */
  const carries = block.getProperties().find((each) => (each.escapedName as string).startsWith(ALLOWS));
  if (carries === undefined) return undefined;

  const argument = checker.getTypeOfSymbol(carries);
  if (checker.getIndexInfosOfType(argument).length > 0) return undefined;
  return argument.getProperties().map((each) => each.getName());
}

/** Is this call one of the virtual file's helpers? */
export function calls(node: ts.Node, name: string): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
}
