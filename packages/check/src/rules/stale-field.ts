import ts from "typescript";
import { hasDecorator } from "./render-reach";

/**
 * Which of a class's fields a CACHED reader can go stale on — the judgement two rules ask.
 *
 * A cached reader is one that does not run again just because a render happened: a `@compute`, a
 * hook's props callback, and a `list()` row callback whose reference is stable. Each caches on the
 * signals it read, and an ordinary field is not one, so a write to it invalidates nothing.
 *
 * The rules that ask are `cached-read-of-a-plain-field` and `row-reads-a-plain-field`. They are two
 * rules because the readers are found in different places and the fixes differ — a row can be made
 * inline, a `@compute` cannot — but the FIELDS are one question, with one set of exemptions, and
 * every one of those exemptions is a case where reporting would be wrong rather than merely noisy.
 * Two copies of it drifted within a day of each other: the second copy exempted only `@created`, so
 * it reported the constructor, the memo pattern and `@destroyed`, and it wrongly treated `@persist`
 * as reactive — which is a MISS, since `@persist` is carried across hydration without being tracked.
 * This module is that copy being deleted.
 */

/** A member's own name, when it has a plain one to go by. */
export function nameOf(member: ts.ClassElement): string | undefined {
  return member.name !== undefined && ts.isIdentifier(member.name) ? member.name.text : undefined;
}

/**
 * The fields a cached reader may read without ever going stale.
 *
 * Everything reactive, plus the two shapes that are read in a compute constantly and are not data:
 * a hook instance, which has its own reactivity, and a function, which is `arrow-fields`' subject.
 */
export function trackedOrHarmless(member: ts.PropertyDeclaration): boolean {
  if (hasDecorator(member, "state") || hasDecorator(member, "compute")) return true;

  const written = member.initializer;
  if (written === undefined) return false;
  if (ts.isArrowFunction(written) || ts.isFunctionExpression(written)) return true;

  // `x = this.use(Thing)` — a hook, which carries its own reactivity.
  return (
    ts.isCallExpression(written) &&
    ts.isPropertyAccessExpression(written.expression) &&
    written.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
    written.expression.name.getText() === "use"
  );
}

/** Every `this.X` WRITTEN anywhere under a node — `=`, `+=`, `++` alike. */
export function fieldsWrittenIn(node: ts.Node): Set<string> {
  const found = new Set<string>();

  const note = (target: ts.Expression): void => {
    if (
      ts.isPropertyAccessExpression(target) &&
      target.expression.kind === ts.SyntaxKind.ThisKeyword &&
      ts.isIdentifier(target.name)
    ) {
      found.add(target.name.text);
    }
  };

  const walk = (at: ts.Node): void => {
    if (
      ts.isBinaryExpression(at) &&
      at.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      at.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      note(at.left);
    }
    if (
      (ts.isPostfixUnaryExpression(at) || ts.isPrefixUnaryExpression(at)) &&
      (at.operator === ts.SyntaxKind.PlusPlusToken || at.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      note(at.operand);
    }
    ts.forEachChild(at, walk);
  };

  walk(node);
  return found;
}

/**
 * Whether a write inside this member can leave a cached reader stale.
 *
 * `false` for everything that runs before the first render — the constructor, `@created` — and for
 * the renders themselves, where a write is the memo pattern rather than a change. `@destroyed` runs
 * after the last render, so nothing is left to be stale.
 */
export function writesAfterTheFirstRender(member: ts.ClassElement): boolean {
  if (ts.isConstructorDeclaration(member)) return false;
  if (hasDecorator(member, "created") || hasDecorator(member, "destroyed")) return false;
  if (hasDecorator(member, "compute")) return false;
  return nameOf(member) !== "render";
}

/**
 * The answer: field name → the member that writes it after the first render.
 *
 * Empty when nothing can be stale, which is the common case and the cheap exit for both callers.
 */
export function staleFieldsOf(cls: ts.ClassDeclaration): Map<string, string> {
  const plain = new Set<string>();
  for (const member of cls.members) {
    if (!ts.isPropertyDeclaration(member)) continue;
    if (trackedOrHarmless(member)) continue;
    const name = nameOf(member);
    if (name !== undefined) plain.add(name);
  }

  const writtenBy = new Map<string, string>();
  if (plain.size === 0) return writtenBy;

  for (const member of cls.members) {
    if (!writesAfterTheFirstRender(member)) continue;
    const where = nameOf(member) ?? "a method";
    for (const field of fieldsWrittenIn(member)) {
      if (plain.has(field) && !writtenBy.has(field)) writtenBy.set(field, where);
    }
  }
  return writtenBy;
}
