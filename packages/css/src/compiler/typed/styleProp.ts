/**
 * `style-prop-never-used` and `style-prop-overridden`: a block prop a component declares and never
 * uses, and one it uses and then takes back with a declaration below the spread.
 *
 * A typed rule — see `index.ts` for what separates these from the rules in `rules/`.
 */
import { type Helpers, allowedBy, calls, isBlock } from "./shared";
import { type TypedFinding } from "./index";
import { conflict, covers } from "../flatten";
import ts from "typescript";

/**
 * Every DECLARATION an expression can reach, one hop at a time through what a name was declared as.
 *
 * **Declarations rather than symbols, and that is not a style choice.** A component's props reach it
 * through `Readonly<P>`, and a homomorphic mapped type synthesises a NEW symbol per property — so
 * `this.props.css` and the `css` in the type it came from are two symbols for one thing. Measured
 * on the real shape: identical symbol 0 times, shares a declaration 1. Comparing symbols reported
 * every style prop on every real component in this repository while the fixtures, which declared
 * their props inline, all passed.
 */
function reaches(checker: ts.TypeChecker, node: ts.Node, out: Set<ts.Node>, seen = new Set<ts.Node>()): void {
  if (seen.has(node)) return;
  seen.add(node);

  const visit = (one: ts.Node): void => {
    if (ts.isIdentifier(one) || ts.isPropertyAccessExpression(one)) {
      const name = ts.isPropertyAccessExpression(one) ? one.name : one;
      const symbol = checker.getSymbolAtLocation(name);
      if (symbol !== undefined) {
        for (const declaration of symbol.getDeclarations() ?? []) {
          out.add(declaration);
          if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
            reaches(checker, declaration.initializer, out, seen);
          }
          if (
            (ts.isMethodDeclaration(declaration) || ts.isGetAccessorDeclaration(declaration)) &&
            declaration.body !== undefined
          ) {
            reaches(checker, declaration.body, out, seen);
          }
          /**
           * A destructured binding and the property it came FROM are two declarations of one thing,
           * and a RENAME is what makes that visible: `const { css: mine } = props` puts the prop
           * under a name the grouping by name can never match, so without this it is reported while
           * being used perfectly well.
           */
          if (ts.isBindingElement(declaration)) {
            /**
             * The thing destructured, which is NOT always the declaration holding the pattern.
             * `function C({ css }: { css?: CssBlock })` is a parameter and its type is the props;
             * `const { css: mine } = props` is a variable declaration, and asking IT gives `any`
             * with no properties at all — measured, which is why the initialiser is preferred.
             */
            const holder = declaration.parent.parent;
            const source =
              ts.isVariableDeclaration(holder) && holder.initializer !== undefined ? holder.initializer : holder;
            const from = checker.getTypeAtLocation(source);
            const key = declaration.propertyName ?? declaration.name;
            const property = ts.isIdentifier(key) || ts.isStringLiteral(key) ? from.getProperty(key.text) : undefined;
            for (const one of property?.getDeclarations() ?? []) out.add(one);
          }
        }
      }
    }
    ts.forEachChild(one, visit);
  };

  ts.forEachChild(node, visit);
  visit(node);
}

/** The container a declaration belongs to — a class or a function. Pure TypeScript, no framework. */
function scopeOf(node: ts.Node): ts.Node {
  let found: ts.Node = node;
  while (
    found.parent !== undefined &&
    !ts.isClassDeclaration(found) &&
    !ts.isClassExpression(found) &&
    !ts.isFunctionDeclaration(found) &&
    !ts.isFunctionExpression(found) &&
    !ts.isArrowFunction(found) &&
    !ts.isMethodDeclaration(found)
  ) {
    found = found.parent;
  }
  return found;
}

/**
 * **Rule 1 — a style prop nobody uses.**
 *
 * A component takes a block through a prop, a caller sends one, and the child never puts it on an
 * element. Nothing fails: the styles simply do not arrive, which is the quiet way a component and
 * its caller come apart.
 *
 * ## It walks BACKWARD, from the consumers
 *
 * A walk from the declaration out to its references reports a prop that IS used: `const mine =
 * props.sx; ...$(mine)` reaches a block through one local, and a reference walk sees an assignment
 * rather than a spread. So the pass runs the other way, from every helper call back through what
 * each name was declared as, and the set it builds is *what was consumed* rather than *where this
 * went*.
 *
 * ## Its one honest limit
 *
 * A prop consumed inside a method nobody calls passes quietly. That is reachability, which is a
 * different tool; this answers *never consumed*, not *consumed only where nothing runs*.
 */
export function neverUsed(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  helpers: Helpers,
  report: (node: ts.Node, finding: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  /** Every declaration in the file whose type is a block, whatever kind of thing declares it. */
  const slots: { name: ts.Node; symbol: ts.Symbol; scope: ts.Node }[] = [];
  const collect = (node: ts.Node): void => {
    /**
     * A subject is a PROP, not every binding that happens to hold a block.
     *
     * A binding element destructuring a PARAMETER is a prop written the short way; one
     * destructuring a variable — `const { css: mine } = props` — is a local, and an unused local is
     * TypeScript's own `noUnusedLocals` rather than this rule's business. Measured: counting it
     * reported that one shape twice, once for the prop and once for the local standing for it.
     */

    const destructuresAProp = ts.isBindingElement(node) && !ts.isVariableDeclaration(node.parent.parent);
    const named =
      ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) || destructuresAProp
        ? (node as ts.PropertySignature | ts.PropertyDeclaration | ts.BindingElement).name
        : undefined;
    if (named !== undefined && isBlock(checker, checker.getTypeAtLocation(node))) {
      const symbol = checker.getSymbolAtLocation(named);
      const scope = scopeOf(node);
      /**
       * **A scope with no BODY can never consume anything.** `declare function Inner(p: { css?:
       * CssBlock })` states a signature and holds no code, so nothing in it could put the prop on
       * an element — the rule would be reporting a fault the author cannot act on and cannot be
       * right about. Measured: a wrapper that DECLARES the component it renders was reported for
       * that component's prop rather than its own.
       *
       * Asked as *has a body* rather than *is ambient*, because that is the reason — and because
       * `NodeFlags.Ambient` is internal to TypeScript.
       */
      if (ts.isFunctionLike(scope) && (scope as { body?: ts.Node }).body === undefined) return;
      if (symbol !== undefined) slots.push({ name: named, symbol, scope });
    }
    ts.forEachChild(node, collect);
  };
  collect(file);
  if (slots.length === 0) return;

  /** One scope's consumed set, built once however many slots that scope declares. */
  const consumedIn = new Map<ts.Node, Set<ts.Node>>();
  const consumersOf = (scope: ts.Node): Set<ts.Node> => {
    const already = consumedIn.get(scope);
    if (already !== undefined) return already;

    const found = new Set<ts.Node>();
    const visit = (node: ts.Node): void => {
      if (calls(node, helpers.from) || calls(node, helpers.hole)) {
        for (const argument of node.arguments) reaches(checker, argument, found);
      }
      /**
       * Put straight on an element, or handed on to something that also takes a block. Both are
       * uses, and the first is what a component writes when it has no styles of its own.
       *
       * **`className` is matched by NAME, and it has to be.** A block is a string, so the attribute
       * it lands on is declared `string` — there is no block type in that position for a contextual
       * match to find. Without it, every component that forwards styles is reported as never using
       * its prop: `<div className={props.css}>` is the ordinary shape, and a false report on the
       * ordinary case is the one failure a checker does not survive.
       *
       * `css` is kept beside it because a COMPONENT may still call its own prop that, and handing a
       * block to one is a use like any other — that half is a contextual match below, but a wrapper
       * on another JSX library can declare `css` on an intrinsic element too.
       *
       * Forwarding is matched by the CONTEXTUAL type instead, so it is the receiving prop's own
       * declaration that decides. Whether the two allow-lists AGREE is a separate question.
       */
      if (ts.isJsxAttribute(node) && node.initializer !== undefined) {
        const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
        const name = ts.isIdentifier(node.name) ? node.name.text : node.name.getText();
        if (value !== undefined && (name === "className" || name === "css")) reaches(checker, value, found);
      }
      /**
       * Anything whose CONTEXTUAL type is a block has been handed somewhere that takes one, which
       * is a use however it was written — a JSX attribute, a property in an object, an argument to
       * an ordinary function. Asking the position's KIND instead misses the third: a component that
       * hands its prop to a helper would be reported while using it perfectly well.
       */
      if (ts.isExpression(node)) {
        const wanted = checker.getContextualType(node);
        if (wanted !== undefined && isBlock(checker, wanted)) reaches(checker, node, found);
      }
      ts.forEachChild(node, visit);
    };
    visit(scope);
    consumedIn.set(scope, found);
    return found;
  };

  /**
   * **One subject per NAME in a scope, not one per declaration.**
   *
   * `function Card({ sx }: { sx?: CssBlock })` declares the prop twice — a `BindingElement` and the
   * `PropertySignature` it destructures — and they are different symbols. Measured: asking about
   * each separately reported the prop TWICE, and linking them through the checker did not work,
   * because `getPropertySymbolOfDestructuringAssignment` is about a destructuring assignment and
   * not about a parameter's binding pattern.
   *
   * Grouping answers it without the checker: two declarations of one name in one scope are one
   * thing, consumed if EITHER symbol was, and reported at whichever came first — which is the
   * binding, the spelling the author actually reads.
   */
  const byName = new Map<string, typeof slots>();
  for (const slot of slots) {
    const key = `${slot.scope.pos}|${slot.name.getText()}`;
    const already = byName.get(key);
    if (already === undefined) byName.set(key, [slot]);
    else already.push(slot);
  }

  for (const group of byName.values()) {
    const slot = group[0];
    if (group.some((each) => (each.symbol.getDeclarations() ?? []).some((one) => consumersOf(each.scope).has(one))))
      continue;
    const name = slot.name.getText();
    report(slot.name, {
      rule: "style-prop-never-used",
      message:
        `\`${name}\` takes a style block and is never put on an element, so whatever a caller ` +
        `sends is\n        dropped without a word.\n\n        Spread it into a block — ` +
        `\`...$(${name});\` — or take the prop off.`,
    });
  }
}

/**
 * **Rule 2 — a declaration below the spread that clears what a caller may send.**
 *
 * `...$(props.sx); padding: 8px` where the prop allows `padding-left`: the shorthand clears the
 * longhand, exactly as CSS says, and the caller's value is gone. **The merge is not wrong here** —
 * the clear-list is emitted with its full context and does precisely this — so the fault is not a
 * broken override. It is a component that PROMISED a property in its allow-list and then took it
 * back, which is a question about the API and not about the stylesheet.
 *
 * Two fixes and both are right: move the spread below, or take the property out of the allow-list.
 *
 * ## Only a NARROWED prop is asked about
 *
 * A prop typed as a bare `CssBlock` promised nothing in particular, so nothing it promised can be
 * broken. Asking anyway would report every component that spreads a style prop and then writes a
 * shorthand, which is ordinary and correct code.
 *
 * ## The group is the ARRAY, which is what makes "below" answerable
 *
 * A block is one array and a nested rule is an array of its own, so a declaration is compared only
 * with the spread it actually sits after. `&:hover` is the same element and still its own group —
 * the same boundary `declaration-does-nothing` draws, for the same reason.
 */
export function overriddenBelow(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  helpers: Helpers,
  report: (node: ts.Node, finding: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isArrayLiteralExpression(node)) {
      /**
       * One pass in source order, carrying what the spreads SO FAR have promised.
       *
       * Every spread and then everything after it would report one declaration twice, at the same
       * character, in a block with two spreads. A declaration is one fault whatever it clears,
       * which is the same answer the rest of this package gives.
       */
      const promised = new Set<string>();

      for (const element of node.elements) {
        if (calls(element, helpers.from)) {
          for (const one of allowedBy(checker, checker.getTypeAtLocation(element.arguments[0])) ?? []) {
            promised.add(one);
          }
          continue;
        }
        if (promised.size === 0 || !ts.isObjectLiteralExpression(element)) continue;

        for (const property of element.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const written = ts.isStringLiteral(property.name) ? property.name.text : property.name.getText();
          // A nested rule is its own group, so it is not "below" anything out here — and a spread
          // may not stand inside one anyway, which `spread-out-of-place` is what says so.
          if (written.startsWith("&") || written.startsWith("@")) continue;

          const cleared = [...promised].filter(
            (one) => covers(written, one) || (written === one && conflict(one, one)),
          );
          if (cleared.length === 0) continue;

          report(property.name, {
            rule: "style-prop-overridden",
            message:
              `\`${written}\` is written below the spread and clears \`${cleared.join("`, `")}\`, ` +
              `which this\n        component's own type says a caller may send — so what they send ` +
              `is thrown away.\n\n        Move the spread below this declaration, or take ` +
              `\`${cleared[0]}\` out of the prop's type.`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}
