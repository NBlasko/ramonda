import ts from "typescript";
import { positionOf } from "../syntax";
import type { Rule } from "./rule";

/**
 * A class field holding a function literal.
 *
 * Ramonda binds every method to its instance, so `onPick = (id) => this.select(id)` buys exactly
 * nothing over `onPick(id) { this.select(id) }` — and costs one closure per instance, which for a
 * list of a thousand rows is a thousand closures.
 *
 * The check is syntactic on purpose. At runtime the two are indistinguishable: by the time anything
 * could look, `bindInstanceMethods` has already written a bound function onto the instance under
 * every method's name, and a field holding `debounce(this.save, 200)` is a function there too — and
 * that one is legitimate, because a wrapper cannot be expressed as a method. Only the source can
 * tell a function LITERAL from a call that returns one.
 */
export interface ArrowFieldIssue {
  /** The class the field is on. */
  component: string;
  field: string;
  file: string;
  line: number;
  column: number;
  /** Whether the body mentions `this` — which decides whether it becomes a method or leaves the class. */
  readsThis: boolean;
}

/**
 * Function literals held in fields, on a class this analyzer already calls a component.
 *
 * Deliberately narrow: an arrow or a `function` written IN the field. A field initialised from a
 * call — `debounce(this.save, 200)`, `memoize(fn)` — is left alone, because a wrapper has nowhere
 * else to live and the value is a function only after the call has run.
 */
export const arrowFields = {
  id: "arrow-fields",

  report: {
    severity: "error",
    heading: (found) => `${found.length} class field(s) holding a function literal:`,
    lines: (field) => [
      `  ${field.file}:${field.line}:${field.column}`,
      `    ${field.component}.${field.field} — ` +
        (field.readsThis
          ? "write it as a method. Ramonda binds every method to its instance, so it keeps `this`\n" +
            "    when it is passed to an element, and one function is shared by every instance."
          : "it does not read `this`, so move it out of the class — a module constant is built once\n" +
            "    rather than once per instance."),
      "",
    ],
    advice:
      "A field initialised from a CALL is a different thing and is not reported: `debounce(this.save, 200)`\n" +
      "has nowhere else to live. This is about a function written in the field itself.",
  },

  read(cls, { self }) {
    const found: ArrowFieldIssue[] = [];

    for (const member of cls.members) {
      if (!ts.isPropertyDeclaration(member) || !member.initializer) continue;
      // `static` is not an instance member: it exists once per class, so there is no closure per
      // instance to save and nothing for method binding to have done. A static arrow is a plain
      // constant that happens to be callable.
      if (member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) continue;
      const value = member.initializer;
      if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) continue;

      let readsThis = false;
      const look = (n: ts.Node): void => {
        if (n.kind === ts.SyntaxKind.ThisKeyword) readsThis = true;
        // A nested class or a `function` re-binds `this`, so what is inside one says nothing
        // about whether THIS field needs the instance.
        if (ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isFunctionDeclaration(n)) return;
        if (!readsThis) ts.forEachChild(n, look);
      };
      ts.forEachChild(value, look);

      found.push({
        component: self.name,
        field: member.name.getText(),
        ...positionOf(member.name),
        readsThis,
      });
    }

    return found;
  },
} as const satisfies Rule<ArrowFieldIssue>;
