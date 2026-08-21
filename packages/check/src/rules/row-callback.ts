import ts from "typescript";
import type { ElementContext, JsxElementLike } from "./rule";

/**
 * The callback that builds this row, and how — written where the list is, or extracted to a name.
 *
 * Written once, here, because three rules ask the same question about the same callback and two of
 * them had their own copy of the walk. `row-without-a-key` wants to know THAT a row is a row;
 * `index-as-key` wants the callback's second parameter; `duplicate-key-among-siblings` asks about
 * siblings and needs neither. Two spellings of one walk is two answers waiting to disagree about
 * the same list.
 *
 * ## The extracted callback, which is where the fault is likeliest to be
 *
 * `rows.map(renderRow)` is the same list as `rows.map((row) => …)`, and the row inside `renderRow`
 * is the same row. Both walks read only the inline form, so a list stopped being checked at exactly
 * the moment it grew big enough for somebody to lift the row out of the JSX — which is the list
 * most likely to have a real key fault in it. Measured with `fixtures/key-family`: four rows and
 * one indexed key, all silent.
 *
 * The reverse lookup is bounded on purpose. A callback is only searched for when the walk lands on
 * a `const` holding it, which is rare, and only WITHIN THE FILE — a callback exported and used
 * somewhere else stays out of reach, and out of the claim. The identifier is compared by SYMBOL
 * rather than by text, so a shadowed name cannot answer for one it is not.
 */

/** The calls that turn data into rows. `list` is matched by name, as the form rules match `Field`. */
const BUILDS_ROWS: ReadonlySet<string> = new Set(["map", "list", "flatMap"]);

/** The calls that hand their callback an INDEX. `list()` deliberately does not. */
const HANDS_AN_INDEX: ReadonlySet<string> = new Set(["map", "flatMap"]);

export interface RowCallback {
  /** How the rows are built, because the two need different advice. */
  via: "map" | "list";
  /** The name of the index parameter, when the callback takes one this can name. */
  index: string | undefined;
}

/**
 * Whether this element IS a row — the value a row-building callback returns.
 *
 * The DIRECT return, and that is the whole precision of it: in `rows.map((row) => <tr><td /></tr>)`
 * the `<tr>` is the row and the `<td>` is not. Walking up through a parenthesis, a conditional and
 * a `&&` keeps that true for the shapes people write — `(row) => cond ? <tr /> : <tr className="x" />`
 * is two rows, not none.
 */
export function rowCallbackFor(element: JsxElementLike, resolve: ElementContext["resolve"]): RowCallback | undefined {
  let at: ts.Node | undefined = element.parent;

  while (at !== undefined) {
    if (ts.isParenthesizedExpression(at) || ts.isConditionalExpression(at) || ts.isBinaryExpression(at)) {
      at = at.parent;
      continue;
    }
    // A `return` inside a block body reaches the same place a concise body does.
    if (ts.isReturnStatement(at) || ts.isBlock(at)) {
      at = at.parent;
      continue;
    }
    if (!ts.isArrowFunction(at) && !ts.isFunctionExpression(at)) return undefined;

    const callback = at;
    const parent = callback.parent;

    // `rows.map((row) => …)` — the callback written where the list is.
    if (ts.isCallExpression(parent)) return builtBy(parent, callback);

    // `const renderRow = (row) => …` — the same callback, lifted out of the JSX.
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return passedToARowCall(parent.name, callback, resolve);
    }
    return undefined;
  }
  return undefined;
}

/** The name a call names, when it is one that builds rows; `undefined` for every other call. */
function namedCallee(call: ts.CallExpression): string | undefined {
  const named = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : ts.isIdentifier(call.expression)
      ? call.expression.text
      : undefined;

  return named !== undefined && BUILDS_ROWS.has(named) ? named : undefined;
}

/** What a call makes of the callback it was handed, when the call builds rows at all. */
function builtBy(call: ts.CallExpression, callback: ts.SignatureDeclaration): RowCallback | undefined {
  const named = namedCallee(call);
  if (named === undefined) return undefined;

  return {
    via: named === "list" ? "list" : "map",
    index: HANDS_AN_INDEX.has(named) ? indexParameterOf(callback) : undefined,
  };
}

/**
 * The index parameter's name — the callback's SECOND, which is a fact about the syntax.
 *
 * `undefined` when there is no second parameter, or when it is destructured: a shape nobody writes
 * for an index, and one this cannot name.
 */
function indexParameterOf(callback: ts.SignatureDeclaration): string | undefined {
  const index = callback.parameters[1];
  return index !== undefined && ts.isIdentifier(index.name) ? index.name.text : undefined;
}

/**
 * Every callback this file hands to a row-building call, by the SYMBOL of the name it was given.
 *
 * Built once per file and kept on a `WeakMap`, which is what makes the reverse lookup affordable.
 * Asked per candidate instead, it is one walk of the whole file each time — measured on a file with
 * 400 extracted callbacks, that is 0.55 s becoming 0.95 s, and the shape is quadratic in the file
 * rather than linear. Memoised it is one walk however many rows the file has.
 *
 * A `WeakMap` rather than a cache with a lifetime: a second `analyzeProject` builds new
 * `SourceFile` nodes, so nothing here can go stale.
 */
const HANDED_OVER = new WeakMap<ts.SourceFile, Map<ts.Symbol, ts.CallExpression>>();

function rowCallsIn(file: ts.SourceFile, resolve: ElementContext["resolve"]): Map<ts.Symbol, ts.CallExpression> {
  const known = HANDED_OVER.get(file);
  if (known !== undefined) return known;

  const found = new Map<ts.Symbol, ts.CallExpression>();

  (function look(node: ts.Node): void {
    if (ts.isCallExpression(node) && namedCallee(node) !== undefined) {
      for (const argument of node.arguments) {
        if (!ts.isIdentifier(argument)) continue;
        const symbol = resolve(argument);
        // The FIRST call decides: a callback handed to two lists is one callback either way, and
        // both readings say the elements inside it are rows.
        if (symbol !== undefined && !found.has(symbol)) found.set(symbol, node);
      }
    }
    ts.forEachChild(node, look);
  })(file);

  HANDED_OVER.set(file, found);
  return found;
}

/** A row-building call, in this file, that is handed the callback this name holds. */
function passedToARowCall(
  name: ts.Identifier,
  callback: ts.SignatureDeclaration,
  resolve: ElementContext["resolve"],
): RowCallback | undefined {
  const declared = resolve(name);
  if (declared === undefined) return undefined;

  const call = rowCallsIn(name.getSourceFile(), resolve).get(declared);
  return call === undefined ? undefined : builtBy(call, callback);
}
