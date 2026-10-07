/**
 * The `style` attribute's half of two block rules: a token set against its declaration, and a custom
 * property made up where the project switched that off.
 *
 * A typed rule — see `index.ts` for what separates these from the rules in `rules/`.
 */
import { type Config } from "../../config/config";
import { type TypedFinding } from "./index";
import {
  againstDeclaration,
  declaredByName,
  localNames,
  plainValue,
  readsIn,
  refusedAsUnknown,
  settingsIn,
  unknownMessage,
} from "../declaredSet";
import ts from "typescript";

/**
 * A custom property made up in a `style` attribute, in a project that switched that off — the
 * attribute's half of `unknown-custom-property`; the block's is in `rules/`. A key that sets one
 * (`"--brand": …`), and a `var(--brand)` in a value — in an object, or in a `style` string. What it
 * cannot see is the same as the other attribute check's: a computed key, an object built elsewhere.
 */
export function styleMakesOneUp(
  file: ts.SourceFile,
  config: Config,
  reportAt: (start: number, length: number, what: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  const literalText = (node: ts.Node): string | undefined =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;

  /** One attribute is one "block" for `"same-block"`: what it sets, what it reads, and where. */
  const judge = (sets: { name: string; at: number }[], reads: { name: string; at: number; length: number }[]): void => {
    const local = localNames(
      sets.map((one) => one.name),
      reads.map((one) => one.name),
    );
    for (const one of sets) {
      if (refusedAsUnknown(config, one.name, local)) {
        reportAt(one.at, one.name.length, {
          rule: "unknown-custom-property",
          message: unknownMessage(one.name, config, "set"),
        });
      }
    }
    for (const one of reads) {
      if (refusedAsUnknown(config, one.name, local)) {
        reportAt(one.at, one.length, {
          rule: "unknown-custom-property",
          message: unknownMessage(one.name, config, "read"),
        });
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === "style" && node.initializer !== undefined) {
      const value = node.initializer;
      const inner = ts.isJsxExpression(value) ? value.expression : value;
      if (inner !== undefined && ts.isObjectLiteralExpression(inner)) {
        const sets: { name: string; at: number }[] = [];
        const reads: { name: string; at: number; length: number }[] = [];
        for (const property of inner.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const key = literalText(property.name);
          if (key?.startsWith("--")) sets.push({ name: key, at: property.name.getStart(file) + 1 });
          const text = literalText(property.initializer);
          if (text === undefined) continue;
          const start = property.initializer.getStart(file) + 1;
          for (const read of readsIn(text)) reads.push({ ...read, at: start + read.at });
        }
        judge(sets, reads);
      } else if (inner !== undefined) {
        const text = literalText(inner);
        if (text !== undefined) {
          const start = inner.getStart(file) + 1;
          judge(
            settingsIn(text).map((one) => ({ name: one.name, at: start + one.at })),
            readsIn(text).map((one) => ({ ...one, at: start + one.at })),
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

/**
 * A `style` attribute setting a declared variable its declaration does not allow.
 *
 * Without it, `style={{ "--color-surface-sunken": "red" }}` and the string spelling
 * `style="--color-surface-sunken: red"` both pass, while `toStyle` refuses the same setting — the
 * one door meant for it would be the only one closed. The judgement is `declaredSet.ts`'s, shared
 * with a block and a stylesheet. A value this cannot read (a variable, a call) still refuses a
 * FIXED variable, since nothing may set one; a ranged one is then left alone. What it cannot see at
 * all: a computed key, an object built elsewhere, and `el.style.setProperty`.
 */
export function styleSetsADeclared(
  file: ts.SourceFile,
  config: Config,
  reportAt: (start: number, length: number, what: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  const declared = declaredByName(config);
  if (declared.size === 0) return;

  const literal = (node: ts.Expression): string | undefined =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      ? plainValue(node.text)
      : ts.isNumericLiteral(node)
        ? node.text
        : undefined;
  /** Every value an expression may put there — both arms of a ternary, or the one value. */
  const outcomes = (node: ts.Expression): (string | undefined)[] => {
    const inner = ts.isParenthesizedExpression(node) ? node.expression : node;
    return ts.isConditionalExpression(inner)
      ? [...outcomes(inner.whenTrue), ...outcomes(inner.whenFalse)]
      : [literal(inner)];
  };
  const judge = (name: string, values: (string | undefined)[], start: number): void => {
    const one = declared.get(name);
    if (one === undefined) return;
    const message = againstDeclaration(one, values);
    if (message !== undefined) reportAt(start, name.length, { rule: "token-set-against-its-declaration", message });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === "style" && node.initializer !== undefined) {
      const value = node.initializer;
      if (ts.isStringLiteral(value)) {
        // The text starts one character in, after the quote.
        for (const setting of settingsIn(value.text)) {
          judge(setting.name, [plainValue(setting.value)], value.getStart(file) + 1 + setting.at);
        }
      } else if (ts.isJsxExpression(value) && value.expression !== undefined) {
        const inner = value.expression;
        if (ts.isObjectLiteralExpression(inner)) {
          for (const property of inner.properties) {
            if (!ts.isPropertyAssignment(property)) continue;
            const key = property.name;
            if (!ts.isStringLiteral(key) && !ts.isNoSubstitutionTemplateLiteral(key)) continue;
            judge(key.text, outcomes(property.initializer), key.getStart(file) + 1);
          }
        } else if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
          for (const setting of settingsIn(inner.text)) {
            judge(setting.name, [plainValue(setting.value)], inner.getStart(file) + 1 + setting.at);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}
