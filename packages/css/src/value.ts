import type { Fixed, Kind, Token, ValueByKind } from "./token";
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

/**
 * A variable to set, and what to set it to — one pair, with the value checked against its KIND.
 *
 * A union of per-kind pairs rather than one loose pair, which is what does the checking: a
 * `[Token<"color">, "30px"]` matches no member, because the colour member wants a colour and every
 * other member wants a different token.
 */
export type Setting = { [K in Kind]: readonly [Token<K>, ValueByKind[K]] }[Kind];

/**
 * The same pairs, with each value checked against what ITS OWN variable may be.
 *
 * `Setting` alone binds the kind and leaves the value to the kind's whole type, so any colour went
 * into any colour variable. A variable that declared a range means to take only those values — that
 * is what a range IS — and this is where setting one at run time is held to it.
 *
 * Written as an intersection over the tuple rather than inside `Setting`, because a union member
 * cannot `infer` from its own position: the pair has to be inferred first and checked second.
 */
type Permitted<P> = {
  readonly [I in keyof P]: P[I] extends readonly [Token<infer K, infer R>, infer V]
    ? [V] extends [R]
      ? P[I]
      : readonly [Token<K, R>, Refused<R>]
    : never;
};

/**
 * Why a value was refused, written as a TYPE NAME because that is the only channel a type has.
 *
 * It reads oddly in the source and it is deliberate. TypeScript prints a type's name verbatim and
 * prints nothing else it is given, so a sentence in the name is a sentence the author reads:
 *
 *     Type '"24px"' is not assignable to type
 *       '"24px" & this_variable_may_only_be<"8px" | "16px">'
 *
 * **Measured, this was `not assignable to type 'never'` — twice, on one line.** `Permitted` used to
 * intersect the author's pair with the permitted pair, and an intersection of two different literals
 * is `never`, so the range check worked and could not be read. It named neither the variable, nor
 * the values it may take, nor what to do.
 *
 * Reported by the user asking what `Token<"length", "16px">` shows, since an initial value is not a
 * range. It IS the range — a bare declaration means the variable never changes — and the design was
 * right while the message was unreadable. See {@link Fixed}.
 */
interface this_variable_may_only_be<R> {
  readonly permitted: R;
}

interface this_variable_was_declared_with_one_value_give_it_a_range_to_set_it_at_run_time {
  readonly declare: 'kind(…, { gutter: { value: "16px", range: "any" } })';
}

/** Which sentence this refusal gets: the variable never changes, or the value is outside its range. */
type Refused<R> = [R] extends [Fixed<unknown>]
  ? this_variable_was_declared_with_one_value_give_it_a_range_to_set_it_at_run_time
  : this_variable_may_only_be<R>;

/** `var(--name)` — what codegen writes for a variable, and the only shape this has to read. */
const NAMED = /^var\((--[^),\s]+)\)$/;

function nameOf(token: string): `--${string}` {
  const found = NAMED.exec(token);
  if (found === null) {
    throw new Error(`[ramonda-css] \`${token}\` is not a variable this package wrote.`);
  }
  return found[1] as `--${string}`;
}

/**
 * Declared variables and their values, as the custom properties an element carries.
 *
 * ```tsx
 * <div style={toStyle([[$.color.primary.main, tenant.primary]])}>…</div>
 * ```
 *
 * **This is not a theming mechanism and is not trying to be.** A theme may be a media query, an
 * attribute on `<html>`, a tenant's values from a server or something this package will never see;
 * whichever it is belongs to the project. What is owed here is that the value a project computes is
 * checked against the kind the variable was declared as, and lands under the right name.
 *
 * The cost is the one every custom property on an element has — bytes on that element, and a render
 * when it changes — and this is the right place to pay it: once per theme, rather than once per use,
 * which is what `$` inside a block avoids entirely.
 */
export function toStyle<const P extends readonly Setting[]>(settings: P & Permitted<P>): Record<`--${string}`, string> {
  const style: Record<string, string> = {};
  for (const [token, value] of settings as readonly Setting[]) style[nameOf(token)] = String(value);
  return style;
}

/**
 * What a declared variable resolves to on an element, right now.
 *
 * Rare, and it happens — a chart that needs the accent colour as a value, a measurement that needs a
 * size. The value comes back COMPUTED rather than as written: measured in Chrome, a registered
 * variable set to `#10b981` reads as `rgb(16, 185, 129)` and `2rem` reads as `32px`. That is usually
 * what a reader wants, and it means this cannot promise the literal that was declared.
 *
 * **An empty string means the generated stylesheet is not loaded.** It cannot mean "unset": every
 * declared variable is registered with `@property { initial-value }`, and measured, a registered
 * variable resolves even when nothing anywhere sets it. So the empty case is a setup fault, and
 * inventing a value here would hide it.
 */
export function read(token: Token, from: Element): string {
  return getComputedStyle(from).getPropertyValue(nameOf(token)).trim();
}
