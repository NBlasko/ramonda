/**
 * `narrower-after-a-whole-shorthand` across blocks: the spread is a value, and only a program can
 * follow it to the block it names.
 *
 * A typed rule — see `index.ts` for what separates these from the rules in `rules/`.
 */
import { type Helpers, calls, isBlock } from "./shared";
import { IMPORTANT, splitOf } from "../split";
import { SHORTHANDS } from "../keywords.generated";
import { type TypedFinding } from "./index";
import { covers } from "../flatten";
import ts from "typescript";

/**
 * `narrower-after-a-whole-shorthand` across blocks — a spread, or `mergeClassNames(a, b)`.
 *
 * The compiler refuses a narrower whole shorthand after a wider one inside one block. A spread is a
 * VALUE to it, so a wider one arriving through `...$(base)` was never seen, and the merge could only
 * warn in development. A program can follow the name to the block it was written as, and read what
 * that block sets the way the compiler reads its own — as the author wrote it, one declaration each.
 *
 * WHOLE is what the sheet does with it: a shorthand that does not split (`splitOf` refuses it). A
 * narrower one that splits is pieces in `p`, stronger than `v`, and is not the fault. Only the top
 * level of each block is compared: a nested rule is its own context, as in the compiler's rule, and
 * a spread may only stand at the top. A name the program cannot follow to a block — a prop, a
 * parameter — says nothing, rather than guessing.
 */
export function wholeAcrossBlocks(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  helpers: Helpers | undefined,
  report: (node: ts.Node, finding: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  /** The block a name was written as — its array of declarations — or nothing. */
  const blockOf = (expression: ts.Expression): ts.ArrayLiteralExpression | undefined => {
    let node: ts.Expression = expression;
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    if (!ts.isIdentifier(node)) return undefined;
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration;
    if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return undefined;
    const initial = declaration.initializer;
    if (initial === undefined || !ts.isCallExpression(initial) || !isBlock(checker, checker.getTypeAtLocation(initial)))
      return undefined;
    const [array] = initial.arguments;
    return array !== undefined && ts.isArrayLiteralExpression(array) ? array : undefined;
  };

  const whole = (property: string, value: string) =>
    property !== "all" && SHORTHANDS[property] !== undefined && splitOf(property, value) === undefined;

  /**
   * A whole shorthand still standing, its importance — which keeps it in its own layer — and where
   * it came from: this block's own declarations, a spread, or a `mergeClassNames` argument. Only
   * one that came from ELSEWHERE is this rule's; two in one block are the compiler's own.
   */
  interface Standing {
    readonly property: string;
    readonly important: boolean;
    readonly from: number;
  }

  /**
   * Whether an expression is a `$` path — `__vars.border.thin` — by the name the virtual file bound
   * `$` to. A spread's block is usually in another file, which binds its own, hence the pattern.
   */
  const variable = (node: ts.Expression): boolean => {
    let root: ts.Expression = node;
    while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) root = root.expression;
    return root !== node && ts.isIdentifier(root) && (root.text === helpers?.vars || /^_*__vars$/.test(root.text));
  };

  /**
   * A value as the SHEET gets it, as far as this rule asks: a `$` path is a `var()` there, alone or
   * as part of a value — `1px solid $color.a` is written as a template, and reading only string
   * literals would miss every shorthand a token keeps whole (§17). Anything else is not read.
   */
  const valueOf = (value: ts.Expression): string | undefined => {
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
    if (variable(value)) return "var(--a)";
    if (!ts.isTemplateExpression(value)) return undefined;
    let text = value.head.text;
    for (const span of value.templateSpans) {
      if (!variable(span.expression)) return undefined;
      text += `var(--a)${span.literal.text}`;
    }
    return text;
  };

  /** A group's declarations, as written: property, value and node, nested rules left out. */
  const declared = (element: ts.Expression): [string, string, ts.Node][] => {
    if (!ts.isObjectLiteralExpression(element)) return [];
    const out: [string, string, ts.Node][] = [];
    for (const property of element.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      // The name's OWN file: a spread's block is usually declared in another one.
      const written = ts.isStringLiteral(property.name) ? property.name.text : property.name.getText();
      if (written.startsWith("&") || written.startsWith("@")) continue;
      const value = valueOf(property.initializer);
      if (value !== undefined) out.push([written, value, property.name]);
    }
    return out;
  };

  /** Which helper a call in a block's array is — by name, since another file's block names its own. */
  const helper = (element: ts.Expression): "from" | "cond" | undefined => {
    if (!ts.isCallExpression(element) || !ts.isIdentifier(element.expression)) return undefined;
    const name = element.expression.text;
    if (name === helpers?.from || /^__from\d*$/.test(name)) return "from";
    if (name === helpers?.cond || /^__cond\d*$/.test(name)) return "cond";
    return undefined;
  };

  /**
   * One block's top level, in order, against what is standing — its spreads add, its declarations
   * are checked and then CLEAR what they cover, as the merge does: a block that sets `border` itself
   * after a spread has taken the spread's whole `border` away.
   *
   * A GUARDED group ends the walk. The virtual file writes `when` as a marker followed by the group's
   * declarations with nothing where the group closes, so whether a later re-set is guarded cannot
   * be read here — and a rule that guesses reports correct code. The merge's development warning
   * still sees what is left. A `match`'s arms each set the family, so they clear like one
   * declaration. `path` stops a cycle and nothing else: a block spread twice counts twice, as its
   * classes land twice.
   */
  const walk = (
    array: ts.ArrayLiteralExpression,
    standing: Standing[],
    /** Where this block's own declarations come from, and where what it spreads comes from. */
    origin: { readonly own: number; readonly spread: number },
    found: (node: ts.Node, narrower: string, covering: Standing) => void,
    path: Set<ts.Node>,
  ): void => {
    if (path.has(array)) return;
    path.add(array);
    for (const element of array.elements) {
      const kind = helper(element);
      if (kind === "cond") break;
      if (kind === "from") {
        const inner = blockOf((element as ts.CallExpression).arguments[0]);
        if (inner !== undefined) walk(inner, standing, { own: origin.spread, spread: origin.spread }, () => {}, path);
        continue;
      }
      for (const [property, value, where] of declared(element)) {
        const important = IMPORTANT.test(value);
        const isWhole = whole(property, value);
        if (isWhole) {
          const covering = standing.find((one) => one.important === important && covers(one.property, property));
          if (covering !== undefined) found(where, property, covering);
        }
        for (let at = standing.length - 1; at >= 0; at--) {
          const one = standing[at];
          if (one.important === important && (one.property === property || covers(property, one.property)))
            standing.splice(at, 1);
        }
        if (isWhole) standing.push({ property, important, from: origin.own });
      }
    }
    path.delete(array);
  };

  const said = (node: ts.Node, narrower: string, wider: string): void =>
    report(node, {
      rule: "narrower-after-a-whole-shorthand",
      message:
        `\`${narrower}\` comes after \`${wider}\`, and both reach the stylesheet whole, so no order keeps ` +
        `\`${narrower}\` winning on every page. Set its longhands instead.`,
    });

  const visit = (node: ts.Node): void => {
    // A block of THIS file: what its spreads leave standing, against what it writes below them.
    if (helpers !== undefined && calls(node, helpers.block)) {
      const [array] = node.arguments;
      if (
        array !== undefined &&
        ts.isArrayLiteralExpression(array) &&
        array.elements.some((one) => helper(one) === "from")
      )
        walk(
          array,
          [],
          { own: 0, spread: 1 },
          (where, narrower, covering) => {
            if (covering.from === 1) said(where, narrower, covering.property);
          },
          new Set(),
        );
    }
    // And a merge at a call site, argument by argument: told at the argument, and only for a wider
    // shorthand an EARLIER argument left — one inside the argument's own block is its file's.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      let symbol = checker.getSymbolAtLocation(node.expression);
      if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      // The package's own `mergeClassNames`, by where it is DECLARED — an app's function of that
      // name is not asked about.
      const origin = symbol?.declarations?.[0]?.getSourceFile().fileName ?? "";
      if (symbol?.name === "mergeClassNames" && /[\\/](@ramonda[\\/]css|packages[\\/]css)[\\/]/.test(origin)) {
        const standing: Standing[] = [];
        node.arguments.forEach((argument, index) => {
          const block = blockOf(argument);
          if (block === undefined) return;
          let told = false;
          walk(
            block,
            standing,
            { own: index, spread: index },
            (_where, narrower, covering) => {
              if (!told && covering.from < index) said(argument, narrower, covering.property);
              told = true;
            },
            new Set(),
          );
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}
