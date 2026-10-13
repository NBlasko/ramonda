/**
 * `blocks-joined-not-merged`: two blocks joined into one string, where a merge was meant.
 *
 * A typed rule — see `index.ts` for what separates these from the rules in `rules/`.
 */
import { type TypedFinding } from "./index";
import { branded } from "./shared";
import ts from "typescript";

/**
 * TWO BLOCKS JOINED INTO ONE STRING, where `mergeClassNames` was what the author meant.
 *
 * ## What is wrong with it
 *
 * A block is a string, so joining two of them produces a string — and a browser takes it. What it
 * does NOT do is merge: every class from both lands, and the STYLESHEET breaks the tie. Measured:
 *
 *     base = padding-left: 40px    card = padding: 8px
 *     mergeClassNames  panel r-cur-pointer r-disp-flex r-p-8px
 *     join             panel r-pl-40px r-cur-pointer r-disp-flex r-p-8px
 *
 * `r-pl-40px` should have been cleared by the `padding` written after it, which is what CSS's own
 * cascade does and what a merge is for. The page renders, with one declaration too many, and
 * nothing says so.
 *
 * ## Why the type cannot catch it
 *
 * The brand refuses a joined string where a BLOCK is wanted — `` `${a} ${b}` `` cannot be spread
 * into another block, asserted six ways. But `className` takes a plain `string`, and a block is a
 * string, so the one place it matters is the one place the type cannot speak.
 *
 * ## What it does NOT report
 *
 * One block and anything else. `` `lead ${card}` `` is the ordinary way to put a class of your own
 * beside a block, and it is CORRECT: a foreign class keys on itself, so merging it changes nothing
 * — measured, the two give the same string byte for byte. Reporting it would be a false report on
 * the shape the documentation teaches.
 */
export function joinedNotMerged(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  report: (node: ts.Node, what: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  const isBlock = (node: ts.Node): boolean => branded(checker.getTypeAtLocation(node)) !== undefined;

  /**
   * Whether these are two DIFFERENT blocks, which is what the message claims and what makes it wrong
   * to join them.
   *
   * `` `${card} ${card}` `` is one block written twice: the classes duplicate, a duplicate class in a
   * class attribute does nothing, and no declaration overrides another. So the message — *a
   * declaration one of them meant to override survives* — would be false for it, and a message that
   * is false on the case it fires on is a false report however the rule is phrased.
   *
   * Told apart by SYMBOL, so two names for one binding are one block. An expression with no symbol —
   * a call, an index — is counted as its own, because nothing here can say two calls return the same
   * thing.
   */
  const distinct = (blocks: readonly ts.Expression[]): boolean => {
    const seen = new Set<ts.Symbol | ts.Expression>();
    for (const one of blocks) seen.add(checker.getSymbolAtLocation(one) ?? one);
    return seen.size > 1;
  };

  /**
   * A part NAMED `className`, which carries classes by convention and may carry a block.
   *
   * The type cannot tell: a block arriving as a `string` looks exactly like a foreign class name,
   * and reporting those is a false report on the shape the documentation teaches. The NAME can —
   * `className` is what classes travel under, and a component joining its caller's into a string
   * is the one place the merge never runs. Measured, that is also where the shorthand SPLIT changed
   * an answer: the caller's `padding` arrives as four longhand classes, the component's own
   * `padding-left` is a fifth, and which wins follows whichever stylesheet the bundler put first.
   */
  const carriesClasses = (node: ts.Expression): boolean => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text === "className";
    if (ts.isIdentifier(node)) return node.text === "className";
    return false;
  };

  /** Two different blocks, or one block beside something classes travel under. */
  const joined = (blocks: readonly ts.Expression[], parts: readonly ts.Expression[]): boolean =>
    blocks.length > 0 && (distinct(blocks) || parts.some(carriesClasses));

  /** Every operand of a `+` chain, flattened — `a + " " + b` is three, not two. */
  const addends = (node: ts.Expression, into: ts.Expression[]): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      addends(node.left, into);
      addends(node.right, into);
      return;
    }
    into.push(node);
  };

  const said = (node: ts.Node): void =>
    report(node, {
      rule: "blocks-joined-not-merged",
      message:
        `two style blocks joined into one string, which is not a merge — every class from both ` +
        `lands and the stylesheet breaks the tie, so a declaration one of them meant to override ` +
        `survives.\n\n        \`mergeClassNames(a, b)\` keeps one class per thing set. It gives ` +
        `the same ` +
        `string when nothing conflicts, and the right one when something does.`,
    });

  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node)) {
      const parts = node.templateSpans.map((span) => span.expression);
      if (joined(parts.filter(isBlock), parts)) said(node);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      /**
       * Only the OUTERMOST `+` of a chain, or `a + " " + b` would be reported twice — once for the
       * whole and once for the left half that is already a join.
       */
      const outer = !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken);
      if (outer) {
        const parts: ts.Expression[] = [];
        addends(node, parts);
        if (joined(parts.filter(isBlock), parts)) said(node);
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "join" &&
      ts.isArrayLiteralExpression(node.expression.expression)
    ) {
      // `[a, b].join(" ")`, which is the third way to write the same mistake.
      const parts = node.expression.expression.elements;
      if (joined(parts.filter(isBlock), parts)) said(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(file);
}
