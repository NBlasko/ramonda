import ts from "typescript";
import { callbackOwner, hookNamed, isHandedOver, isLocalRead, isThisUse, memberName, positionOf } from "../syntax";
import { hasDecorator } from "./render-reach";
import type { Rule } from "./rule";

/**
 * A hook's props callback reading a field declared BELOW it.
 *
 * `this.use(Hook, callback)` calls the callback at once, while the class's fields are being set top
 * to bottom — so a field declared lower down is not there yet. Measured, both ways it goes wrong:
 *
 * - a HOOK below (`self.browser.ready`, with `browser = this.use(InBrowser)` under it) is a bare
 *   `TypeError: Cannot read properties of undefined` at mount, which names neither the field nor the
 *   order;
 * - a PLAIN field below reads `undefined` and does not throw. A plain field is not a signal, so the
 *   callback is never asked again, and the hook keeps `undefined` for the life of the component.
 *
 * Found by an agent building an app from the docs alone: fields are written in the order you think of
 * them. TypeScript reports a field read before its initialisation only when the read is in another
 * initialiser, not inside a function, and the callback is a function.
 *
 * ## What is not reported
 *
 * A field declared above; a method or a getter, which live on the prototype and are there from the
 * start; a base class's field, set before this class's; and a read inside a function HANDED OVER in
 * the bag (`run: () => self.late`), which runs later, when everything is set — see `isHandedOver`.
 *
 * A call to a method that itself reads a later field is not followed. That is the next shape to plant
 * if it turns up.
 */
export interface FieldReadBeforeItIsDeclaredIssue {
  /** The class. */
  component: string;
  /** The field holding the `use` whose callback reads too early. */
  member: string;
  /** The hook, as written. */
  hook: string;
  /** The field it reads, declared below. */
  field: string;
  /** The line the field is declared on, so the report can say where to move the `use`. */
  declaredAt: number;
  file: string;
  line: number;
  column: number;
}

export const fieldReadBeforeItIsDeclared = {
  id: "field-read-before-it-is-declared",

  report: {
    severity: "error",
    reportedWhen:
      "a hook's props callback reads a field declared below the `use`, which is not set yet when the callback first runs — a bare TypeError at mount for a hook, `undefined` for good for a plain field",
    heading: (found) => `${found.length} props callback(s) reading a field declared below them:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> \`${issue.member}\` hands ${issue.hook} a callback that reads \`${issue.field}\`, declared below it on line ${issue.declaredAt} — not set yet when the callback runs.`,
    ],
    advice:
      "`this.use` calls the props callback at once, while the fields are being set from the top down.\n" +
      "A field declared lower down is not there yet: a hook there throws a TypeError at mount that\n" +
      "names nothing, and a plain field reads `undefined` — for good, since it is not a signal and the\n" +
      "callback is not asked again. Move the field above the `use` that reads it: declare hooks in the\n" +
      "order they depend on each other.\n\n",
  },

  read(cls, { self, resolve }) {
    const found: FieldReadBeforeItIsDeclaredIssue[] = [];
    const members = [...cls.members];

    for (const [index, member] of members.entries()) {
      if (!ts.isPropertyDeclaration(member) || member.initializer === undefined) continue;
      const call = member.initializer;
      if (!ts.isCallExpression(call) || !isThisUse(call)) continue;
      const callback = call.arguments[1];
      if (callback === undefined || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) continue;

      /** The fields declared below this one — the ones not set yet when the callback runs. */
      const later = new Map<string, ts.PropertyDeclaration>();
      for (const after of members.slice(index + 1)) {
        if (!ts.isPropertyDeclaration(after)) continue;
        if (after.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)) continue;
        // A `declare` field, and one with no initialiser, emit no assignment here: the first narrows a
        // base's field, set before this class's; the second is `undefined` wherever it is declared.
        // Found by review — `declare props: Props` below a `use` was reported as a crash.
        if (after.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)) continue;
        // Except `@state`, which makes even an uninitialised field a signal at its own line, below the
        // callback — found by the second review. Any decorator is not that: `@persist` alone defines
        // nothing, so its field is `undefined` wherever it is declared — found by the third.
        if (after.initializer === undefined && !hasDecorator(after, "state", resolve)) continue;
        const name = memberName(after);
        if (name !== undefined && !later.has(name)) later.set(name, after);
      }
      if (later.size === 0) continue;

      const owner = callbackOwner(callback);
      const reported = new Set<string>();
      const parameter = callback.parameters[0]?.name;
      const say = (field: string, at: ts.Node) => {
        const declared = later.get(field);
        if (declared === undefined || reported.has(field)) return;
        reported.add(field);
        found.push({
          component: self.name,
          member: memberName(member) ?? "?",
          hook: hookNamed(call.arguments[0]).getText(),
          field,
          declaredAt: positionOf(declared).line,
          ...positionOf(at),
        });
      };

      // A destructured parameter reads each member when the callback is CALLED — whatever happens to
      // the local afterwards, a function handed over in the bag included, which keeps the `undefined`
      // it was given. Found by review: a destructure used only inside such a function was missed.
      if (parameter !== undefined && ts.isObjectBindingPattern(parameter)) {
        for (const element of parameter.elements) {
          if (element.dotDotDotToken !== undefined) continue;
          const member = element.propertyName ?? element.name;
          if (ts.isIdentifier(member)) say(member.text, element);
        }
      }

      // A rest copy, `{ ...all }`, was taken at the call: what is read off it is read too early,
      // wherever the read is — a handed-over function included. One walk, over the whole callback.
      (function rest(node: ts.Node): void {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.name) &&
          owner.isRest(node.expression, resolve)
        ) {
          say(node.name.text, node);
        }
        ts.forEachChild(node, rest);
      })(callback);

      (function look(node: ts.Node): void {
        if (node !== callback && isHandedOver(node)) return;
        if (ts.isPropertyAccessExpression(node) && owner.is(node.expression) && ts.isIdentifier(node.name)) {
          say(node.name.text, node);
        }
        if (ts.isIdentifier(node) && owner.destructured.has(node.text) && isLocalRead(node)) {
          say(owner.destructured.get(node.text) as string, node);
        }
        ts.forEachChild(node, look);
      })(callback);
    }

    return found;
  },
} as const satisfies Rule<FieldReadBeforeItIsDeclaredIssue>;
