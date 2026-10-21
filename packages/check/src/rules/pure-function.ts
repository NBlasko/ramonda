import ts from "typescript";
import { unwrap } from "./follow-value";
import type { Resolver } from "./rule";

/**
 * Whether a function is PURE as this package can prove it: what it returns depends on its parameters
 * and on constants, and it changes nothing.
 *
 * Read from source, as everything here is — no types. So what a call does is known only where its
 * body can be read: a function written in the project is followed into, and anything else is allowed
 * only when it is a built-in this table names as changing nothing. A call whose body cannot be read —
 * a package's `.d.ts` — is not pure as far as anything here can show, and says so.
 */

/** Globals a pure function may read: values and namespaces that change nothing and depend on nothing. */
const PURE_GLOBALS = new Set([
  "Math",
  "Number",
  "String",
  "Boolean",
  "JSON",
  "Array",
  "Object",
  "RegExp",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "NaN",
  "Infinity",
  // Constructors: `new Map`, `new Set` and a dated `new Date(x)` make a value of their own — see `new`.
  "Map",
  "Set",
  "Date",
  "undefined",
  "encodeURIComponent",
  "decodeURIComponent",
]);

/** Members of those globals that are not pure — they read the clock, chance or the environment. */
const IMPURE_MEMBERS = new Set(["random", "now"]);

/** Methods of strings, numbers, regular expressions and arrays that return a value and change nothing. */
const PURE_METHODS = new Set([
  "at",
  "charAt",
  "charCodeAt",
  "codePointAt",
  "concat",
  "endsWith",
  "includes",
  "indexOf",
  "lastIndexOf",
  "localeCompare",
  "match",
  "matchAll",
  "normalize",
  "padEnd",
  "padStart",
  "repeat",
  "replace",
  "replaceAll",
  "search",
  "slice",
  "split",
  "startsWith",
  "substring",
  "toLowerCase",
  "toUpperCase",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
  "trim",
  "trimEnd",
  "trimStart",
  "toString",
  "valueOf",
  "test",
  "exec",
  "toFixed",
  "toPrecision",
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flat",
  "flatMap",
  "join",
  "keys",
  "map",
  "reduce",
  "reduceRight",
  "some",
  "values",
  "entries",
  "isArray",
  "from",
  "of",
  "max",
  "min",
  "abs",
  "floor",
  "ceil",
  "round",
  "trunc",
  "sign",
  "pow",
  "sqrt",
  "isInteger",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "stringify",
  "parse",
  "fromCharCode",
  "fromCodePoint",
  "toSorted",
  "toReversed",
  "with",
  "has",
  "get",
]);

/** Methods that change the array they are called on — pure only on an array the function made itself. */
const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);

export type FunctionBody = ts.FunctionLikeDeclaration;

/** Why a function is not pure, at the node that makes it so — or `undefined` when it is. */
export interface Impurity {
  at: ts.Node;
  why: string;
}

const DEPTH = 8;

/**
 * Whether `fn` is pure, following every function it calls that is written in the project — up to
 * `DEPTH` calls deep, past which the answer is "not shown", and so not pure.
 */
export function whyImpure(
  fn: FunctionBody,
  resolve: Resolver,
  depth = 0,
  seen = new Set<string>(),
  fixedFactory?: ts.Node,
): Impurity | undefined {
  // One function made by two calls is two answers — `maxLength(20)` and `maxLength(current)`.
  const key = `${fn.getSourceFile().fileName}:${fn.pos}:${fixedFactory?.pos ?? -1}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  if (depth > DEPTH) return { at: fn, why: "it calls further than this follows" };
  if (fn.body === undefined) return { at: fn, why: "its body cannot be read" };

  /** Whether a name is declared inside `fn` — a parameter or a local — or inside a function enclosing it. */
  /**
   * Whether reading `declaration` from inside `fn` reads something that cannot change: one of `fn`'s
   * own names; a parameter of the factory that made `fn`, when the call that made it handed fixed
   * values (`maxLength(20)`); or a `const` anywhere holding a fixed value (see `isFixed`).
   */
  const unchanging = (declaration: ts.Node): boolean => {
    if (isInside(declaration, fn)) return true;
    if (ts.isParameter(declaration)) return fixedFactory !== undefined && declaration.parent === fixedFactory;
    return (
      ts.isVariableDeclaration(declaration) &&
      isConst(declaration) &&
      declaration.initializer !== undefined &&
      isFixed(declaration.initializer, resolve)
    );
  };

  let found: Impurity | undefined;
  const fail = (at: ts.Node, why: string) => {
    found ??= { at, why };
  };

  const rootOf = (expression: ts.Expression): ts.Expression => {
    let at = unwrap(expression);
    while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) at = unwrap(at.expression);
    return at;
  };
  /**
   * Whether writing to `expression` changes only what `fn` made. A parameter may be pointed elsewhere,
   * but what it holds belongs to the caller — so `next = …` is local and `input.x = …` is not.
   */
  const isLocal = (expression: ts.Expression): boolean => {
    const written = unwrap(expression);
    const root = rootOf(written);
    if (!ts.isIdentifier(root)) return false;
    const declared = resolve(root)?.declarations?.[0];
    if (declared === undefined || !isInside(declared, fn)) return false;
    return written === root || !(ts.isParameter(declared) || ts.isBindingElement(declared));
  };

  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    // A type is gone by the time anything runs, so nothing in one is a read.
    if (ts.isTypeNode(node)) return;
    if (node.kind === ts.SyntaxKind.ThisKeyword) return fail(node, "it reads `this`");
    if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) return fail(node, "it waits");

    if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind) && !isLocal(node.left)) {
      return fail(node, `it writes \`${node.left.getText()}\`, which it did not make`);
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
      !isLocal(node.operand)
    ) {
      return fail(node, `it writes \`${node.operand.getText()}\`, which it did not make`);
    }

    if (ts.isNewExpression(node)) {
      const made = node.expression.getText();
      const timeless = made === "RegExp" || made === "Map" || made === "Set" || made === "Array";
      if (!(timeless || (made === "Date" && (node.arguments?.length ?? 0) > 0))) {
        return fail(node, `it makes \`new ${made}\``);
      }
    }

    if (ts.isCallExpression(node)) {
      const why = callImpurity(node);
      if (why !== undefined) return fail(node, why);
    }

    if (ts.isIdentifier(node) && isRead(node)) {
      const declared = resolve(node)?.declarations?.[0];
      if (declared === undefined || fromThePlatform(declared)) {
        if (!PURE_GLOBALS.has(node.text)) return fail(node, `it reads \`${node.text}\`, which the page owns`);
      } else if (!isInside(declared, fn)) {
        // A function named as a value — `map(toDigit)` — runs too, so it is read like one that is called,
        // wherever it is declared: a `const` holding an arrow is followed as a `function` is. One of
        // `fn`'s own is part of `fn`'s body, and was read with it.
        const callee = ts.isCallExpression(node.parent) && node.parent.expression === node;
        const reached = callee ? undefined : reach(declared, resolve);
        const named = reached?.fn;
        if (named !== undefined && !named.getSourceFile().isDeclarationFile && named.body !== undefined) {
          const inner = whyImpure(named, resolve, depth + 1, seen, reached?.fixedFactory);
          if (inner !== undefined) return fail(node, `it hands on \`${node.text}\`, and ${inner.why}`);
        } else if (!unchanging(declared) && !ts.isFunctionLike(declared) && !isImportOfAFunction(declared)) {
          return fail(node, `it reads \`${node.text}\`, which may change`);
        }
      }
    }

    if (ts.isPropertyAccessExpression(node) && IMPURE_MEMBERS.has(node.name.text)) {
      const root = rootOf(node.expression);
      if (ts.isIdentifier(root) && fromThePlatform(resolve(root)?.declarations?.[0]))
        return fail(node, `it reads \`${node.getText()}\``);
    }

    ts.forEachChild(node, visit);
  };

  const callImpurity = (call: ts.CallExpression): string | undefined => {
    const callee = unwrap(call.expression);
    const name = ts.isPropertyAccessExpression(callee) ? callee.name : ts.isIdentifier(callee) ? callee : undefined;
    if (name === undefined) return "it calls something this cannot name";

    const declared = resolve(name)?.declarations?.[0];
    const reached = declared === undefined ? undefined : reach(declared, resolve);
    const body = reached?.fn;
    if (body !== undefined && !body.getSourceFile().isDeclarationFile && body.body !== undefined) {
      const inner = whyImpure(body, resolve, depth + 1, seen, reached?.fixedFactory);
      return inner === undefined ? undefined : `it calls \`${callee.getText()}\`, and ${inner.why}`;
    }
    if (ts.isPropertyAccessExpression(callee)) {
      if (MUTATING_METHODS.has(name.text)) {
        return isLocal(callee.expression) ? undefined : `it changes \`${callee.expression.getText()}\``;
      }
      if (PURE_METHODS.has(name.text) && fromThePlatform(declared)) return undefined;
    }
    if (ts.isIdentifier(callee) && fromThePlatform(declared) && PURE_GLOBALS.has(callee.text)) return undefined;
    return `it calls \`${callee.getText()}\`, whose body cannot be read`;
  };

  visit(fn.body);
  return found;
}

/**
 * Whether a name is the platform's: declared nowhere — the analyzer's own program has no lib — or in
 * one of TypeScript's lib files, which a program with a lib resolves it to. Both answer the same, so
 * a rule says the same thing whichever program it is handed.
 */
export function fromThePlatform(declared: ts.Declaration | undefined): boolean {
  if (declared === undefined) return true;
  return TYPESCRIPT_LIB.test(declared.getSourceFile().fileName);
}

/** `…/typescript/lib/lib.dom.d.ts` — one of TypeScript's own lib files, whichever copy the project has. */
const TYPESCRIPT_LIB = /[\\/]typescript[\\/]lib[\\/]lib\.[^\\/]+\.d\.ts$/;

function isAssignment(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function isInside(node: ts.Node, fn: ts.Node): boolean {
  for (let at: ts.Node | undefined = node; at !== undefined; at = at.parent) if (at === fn) return true;
  return false;
}

/** A `const`, or a parameter — a name nothing can point somewhere else. */
function isConst(declaration: ts.Node): boolean {
  if (ts.isParameter(declaration) || ts.isBindingElement(declaration)) return true;
  if (!ts.isVariableDeclaration(declaration)) return false;
  return (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0;
}

function isImportOfAFunction(declaration: ts.Node): boolean {
  return ts.isImportSpecifier(declaration) || ts.isImportClause(declaration) || ts.isNamespaceImport(declaration);
}

/** Whether an identifier is READ here — not a property name, a declaration's own name or a label. */
function isRead(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (
    (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent)) &&
    parent.name === node
  )
    return false;
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) return false;
  if (ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) return false;
  return true;
}

/**
 * The function a declaration stands for: a function or a method, a `const` holding an arrow, or a
 * `const` holding what a factory returned — `const max20 = maxLength(20)`, the function `maxLength`
 * returns. `undefined` when it is none of those.
 */
export function functionOf(declaration: ts.Node, resolve: Resolver): FunctionBody | undefined {
  return reach(declaration, resolve)?.fn;
}

/**
 * The function a declaration stands for, and — when a factory made it from a call whose every
 * argument is fixed — that factory, whose parameters the function may then read as fixed.
 */
export interface Reached {
  fn: FunctionBody;
  fixedFactory?: ts.Node;
}

export function reach(declaration: ts.Node, resolve: Resolver): Reached | undefined {
  if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) return { fn: declaration };
  if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
    const value = unwrap(declaration.initializer);
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return { fn: value };
    if (ts.isCallExpression(value) && isConst(declaration)) return returnedBy(value, resolve);
  }
  return undefined;
}

/**
 * A value nothing can change: a literal — string, number, `true`, `null`, a regular expression —
 * `Object.freeze` of an array or object of fixed values, or a `const` holding one. A `Set`, a `Map` or a
 * plain object held in a `const` is not: whatever else holds it may change it. Nor is a function: what
 * it does is a question of its own, asked by following it — see `whyImpure`.
 */
export function isFixed(expression: ts.Expression, resolve: Resolver, depth = 0): boolean {
  if (depth > 8) return false;
  const value = unwrap(expression);
  if (
    ts.isStringLiteralLike(value) ||
    ts.isNumericLiteral(value) ||
    ts.isBigIntLiteral(value) ||
    // A `/g` or `/y` expression is state: `test` and `exec` move its `lastIndex`, call after call.
    (ts.isRegularExpressionLiteral(value) && !/\/[a-z]*[gy][a-z]*$/.test(value.text)) ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    value.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isPrefixUnaryExpression(value)) return ts.isNumericLiteral(unwrap(value.operand));
  if (ts.isIdentifier(value)) {
    if (value.text === "undefined" || value.text === "NaN" || value.text === "Infinity") return true;
    const declared = resolve(value)?.declarations?.[0];
    if (declared === undefined) return false;
    return (
      ts.isVariableDeclaration(declared) &&
      isConst(declared) &&
      declared.initializer !== undefined &&
      isFixed(declared.initializer, resolve, depth + 1)
    );
  }
  if (ts.isCallExpression(value) && value.arguments.length === 1) {
    const callee = unwrap(value.expression);
    const frozen =
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "freeze" &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "Object" &&
      fromThePlatform(resolve(callee.expression)?.declarations?.[0]);
    if (!frozen) return false;
    const held = unwrap(value.arguments[0]);
    if (ts.isArrayLiteralExpression(held)) return held.elements.every((e) => isFixed(e, resolve, depth + 1));
    if (ts.isObjectLiteralExpression(held)) {
      return held.properties.every((p) => ts.isPropertyAssignment(p) && isFixed(p.initializer, resolve, depth + 1));
    }
  }
  return false;
}

/** The one function a factory call returns, read off the factory's own `return`. */
function returnedBy(call: ts.CallExpression, resolve: Resolver): Reached | undefined {
  const callee = unwrap(call.expression);
  if (!ts.isIdentifier(callee)) return undefined;
  const declared = resolve(callee)?.declarations?.[0];
  const factory = declared === undefined ? undefined : functionOf(declared, resolve);
  if (factory === undefined || factory.body === undefined) return undefined;
  const fixed = call.arguments.every((argument) => isFixed(argument, resolve));
  const made = (fn: FunctionBody | undefined): Reached | undefined =>
    fn === undefined ? undefined : { fn, fixedFactory: fixed ? factory : undefined };
  if (!ts.isBlock(factory.body)) {
    const value = unwrap(factory.body);
    return made(ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? value : undefined);
  }
  let returned: FunctionBody | undefined;
  let count = 0;
  const look = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node !== factory) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      count++;
      const value = unwrap(node.expression);
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) returned = value;
    }
    ts.forEachChild(node, look);
  };
  ts.forEachChild(factory.body, look);
  return made(count === 1 ? returned : undefined);
}
