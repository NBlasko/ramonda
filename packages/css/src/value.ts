import type { HoleValues, StyleBlock, StyleValue, StyleVarValue } from "./types";

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
 */
export function toStyleObject(value: StyleValue): { className: string; style: Record<string, string> } {
  const style: Record<string, string> = {};
  for (let index = 0; index < value.properties.length; index++) {
    const raw = value.values[index];
    // A custom property holds text. A number reaching here is a property that takes one — the
    // per-property types are what refuse the ones that do not.
    if (raw !== undefined) style[value.properties[index]] = typeof raw === "string" ? raw : String(raw);
  }
  return { className: value.className, style };
}
