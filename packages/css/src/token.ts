/**
 * What a declared variable IS, as a value — and a module that imports nothing, which is the point.
 *
 * `properties.generated.ts` names this type on ninety-six properties, and that file is read by the
 * VIRTUAL program: a `tsc` run with `types: []` over somebody else's source. Taking the type from
 * `declared.ts` put a chain behind it — `declared` to `compiler/rules` to `config` to `node:fs` —
 * and measured, that broke eighty-seven checks with `TS2307: Cannot find module 'node:fs'` in a
 * file the author never wrote. A types-only leaf cannot do that to anybody.
 */

/**
 * The kinds a variable may be declared as, and they are CSS's own `@property` syntax names.
 *
 * The spellings live here and the SYNTAX each one registers as lives in `declared.ts`, typed
 * `Record<Kind, string>` — so a kind added here and forgotten there does not compile, and neither
 * does the reverse. One list, kept in step by the type system rather than by care.
 */
export type Kind =
  | "angle"
  | "any"
  | "color"
  | "custom-ident"
  | "image"
  | "integer"
  | "length"
  | "length-percentage"
  | "number"
  | "percentage"
  | "resolution"
  | "time"
  | "transform-function"
  | "transform-list"
  | "url";

declare const TOKEN: unique symbol;

/**
 * A declared variable as a value — `$.color.primary.main`, once codegen has written it.
 *
 * A branded `string`, and each half is load-bearing. A string, because its runtime value is
 * `var(--color-primary-main)` and that has to work everywhere a CSS value goes: in a block, in a
 * hole, in a plain `style={{ … }}`. Branded, because the kind and the fallback have to survive into
 * the type, or a property narrowed to lengths could not refuse a colour.
 *
 * The brand is REQUIRED rather than optional, which is the difference between a type that can refuse
 * something and one that cannot: an ordinary string is not a `Token`.
 *
 * It is a phantom — nothing reads `[TOKEN]` at runtime, and nothing is there to read.
 */
export type Token<K extends Kind = Kind, V = unknown> = string & {
  readonly [TOKEN]: readonly [K, V];
};
