import ts from "typescript";
import { positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { isNothing, openingOf } from "./element";
import { unwrap } from "./follow-value";
import { implementationOf, reach, whyImpure, type Reached } from "./pure-function";
import type { ElementContext, ElementRule } from "./rule";
import { fieldKind, modelNames } from "./formTable";

export interface TransformThatIsNotPureIssue {
  component: "Select" | "TextArea" | "input";
  /**
   * `impure` — the function reads or changes something besides its parameters and constants;
   * `unreadable` — its body cannot be read: a prop, a package's declaration, a value this cannot name;
   * `built-in-render` — made by a call in the markup, which runs on every render and is not the
   *   transform this can read: whatever the factory does, it does each render;
   * `uncontrolled` — the field has no `value` (`checked`), so there is no model for it to decide against.
   */
  kind: "impure" | "unreadable" | "built-in-render" | "uncontrolled";
  /** Why, for `impure`; what was written, otherwise. */
  detail: string;
  file: string;
  line: number;
  column: number;
}

/** The function a `transform` attribute names, or why there is none this can read. */
function transformOf(
  value: ts.Expression | undefined,
  resolve: ElementContext["resolve"],
): Reached | "unreadable" | "built-in-render" {
  if (value === undefined) return "unreadable";
  const written = unwrap(value);
  if (ts.isArrowFunction(written) || ts.isFunctionExpression(written)) return { fn: written };
  if (ts.isCallExpression(written)) return "built-in-render";
  const name = ts.isPropertyAccessExpression(written) ? written.name : ts.isIdentifier(written) ? written : undefined;
  if (name === undefined) return "unreadable";
  const declared = implementationOf(resolve(name));
  const reached = declared === undefined ? undefined : reach(declared, resolve);
  if (reached === undefined) return "unreadable";
  const fn = reached.fn;
  if (fn.body === undefined || fn.getSourceFile().isDeclarationFile) return "unreadable";
  return reached;
}

/**
 * A field's `transform` that is not a pure function this can read.
 *
 * `transform(next, prev, input)` decides an edit before any handler reads it, and it is the one place
 * a field's value is refused or rewritten — so what it returns has to depend on what it is given and
 * on constants, and it has to change nothing. That is provable from source, and this proves it: the
 * function is read, and so is every function it calls that is written in the project, wherever it is
 * imported from — `transform={phoneMask}` from `./masks`, or `max20` made once by `maxLength(20)`.
 *
 * Reported: a function that reads `this`, the page (`document`, `fetch`, the clock, chance), a `let`,
 * or a `const` holding anything but a fixed value — a literal, a regular expression, `Object.freeze`
 * of fixed values; a `Set`, a `Map` or a plain object may be changed by whatever else holds it — or a
 * factory's parameter when the call that made it handed something else; a function it calls or hands
 * on that is not pure, wherever it is declared; one that writes anything it did not make, or waits;
 * one that calls a function whose body
 * cannot be read; a `transform` whose own body cannot be read — handed down as a prop, or from a
 * package's declarations; one made by a call in the markup, whose factory runs on every render; and one on a
 * field with no `value`, which has no model to decide against.
 */
export const transformThatIsNotPure = {
  id: "transform-that-is-not-pure",

  report: {
    severity: "error",
    reportedWhen:
      "a field's `transform` reads or changes anything besides its parameters and constants, cannot be read, " +
      "is made by a call in the markup, or sits on a field with no `value`",
    heading: (found) => `${found.length} transform(s) that are not a pure function this can read:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component} transform> ${
        {
          impure: `is not pure: ${issue.detail}.`,
          unreadable: `is \`${issue.detail}\`, whose body cannot be read.`,
          "built-in-render": `is \`${issue.detail}\`, a call that runs its factory on every render — make it once, at the top of a module.`,
          uncontrolled:
            "is on a field with no model — no `value`, or one no one edits — so there is nothing for it to decide.",
        }[issue.kind]
      }`,
    ],
    advice:
      "A transform depends on what it is given, and changes nothing:\n\n" +
      "```tsx\n" +
      "onlyDigits(next: string, prev: string): string {\n" +
      "  return /^\\d*$/.test(next) ? next : prev;\n" +
      "}\n\n" +
      '<input aria-label="Phone" value={this.phone} oninput={this.typed} transform={this.onlyDigits} />\n' +
      "```\n\n" +
      "One made by a factory is made ONCE, at the top of a module — `export const max20 = maxLength(20)` —\n" +
      "and named in the markup.\n\n",
  },

  read(element, { resolve, attributes, attr }) {
    const opening = openingOf(element);
    const core = coreElementTag(opening.tagName, resolve);
    const host = ts.isIdentifier(opening.tagName) && opening.tagName.text === "input" ? "input" : undefined;
    const tag = core ?? host;
    if (tag !== "select" && tag !== "textarea" && tag !== "input") return [];
    const transform = attributes.find((attribute) => attribute.name === "transform");
    if (transform === undefined) return [];
    const component = tag === "select" ? "Select" : tag === "textarea" ? "TextArea" : "input";
    const at = positionOf(transform.at);

    // What its `type` makes it — see `fieldKind`. A file, a hidden value, a button holds no model, and
    // core runs no transform on it; one whose type cannot be read has either model.
    const typeAttribute = openingOf(element).attributes.properties.find(
      (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "type",
    );
    const kind = tag === "input" ? fieldKind(typeAttribute, attr("type")) : "text";
    const names = modelNames(kind);
    const model = attributes.find(
      (attribute) => names.includes(attribute.name) && !(attribute.value !== undefined && isNothing(attribute.value)),
    );
    if (model === undefined) return [{ component, kind: "uncontrolled", detail: "", ...at }];

    const reached = transformOf(transform.value, resolve);
    const written = transform.value?.getText() ?? "transform";
    if (reached === "unreadable" || reached === "built-in-render") {
      return [{ component, kind: reached, detail: written, ...at }];
    }
    const impurity = whyImpure(reached.fn, resolve, 0, new Set(), reached.fixedFactory);
    return impurity === undefined ? [] : [{ component, kind: "impure", detail: impurity.why, ...at }];
  },
} as const satisfies ElementRule<TransformThatIsNotPureIssue>;
