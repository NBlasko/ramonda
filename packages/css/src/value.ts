import type { HoleValues, StyleBlock, StyleValue, StyleVarValue } from "./types";

/**
 * What may be read as a value: one that has been CALLED, or a descriptor with nothing to call it
 * with.
 *
 * The difference is a pair of parentheses, and a descriptor carries the same three fields, so
 * nothing about the shape tells them apart — but one of them is a function, and `apply` is what
 * every function has. Declaring it `never` makes a descriptor unassignable.
 *
 * **A block with NO holes is the exception, and it had to be**: there is nothing to pass it, so the
 * descriptor IS the value and `css={_s0}` is how it is written everywhere. `StyleBlock<readonly []>`
 * lets exactly that one through — a descriptor that takes an argument has a call signature the empty
 * one does not, so it stays refused, which is the case the framework reports as `RMD062`.
 */
export type CalledStyleValue = (StyleValue & { readonly apply?: never }) | StyleBlock<readonly []>;

/** Shared by every block with no holes, so the empty case allocates nothing at all. */
const NONE: readonly string[] = Object.freeze([]);

/**
 * The compiled form of one style block. **Emitted by the compiler; there is no reason to call it.**
 *
 * ```
 * const _s0 = block("r-8e271c6c1f3a4b02", ["--r-8e271c6c1f3a4b02-0"]);
 * <div css={_s0(isOnline ? "4px solid #10b981" : "4px solid #64748b")}>
 * ```
 *
 * The expression is an ARGUMENT. Nothing is concatenated, nothing becomes attribute text, and so
 * nothing has to be escaped — a value carrying a quote or a closing brace is applied with
 * `setProperty`, which takes it verbatim.
 */
export function block<const P extends readonly string[]>(className: string, properties?: P): StyleBlock<P> {
  const names = properties ?? (NONE as unknown as P);

  const descriptor = (...values: HoleValues<P>): StyleValue => ({
    className,
    properties: names,
    values: values as readonly StyleVarValue[],
  });

  descriptor.className = className;
  descriptor.properties = names as readonly string[];
  /**
   * A descriptor is a value with no values, which is what the no-hole case needs and what makes the
   * misuse readable: a block with two property names and no values is `css={_s0}` where `_s0(…)` was
   * meant. The runtime diagnostic that reports it comes later — the shape it reads exists now.
   */
  descriptor.values = NONE as readonly StyleVarValue[];

  return Object.freeze(descriptor) as StyleBlock<P>;
}

/**
 * A compiled value as `{ className, style }`, for a renderer that has no `css` prop of its own.
 *
 * This is the whole adapter surface. A wrapper on another JSX library spreads the result and gets
 * the same output Ramonda produces natively, which is what makes the package usable outside it.
 *
 * **A descriptor is refused by the type**, and that is the one thing this can do about the fault the
 * framework reports as `RMD062`: `toStyleObject(_s0)` where `_s0(…)` was meant used to type-check —
 * a descriptor structurally IS a value — and returned the class with no custom properties at all,
 * so every declaration reading one fell back, in silence. This package ships to a browser and
 * imports nothing, so it has no diagnostics to report it with; the type is what it has.
 */
export function toStyleObject(value: CalledStyleValue): { className: string; style: Record<string, string> } {
  const style: Record<string, string> = {};
  for (let index = 0; index < value.properties.length; index++) {
    const raw = value.values[index];
    /**
     * No value is not the empty value — the property is left unset, so the declaration reading it
     * falls back to whatever the stylesheet said. Writing the text `"null"` instead would substitute
     * something the property cannot parse, which is invalid at computed-value time and drops the
     * declaration **and any earlier one for the same property**. This answered that differently from
     * the framework's own path until it was measured; they answer it the same way now.
     */
    if (raw === undefined || raw === null) continue;
    const text = textFor(raw);
    if (text !== undefined) style[value.properties[index]] = text;
  }
  return { className: value.className, style };
}

/**
 * The text one hole's value is written as, or `undefined` for a value that is not written at all.
 *
 * ## The semicolon
 *
 * A hole's value is whatever the author's expression evaluated to, and an expression can read a
 * record — so "the author wrote it" is not a defence. `setProperty` refuses to create a second
 * declaration whatever it is handed, but this object does not reach `setProperty`: a renderer
 * spreads it, and a server-rendered page is serialized to HTML and PARSED back, where the grammar
 * applies to whatever text the serializer produced.
 *
 * Measured through exactly that round trip in the framework's own suite: the same value came back as
 * `position: fixed; width: 100vw; z-index: 9999`, real and applied. A semicolon is what separates
 * declarations, and CSS says a custom property's value may not contain one at the top level.
 * Refusing every semicolon rather than only the top-level ones costs a value like `content: "a;b"`
 * and buys a rule that needs no CSS parser to apply.
 *
 * ## The kind
 *
 * A custom property holds text, so `String(value)` produces something for anything — and the kinds a
 * hole is given by mistake all produce text no property can parse: `true`, `[object Object]`,
 * `() => 1`, `NaN`. Written, they leave the declaration to fall back in silence. `StyleVarValue` is
 * a string or a number, so nothing else arrives from checked source; this function is the adapter
 * surface, which is precisely where unchecked JavaScript arrives.
 *
 * The framework's own path asked the string question BEFORE the value became text, which let an
 * object with a `toString` through — the semicolon rule is about text, so both paths ask it of the
 * text now, and both refuse the same kinds. This package has no diagnostics to report it with; the
 * declaration is dropped rather than sanitised, so the element is left unstyled in that one respect:
 * a missing border beats an overlay somebody's record asked for.
 */
function textFor(value: StyleVarValue): string | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value !== "string") return undefined;
  return value.includes(";") ? undefined : value;
}
