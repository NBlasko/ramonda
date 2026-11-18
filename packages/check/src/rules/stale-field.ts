import ts from "typescript";
import { isStatic, memberName, writesUnder } from "../syntax";
import { hasDecorator, heritage } from "./render-reach";
import type { Resolver } from "./rule";

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

/**
 * The fields a cached reader may read without ever going stale.
 *
 * Everything reactive, plus the two shapes that are read in a compute constantly and are not data:
 * a hook instance, which has its own reactivity, and a function, which is `arrow-fields`' subject.
 */
export function trackedOrHarmless(member: ts.PropertyDeclaration, resolve: Resolver): boolean {
  if (hasDecorator(member, "state", resolve) || hasDecorator(member, "compute", resolve)) return true;

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

/** One write to a field or variable that can come after the first render: who makes it, and where it runs. */
export interface FieldWrite {
  writer: string;
  /** The function (or instance field initializer) holding it — a class made inside that function is made by it. */
  fn: ts.Node;
}

/**
 * The function (or instance field initializer) a write runs in — or `undefined` for one that is over
 * before any instance exists, while the module is first evaluated. A static block or static field runs
 * where its class is evaluated, so its place is whatever holds the class: the module, or a factory that
 * runs later. An instance field's initializer runs once per instance, so it counts. Any function holding a
 * write is a later place — one invoked on the spot as well, which errs on the side of reporting. Whether
 * the function holding it MAKES the class reading it (a class declared in a factory) is the reader's
 * question, asked in `madeTooEarly`.
 */
export function runsIn(node: ts.Node): ts.Node | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    // A static block or static field runs when its class is evaluated — at the module's top level, or
    // each time a factory around the class runs — so the place is whatever holds the class.
    if (ts.isClassStaticBlockDeclaration(at) || (ts.isPropertyDeclaration(at) && isStatic(at))) continue;
    if (ts.isPropertyDeclaration(at)) return at;
    if (ts.isFunctionLike(at)) return at;
  }
  return undefined;
}

/**
 * The writes to this class's ordinary fields that can come after the first render, by field — the
 * judgement both cached-reader rules ask, with where each write runs. A static member's `this` is the
 * class, and a nested `function`'s is its own: neither writes an instance field. A `function` HELD in a
 * field is the exception, called through the owner (`this.onDone()`) — unless its `this` is declared
 * as another type, `function (this: HTMLInputElement)`, which says whose it is.
 */
/**
 * Whether a `function`'s `this` is the instance: it declares none, or declares one naming the class or a
 * base (`this: Cart`, `this: Cart | void`). A `this` declared as another type is that type's.
 */
function thisIsTheInstance(
  fn: ts.FunctionExpression,
  declaring: readonly ts.ClassLikeDeclaration[],
  resolve: Resolver,
): boolean {
  const declared = fn.parameters.find((one) => ts.isIdentifier(one.name) && one.name.text === "this")?.type;
  if (declared === undefined) return true;
  const named = ts.isUnionTypeNode(declared) ? declared.types : [declared];
  return named.some(
    (one) =>
      ts.isTypeReferenceNode(one) &&
      (resolve(one.typeName)?.declarations ?? []).some((declaration) => declaring.some((cls) => cls === declaration)),
  );
}

export function fieldWrites(
  declaring: readonly ts.ClassLikeDeclaration[],
  resolve: Resolver,
): Map<string, FieldWrite[]> {
  const plain = new Set<string>();
  for (const one of declaring) {
    for (const member of one.members) {
      if (!ts.isPropertyDeclaration(member) || isStatic(member) || trackedOrHarmless(member, resolve)) continue;
      const name = memberName(member);
      if (name !== undefined) plain.add(name);
    }
  }
  const writes = new Map<string, FieldWrite[]>();
  if (plain.size === 0) return writes;
  for (const one of declaring) {
    for (const member of one.members) {
      if (isStatic(member) || ts.isClassStaticBlockDeclaration(member)) continue;
      if (!writesAfterTheFirstRender(member, resolve)) continue;
      const writer = memberName(member) ?? "a method";
      // A field holding a `function` writes the instance when it is called through the owner,
      // `this.onDone()`, so its body is read as the member's own — not skipped for having a `this` of its own.
      const value = ts.isPropertyDeclaration(member) ? member.initializer : undefined;
      const root =
        value !== undefined && ts.isFunctionExpression(value) && thisIsTheInstance(value, declaring, resolve)
          ? value
          : member;
      writesUnder(root, true, (target) => {
        if (
          !ts.isPropertyAccessExpression(target) ||
          target.expression.kind !== ts.SyntaxKind.ThisKeyword ||
          !plain.has(target.name.text)
        )
          return;
        const field = target.name.text;
        const fn = runsIn(target);
        // An instance field's initializer writes this instance before its first render — the constructor's
        // time, which `writesAfterTheFirstRender` does not count either.
        if (fn === undefined || ts.isPropertyDeclaration(fn)) return;
        const list = writes.get(field) ?? [];
        list.push({ writer, fn });
        writes.set(field, list);
      });
    }
  }
  return writes;
}

/**
 * Whether a write inside this member can leave a cached reader stale.
 *
 * `false` for everything that runs before the first render — the constructor, `@created` — and for
 * the renders themselves, where a write is the memo pattern rather than a change. `@destroyed` runs
 * after the last render, so nothing is left to be stale.
 */
export function writesAfterTheFirstRender(member: ts.ClassElement, resolve: Resolver): boolean {
  if (ts.isConstructorDeclaration(member)) return false;
  if (hasDecorator(member, "created", resolve) || hasDecorator(member, "destroyed", resolve)) return false;
  if (hasDecorator(member, "compute", resolve)) return false;
  return memberName(member) !== "render";
}

/**
 * A GETTER over a plain field is not found by `row-reads-a-plain-field`, and that is the honest limit of
 * that rule.
 *
 * `private raw = "x"; get label() { return this.raw }` — a row that shows `this.label` is as stale as one
 * that shows `this.raw`, and the row rule goes quiet: only a `PropertyDeclaration` becomes a candidate
 * below, and a getter is not one. `cached-read-of-a-plain-field` follows the getter instead — reading it
 * runs it — and judges the fields it reads.
 */

/**
 * The answer: field name → the member that writes it after the first render.
 *
 * Empty when nothing can be stale, which is the common case and the cheap exit for both callers.
 *
 * ## The BASES are asked too, and both halves have to ask
 *
 * A component's fields are the component's wherever they are declared, so a plain field on a shared
 * base — written by a method here and read by a `@compute` here — goes stale in exactly the same
 * way. Reading one class body made the whole fault invisible, and it had to be fixed in BOTH halves
 * to be fixed at all: knowing an inherited field is plain says nothing without knowing what writes
 * it, and the other way round.
 *
 * Upward only. A class cannot know who extends it, so a `@compute` on a base reading a field its
 * subclass writes stays out of reach — and out of the claim.
 *
 * Both rules ask it through `resolve`, so both see the fields a class inherits as well as its own.
 */
export function staleFieldsOf(cls: ts.ClassDeclaration, resolve: Resolver): Map<string, string> {
  const writtenBy = new Map<string, string>();
  for (const [field, writes] of fieldWrites([cls, ...heritage(cls, resolve)], resolve)) {
    if (writes.length > 0) writtenBy.set(field, writes[0].writer);
  }
  return writtenBy;
}
