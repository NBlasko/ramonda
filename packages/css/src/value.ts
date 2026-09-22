import type { CssVar, Fixed, Kind, Token, ValueByKind } from "./token";

/**
 * SETTING a declared variable or a registered property on an element.
 *
 * What used to be here went with the hole. `block()` built a descriptor a call filled with a hole's
 * values; `toStyleObject` turned one into `{ className, style }` for a renderer with no `css` prop
 * of its own. A block sets nothing on an element any more and IS its class string, so a renderer
 * writes `className={panel}` and there is nothing to adapt.
 */

/**
 * A variable to set, and what to set it to — one pair, with the value checked against its KIND.
 *
 * A union of per-kind pairs rather than one loose pair, which is what does the checking: a
 * `[Token<"color">, "30px"]` matches no member, because the colour member wants a colour and every
 * other member wants a different token.
 */
export type Setting =
  | { [K in Kind]: readonly [Token<K>, ValueByKind[K]] }[Kind]
  /**
   * A REGISTERED property — `@@property( syntax: "<angle>"; … )` — beside a declared variable.
   *
   * Both are a name and a value whose kind was decided when it was declared, so both belong to one
   * function. What differs is only where the name came from, which is not a question a caller asks.
   */
  | { [K in Kind]: readonly [CssVar<K>, ValueByKind[K]] }[Kind];

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
    : /**
       * A registered property has no RANGE — it has a `syntax`, which is the kind — so the check is
       * the kind's own type and there is nothing narrower to hold it to.
       */
      P[I] extends readonly [CssVar<infer K>, infer V]
      ? [V] extends [ValueByKind[K]]
        ? P[I]
        : readonly [CssVar<K>, ValueByKind[K]]
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
  /**
   * A REGISTERED property is already the name. `@@property( … )` binds `--r-…` itself, where a
   * declared variable binds `var(--…)` — codegen writes the value a block reads, and a block reads
   * a variable through `var()`. Two spellings, one question, so both are answered here rather than
   * at every call site.
   */
  if (token.startsWith("--")) return token as `--${string}`;

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
/**
 * **The CONSTRAINT is what refuses**, and that is why a wrong value is reported against `never`
 * rather than against the type it should have been. Measured: widening it so `Permitted` could name
 * the expected pair lost the refusal entirely — a pair whose value does not fit its own name stopped
 * being an error at all. The message is the price of the check working.
 */
export function toStyle<const P extends readonly Setting[]>(settings: P & Permitted<P>): Record<`--${string}`, string> {
  const style: Record<string, string> = {};
  for (const [token, value] of settings as readonly Setting[]) {
    const text = textFor(value);
    if (text !== undefined) style[nameOf(token)] = text;
  }
  return style;
}

/**
 * The text one value is written as, or nothing at all for a value that may not be written.
 *
 * ## The semicolon
 *
 * A value is whatever the caller's expression evaluated to, and an expression can read a record — so
 * "the author wrote it" is not a defence. This object ends up in a `style` attribute, and **a server
 * render does not end at the DOM**: the element is serialized to HTML and the browser PARSES the
 * attribute back, applying the CSS grammar to whatever text the serializer produced. Measured
 * through `renderToString` and back through `innerHTML`, a value of
 * `red; position: fixed; width: 100vw` came out as real, applied declarations — a full-viewport
 * overlay out of a colour that came from a database.
 *
 * So a value carrying a `;` is not written, and the property is left UNSET rather than written as
 * something else: an unset custom property makes the declaration reading it invalid at
 * computed-value time, which drops that declaration and leaves whatever the stylesheet said. A
 * missing border beats an overlay.
 *
 * **This is where the rule lives now.** It used to be `toStyleObject`'s and the framework's, for the
 * values a `{expr}` hole carried; the hole is refused and `toStyleObject` is gone, and `toStyle` is
 * how a value reaches an element. The hazard moved with it.
 *
 * ## The kinds
 *
 * A non-finite number is `NaN` or an infinity, which no property can parse. Anything that is not a
 * string or a number cannot arrive through the types, so it came from JavaScript nobody checked.
 */
function textFor(value: unknown): string | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value !== "string") return undefined;
  return value.includes(";") ? undefined : value;
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
