import { nearest } from "./compiler/rules";
import type { CssAngleUnit, CssDimension, CssLengthUnit, CssResolutionUnit, CssTimeUnit } from "./units.generated";
import type { CssColorKeyword } from "./values.generated";

/**
 * The variables a project DECLARES — their names, their kinds, and the fallback each one carries.
 *
 * Not to be confused with `compiler/variables.ts`, which asks a different question about the same
 * subject: what one BLOCK sets and reads. That one is about a block's own text; this one is about
 * what the project says exists before any block is written.
 *
 * ## What a declaration is, and why it is these three things
 *
 * `DESIGN.md` settles the shape, and each part earns its place:
 *
 * - **A name**, so `$.color.primary.main` can be written instead of `var(--color-primary-main)` and
 *   completed one level at a time. Measured: a nested object offers 6 names, then 5, then 4, where a
 *   flat union of the same scale offers 88 at every position.
 * - **A fallback**, because that is what makes the type TRUE. A `var()` with no fallback can resolve
 *   to nothing, and then the declaration is not merely missing — it is invalid at computed-value
 *   time and the property falls back to its initial value. Measured in Chrome:
 *   `width: var(--unset)` laid the element out at 720px, with nothing reported anywhere.
 * - **A kind**, which is written rather than read off the value. Reading it was tried and refused,
 *   and the one-line reason is that `"0"` is a length or a number and the value cannot say which.
 *
 * ## Why the kind is written once per GROUP
 *
 * Writing it beside every variable is ceremony nobody keeps up, and a config nobody keeps up is a
 * config that drifts. So {@link kind} wraps a group and reaches every leaf under it, and a subgroup
 * may declare its own.
 *
 * It then pays for itself three times over: it narrows the FALLBACK as it is typed, it is the TYPE
 * at the use site, and it is the `syntax` of the `@property` rule codegen emits — which is a
 * guarantee no type can give, because it holds for a value that arrives at runtime from a server.
 */

/**
 * The kinds, and the `@property` syntax each one registers as.
 *
 * **These are CSS's own component names rather than a vocabulary of ours**, which is the whole
 * reason the `@property` half costs nothing: the kind IS the `syntax` descriptor, so there is no
 * mapping to keep in step and no kind that cannot be registered.
 */
export const SYNTAX = {
  angle: "<angle>",
  any: "*",
  color: "<color>",
  "custom-ident": "<custom-ident>",
  image: "<image>",
  integer: "<integer>",
  length: "<length>",
  "length-percentage": "<length-percentage>",
  number: "<number>",
  percentage: "<percentage>",
  resolution: "<resolution>",
  time: "<time>",
  "transform-function": "<transform-function>",
  "transform-list": "<transform-list>",
  url: "<url>",
} as const;

/** What a variable may be declared as. */
export type Kind = keyof typeof SYNTAX;

/** The kinds, as a list, for the message a wrong one gets. */
export const KINDS = Object.keys(SYNTAX) as readonly Kind[];

/**
 * What each kind accepts as a FALLBACK.
 *
 * Every one of these admits a call — `calc()`, `clamp()`, `var()`, `light-dark()` — because nothing
 * in a type can read inside one and refusing calls would make the narrowing useless in the place
 * people reach for it. `CssDimension` already carries that admission; the others say it themselves.
 *
 * **`integer` is not expressible and says so here rather than pretending.** Neither `number` nor
 * `` `${number}` `` refuses `1.5`, measured. What refuses it is the `@property` rule codegen writes,
 * in the browser — which is the clearest case in this design of the two guarantees being different
 * guarantees rather than one restated.
 */
export interface ValueByKind {
  angle: CssDimension<CssAngleUnit>;
  any: string | number;
  color: CssColorKeyword | `#${string}` | `${string}(${string})`;
  "custom-ident": string;
  image: `${string}(${string})`;
  integer: number | `${string}(${string})`;
  length: CssDimension<CssLengthUnit>;
  "length-percentage": CssDimension<CssLengthUnit | "%">;
  number: number | `${string}(${string})`;
  percentage: CssDimension<"%">;
  resolution: CssDimension<CssResolutionUnit>;
  time: CssDimension<CssTimeUnit>;
  "transform-function": `${string}(${string})`;
  "transform-list": string;
  url: `url(${string})`;
}

/**
 * The marker on a boxed leaf.
 *
 * A REGISTERED symbol, and deliberately: a monorepo can end up with two copies of this package
 * loaded at once, and a module-local symbol would make one copy's variables invisible to the other's
 * codegen — which fails by emitting nothing rather than by saying anything. `Symbol.for` makes the
 * two copies agree.
 *
 * A symbol rather than a `kind` field, because a group is the author's own object and may well hold
 * a variable named `kind` or `value`. Those are ordinary names for a design system to use.
 */
export const IS_VARIABLE: unique symbol = Symbol.for("ramonda.css.variable");

/** One declared variable: what it is, and what it falls back to. */
export interface Variable<K extends Kind = Kind, V = unknown> {
  readonly [IS_VARIABLE]: true;
  readonly kind: K;
  readonly value: V;
}

/** Whether a leaf has been declared, asked without depending on how the marker is spelled. */
export function isVariable(one: unknown): one is Variable {
  return typeof one === "object" && one !== null && (one as Partial<Variable>)[IS_VARIABLE] === true;
}

/** Any group, before its leaves are judged — the shape `T` is inferred from. */
type Group = { readonly [name: string]: unknown };

/**
 * The same group with every bare leaf REPLACED by what the kind accepts, which is the constraint.
 *
 * **A mapped type rather than a recursive union, and that is not a preference.** The first version
 * constrained the argument to `V | Variable | { [name: string]: Written<V> }`, and `tsc` refused it
 * outright — `TS2590: Expression produces a union type that is too complex to represent` — as soon
 * as a group held a nested `kind( … )`. Of course it did: `V` for a length is 49 units times
 * `${number}`, and a recursive union multiplies that by every level.
 *
 * Mapped, the work is one check per leaf and the error lands ON the leaf, which is also the better
 * message: `Type '"30px"' is not assignable to type … ` beside `main`, rather than a paragraph about
 * the shape of the whole group.
 */
type Leaves<K extends Kind, T> = {
  readonly [N in keyof T]: T[N] extends Variable
    ? T[N]
    : T[N] extends string | number
      ? ValueByKind[K]
      : Leaves<K, T[N]>;
};

/**
 * The same shape with every bare value boxed, and a nested group keeping the kind it declared.
 *
 * The literal types survive because {@link kind} takes `const` type parameters — which is what makes
 * a variable's own value reach the use site, so a property narrowed to a scale can refuse one by
 * naming the offending VALUE rather than the variable.
 */
export type Declared<K extends Kind, T> = {
  readonly [N in keyof T]: T[N] extends Variable<infer VK, infer VV>
    ? Variable<VK, VV>
    : T[N] extends string | number
      ? Variable<K, T[N]>
      : Declared<K, T[N]>;
};

/** Where a bad leaf was, spelled the way the author wrote it, so a message can point at it. */
function pathOf(trail: readonly string[]): string {
  return trail.join(".");
}

function refuse(message: string): never {
  throw new Error(`[ramonda-css] ${message}`);
}

/**
 * Declares a kind for a whole group of variables.
 *
 * ```ts
 * variables: {
 *   color: kind("color", { primary: { main: "#3b82f6" } }),
 *   size: kind("length", { control: { md: "30px" }, weight: kind("number", { bold: 700 }) }),
 * }
 * ```
 *
 * The group is copied rather than written into: a config is an ordinary object a project may also
 * read for its own purposes, and a function that quietly replaced its strings with marker objects
 * would be a surprise nobody asked for.
 *
 * **Write the group in the call.** A group lifted out to a `const` first loses its literal types to
 * ordinary widening — `const c = { main: "#3b82f6" }` is `{ main: string }` before this function
 * ever sees it, and a `string` is not a colour. That is TypeScript's own behaviour rather than
 * something here, and `as const` on the lifted object restores it.
 */
export function kind<const K extends Kind, const T extends Group>(of: K, group: T & Leaves<K, T>): Declared<K, T> {
  if (!Object.hasOwn(SYNTAX, of)) {
    const meant = nearest(String(of), KINDS as readonly string[]);
    refuse(
      `\`kind(${JSON.stringify(of)}, …)\` — CSS does not register that.` +
        `${meant === undefined ? "" : ` Did you mean \`${meant}\`?`}` +
        `\n\n        The kinds are CSS's own: ${KINDS.join(", ")}.`,
    );
  }

  const box = (one: unknown, trail: readonly string[]): unknown => {
    if (isVariable(one)) return one;
    if (typeof one === "string" || typeof one === "number") {
      return { [IS_VARIABLE]: true, kind: of, value: one } satisfies Variable<K, typeof one>;
    }
    if (typeof one !== "object" || one === null || Array.isArray(one)) {
      refuse(
        `\`${pathOf(trail)}\` is ${one === null ? "null" : Array.isArray(one) ? "a list" : typeof one}, ` +
          `which is neither a value nor a group.` +
          `\n\n        A variable's fallback is a string or a number, and anything else here is a group of them.`,
      );
    }
    const copy: Record<string, unknown> = {};
    for (const [name, next] of Object.entries(one)) copy[name] = box(next, [...trail, name]);
    return copy;
  };

  return box(group, []) as Declared<K, T>;
}
