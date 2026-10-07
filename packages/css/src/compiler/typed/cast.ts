/**
 * `cast-to-a-block`: a value cast to a style block, the one way past the type a block prop is.
 *
 * A typed rule — see `index.ts` for what separates these from the rules in `rules/`.
 */
import { type TypedFinding } from "./index";
import { isBlock } from "./shared";
import ts from "typescript";

/**
 * A value CAST to a block — the one way past the type a block prop is.
 *
 * A block prop takes only what `@@( … )` compiles to: a plain object, a plain string and a block of
 * a wider allow-list are all type errors. A cast silences that and nothing else. Measured through
 * the merge, an object cast to a block throws `part.split is not a function` from inside the
 * render, a style string becomes the classes `color:` and `red;`, and a class or a block the
 * allow-list refuses lands without a word.
 *
 * Told by the BRAND of the type cast to, so an alias, a re-export and a type alias are all the
 * same, and a project's own type named `CssBlock` is not. A block cast where it is written is left
 * to the compiler: the cast is that block's context, so a declaration the allow-list refuses is
 * already a type error on the declaration itself.
 *
 * What it cannot see: `as any`, which carries no type to ask about, and a generic helper that casts
 * to its own type parameter.
 */
export function castToABlock(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  blockHelper: string | undefined,
  report: (node: ts.Node, what: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  const writtenHere = (node: ts.Expression): boolean => {
    let inner = node;
    while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
    return (
      blockHelper !== undefined &&
      blockHelper !== "" &&
      ts.isCallExpression(inner) &&
      ts.isIdentifier(inner.expression) &&
      inner.expression.text === blockHelper
    );
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      !ts.isConstTypeReference(node.type) &&
      isBlock(checker, checker.getTypeFromTypeNode(node.type)) &&
      !writtenHere(node.expression)
    ) {
      report(node, {
        rule: "cast-to-a-block",
        message:
          `a cast to a style block makes the type say this is a block, and only \`@@( … )\` makes ` +
          `one — so nothing checked what it holds, and the merge gets whatever it is. Write the ` +
          `value as a block; if a block the prop refuses is meant to be allowed, widen the prop's ` +
          `allow-list instead.`,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}
