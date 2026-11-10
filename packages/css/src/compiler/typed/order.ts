/**
 * `override-out-of-order` across blocks: the spread is a value, and only a program can follow it to
 * the block it names.
 *
 * A typed rule — see `index.ts` for what separates these from the rules in `rules/`.
 */
import { type Helpers, calls } from "./shared";
import { readersFor } from "./cascade";
import { IMPORTANT } from "../split";
import { SHORTHANDS } from "../keywords.generated";
import { type TypedFinding } from "./index";
import { covers, widthSlot } from "../flatten";
import ts from "typescript";

/** One declaration a block sets, with the conditions it is under, as the author wrote it. */
interface Setting {
  readonly property: string;
  readonly important: boolean;
  readonly conditions: readonly string[];
  /** Where it is written, for a report about it. */
  readonly node: ts.Node;
}

/** Every property a declaration sets: itself, and every longhand when it is a shorthand. */
/** What a setting the block wrote ITSELF is filed under, so it is never compared with its own kind. */
const OWN = "this block";

const setsOf = (property: string): readonly string[] => [property, ...(SHORTHANDS[property] ?? [])];

/** Whether two declarations set any one property in common — what the merge's warning groups by. */
const touch = (one: string, other: string): boolean => {
  if (one === other) return true;
  const sets = new Set(setsOf(one));
  return setsOf(other).some((each) => sets.has(each));
};

/**
 * `override-out-of-order` across blocks — a spread, or `mergeClassNames(a, b)`.
 *
 * Inside one block the compiler reports a declaration written to override one above it that the
 * stylesheet will not let win: the sheet emits the stronger condition last, so
 * `@media print { border: none; } border-top-color: blue` keeps print's border wherever both apply,
 * whatever the order says. Across a spread it could not, because `...$(card)` is a VALUE to it — so
 * only the merge saw it, in development, as a console warning with no file, no line and the class's
 * short name. Found by the second trial: twelve such lines scrolled past a build, the check passed,
 * and the author had to guess which of sixteen files they meant.
 *
 * This asks the merge's own question, with the merge's own answer to "stronger" — `widthSlot`, which
 * is also what orders the sheet — and its own boundaries, each measured where the merge's were:
 *
 * - **a rule under a selector is not compared.** A selector adds specificity, which settles the pair
 *   before source order does; the merge registers no slot for one.
 * - **importance decides first**, whatever the conditions, so an important and an ordinary
 *   declaration are never compared.
 * - **a block that sets the property itself, under the same conditions, clears the spread's**, as the
 *   merge does — what is left standing is all that can win.
 * - **a guarded group ends the walk**: where it closes cannot be read from the virtual file, so a
 *   later declaration may be guarded or not, and a rule that guesses reports correct code. The
 *   merge's warning still sees what is left.
 *
 * Reported at the declaration the author wrote last, which is the one that will not win.
 */
export function orderAcrossBlocks(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  helpers: Helpers | undefined,
  report: (node: ts.Node, finding: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  const { blockOf, valueOf, helper } = readersFor(checker, helpers);

  /**
   * One block's settings, in order: its spreads first where they stand, its condition groups with
   * their condition, its selector groups left out. False when a guarded group ended the walk.
   * `path` stops a cycle of spreads and nothing else.
   */
  const read = (
    elements: readonly ts.Expression[],
    conditions: readonly string[],
    each: (setting: Setting) => void,
    path: Set<ts.Node>,
  ): boolean => {
    for (const element of elements) {
      const kind = helper(element);
      if (kind === "cond") return false;
      if (kind === "from") {
        const inner = blockOf((element as ts.CallExpression).arguments[0]);
        if (inner === undefined || path.has(inner)) continue;
        path.add(inner);
        const went = read(inner.elements, conditions, each, path);
        path.delete(inner);
        if (!went) return false;
        continue;
      }
      if (!ts.isObjectLiteralExpression(element)) continue;
      for (const property of element.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const written = ts.isStringLiteral(property.name) ? property.name.text : property.name.getText();
        if (written.startsWith("@")) {
          const inner = property.initializer;
          if (ts.isArrayLiteralExpression(inner) && !read(inner.elements, [...conditions, written], each, path))
            return false;
          continue;
        }
        // A selector group, and anything else that is not a declaration.
        if (written.startsWith("&") || ts.isArrayLiteralExpression(property.initializer)) continue;
        const value = valueOf(property.initializer);
        each({
          property: written,
          important: value !== undefined && IMPORTANT.test(value),
          conditions,
          node: property.name,
        });
      }
    }
    return true;
  };

  const sameConditions = (one: Setting, other: Setting): boolean =>
    one.conditions.join("|") === other.conditions.join("|");

  /** What a later setting is checked against, and what it clears, as the merge does. */
  const against = <S extends Setting>(
    standing: S[],
    later: Setting,
    told: (earlier: S) => void,
    /** Earlier settings this one is not compared with — it still clears them. */
    skip: (earlier: S) => boolean = () => false,
  ): void => {
    const slot = widthSlot(later.conditions);
    const loses = standing.find(
      (earlier) =>
        !skip(earlier) &&
        earlier.important === later.important &&
        !sameConditions(earlier, later) &&
        touch(earlier.property, later.property) &&
        widthSlot(earlier.conditions) > slot,
    );
    if (loses !== undefined) told(loses);
    for (let at = standing.length - 1; at >= 0; at--) {
      const earlier = standing[at];
      if (
        earlier.important === later.important &&
        sameConditions(earlier, later) &&
        (earlier.property === later.property || covers(later.property, earlier.property))
      )
        standing.splice(at, 1);
    }
  };

  const said = (node: ts.Node, later: Setting, earlier: Setting, via: string): void =>
    report(node, {
      rule: "override-out-of-order",
      message:
        `\`${later.property}\` is written to override the \`${earlier.property}\` that ${via} sets under ` +
        `\`${earlier.conditions.join(" ")}\`, and it will not — the stylesheet emits the stronger ` +
        `condition last, so that one wins wherever both apply. Set it under that condition too, or ` +
        `do not take \`${earlier.property}\` from there.`,
    });

  const visit = (node: ts.Node): void => {
    // A block of THIS file: what its spreads set, against what it writes below them.
    if (helpers !== undefined && calls(node, helpers.block)) {
      const [array] = node.arguments;
      if (ts.isArrayLiteralExpression(array) && array.elements.some((one) => helper(one) === "from")) {
        const standing: (Setting & { via: string })[] = [];
        // Which spread, as written in this block, brought what is being read now.
        let via = "";
        const top = new Set<ts.Node>([array]);
        for (const element of array.elements) {
          const kind = helper(element);
          if (kind === "cond") break;
          if (kind === "from") {
            const argument = (element as ts.CallExpression).arguments[0];
            via = `\`...$(${argument.getText().replace(/^\((.*)\)$/s, "$1")})\``;
            const inner = blockOf(argument);
            if (inner === undefined) continue;
            /**
             * Against what EARLIER spreads left, too, told once at this spread. Found by review: two
             * spreads were never compared with each other. What this spread sets among itself is
             * its own block's business, so its settings join `standing` only after.
             */
            const mine: (Setting & { via: string })[] = [];
            let told = false;
            top.add(inner);
            const went = read(
              inner.elements,
              [],
              (one) => {
                mine.push({ ...one, via });
                against(standing, one, (earlier) => {
                  // At the name itself: the parentheses around it are the virtual file's, and a place
                  // in them maps to nowhere in the author's text.
                  let at: ts.Expression = argument;
                  while (ts.isParenthesizedExpression(at)) at = at.expression;
                  if (!told) said(at, one, earlier, earlier.via);
                  told = true;
                });
              },
              top,
            );
            top.delete(inner);
            standing.push(...mine);
            if (!went) break;
            continue;
          }
          const went = read(
            [element],
            [],
            (later) => {
              // Against what a SPREAD left only: two of the block's own are the compiler's question.
              against(
                standing,
                later,
                (earlier) => said(later.node, later, earlier, earlier.via),
                (earlier) => earlier.via === OWN,
              );
              // Kept, so a spread BELOW it is compared with it — found by review, they were dropped.
              standing.push({ ...later, via: OWN });
            },
            top,
          );
          if (!went) break;
        }
      }
    }
    // And a merge at a call site, argument by argument, told at the argument.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      let symbol = checker.getSymbolAtLocation(node.expression);
      if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const origin = symbol?.declarations?.[0]?.getSourceFile().fileName ?? "";
      if (symbol?.name === "mergeClassNames" && /[\\/](@ramonda[\\/]css|packages[\\/]css)[\\/]/.test(origin)) {
        const standing: (Setting & { via: string })[] = [];
        for (const argument of node.arguments) {
          const block = blockOf(argument);
          if (block === undefined) continue;
          const mine: (Setting & { via: string })[] = [];
          let told = false;
          read(
            block.elements,
            [],
            (later) => {
              mine.push({ ...later, via: `\`${argument.getText()}\`` });
              against(standing, later, (earlier) => {
                if (!told) said(argument, later, earlier, earlier.via);
                told = true;
              });
            },
            new Set([block]),
          );
          standing.push(...mine);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}
