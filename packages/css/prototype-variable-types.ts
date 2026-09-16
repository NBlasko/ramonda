/**
 * The variable types, measured before any are written. Type-checked, never run.
 *
 *     npx tsc --noEmit --strict --target ES2022 packages/css/prototype-variable-types.ts
 *
 * `DESIGN.md` settles that a variable is declared as a NAME, a KIND and a FALLBACK. The fallback is
 * what makes the type true, since a `var()` without one can resolve to nothing and a type promising
 * a colour would then have lied.
 *
 * The kind is WRITTEN, not read off the value. Reading it was tried and refused: a value cannot say
 * whether `"0"` is a length or a number, and a wrong guess is worse than a question. But writing it
 * per variable is ceremony nobody would keep up, so it is written once per GROUP and holds all the
 * way down, with a subgroup free to override it.
 *
 * What this file proves, one measurement per line below:
 *
 *   - a kind declared once reaches every variable under it, and a nested group may override
 *   - the kind narrows the FALLBACK while it is being typed, so the defaults are checked
 *   - a narrowed property refuses a variable by naming the offending VALUE, not the variable
 *
 * Measured cost: 5,133 instantiations against 4,776 for an empty program; 0.39s either way.
 *
 * FOUR errors are expected, each marked `FAULT`. Fewer means something stopped being checked; more
 * means something this file claims works does not.
 */
type LengthUnit = "px" | "rem" | "em" | "vh" | "vw" | "ch";

/** What each kind accepts as a fallback. One place; the config and the value slots both read it. */
interface ValueByKind {
  color: `#${string}` | `rgb(${string})` | `oklch(${string})`;
  length: `${number}${LengthUnit}` | "0";
  duration: `${number}ms` | `${number}s`;
  number: number;
  "font-family": string;
}
type Kind = keyof ValueByKind;

declare const VAR: unique symbol;
/** A declared variable: its kind, and the fallback it carries. */
interface Var<K extends Kind, V> {
  readonly [VAR]: readonly [K, V];
}
type AnyVar = Var<Kind, unknown>;

/** What may be written under a `kind(…)`: a value of that kind, a nested group, or another group. */
type Written<V> = V | AnyVar | { readonly [name: string]: Written<V> };

/** The same tree with every bare value boxed as a variable of `K`. A nested group keeps its own. */
type Box<K extends Kind, T> = {
  readonly [N in keyof T]: T[N] extends AnyVar ? T[N] : T[N] extends string | number ? Var<K, T[N]> : Box<K, T[N]>;
};

/**
 * Declares a kind for a whole group, once.
 *
 * The kind is written rather than read off the value — a value cannot say whether `"0"` is a length
 * or a number, and guessing is worse than asking. Writing it per variable was the thing nobody would
 * do, so it is written per GROUP and holds all the way down. It also narrows what may be written
 * below, so the fallbacks are checked while they are typed.
 */
declare function kind<const K extends Kind, const T extends Written<ValueByKind[K]>>(of: K, group: T): Box<K, T>;

/* ── the config a person writes ─────────────────────────────────────────────────────────── */

const variables = {
  color: kind("color", {
    primary: { main: "#3b82f6", light: "#93c5fd" },
    surface: { base: "#ffffff", sunken: "#f3f4f6" },
    text: { primary: "#111827" },
  }),
  size: kind("length", {
    control: { sm: "24px", md: "30px" },
    radius: { pill: "999px" },
    // a group may override the kind for its own subtree
    weight: kind("number", { bold: 700 }),
  }),
  motion: kind("duration", { fast: "120ms", slow: "400ms" }),
};

/* ── what it produced, asserted rather than described ───────────────────────────────────── */

const a: Var<"color", "#3b82f6"> = variables.color.primary.main;
const b: Var<"length", "30px"> = variables.size.control.md;
const c: Var<"number", 700> = variables.size.weight.bold; // the nested override
const d: Var<"duration", "120ms"> = variables.motion.fast;
void a;
void b;
void c;
void d;

/* ── faults, each one expected ──────────────────────────────────────────────────────────── */

const wrong = kind("color", { primary: { main: "30px" } }); // FAULT: not a colour
const alsoWrong = kind("length", { control: { md: "#3b82f6" } }); // FAULT: not a length
void wrong;
void alsoWrong;

/** A narrowed property still refuses a variable by naming the value, not the variable. */
type PaddingScale = "4px" | "8px" | "16px" | "24px";
declare function __padding(v: PaddingScale | Var<"length", PaddingScale>): string;
__padding(variables.size.control.sm); // ok — 24px is in the scale
__padding(variables.size.control.md); // FAULT: 30px is not
__padding(variables.color.primary.main); // FAULT: a colour
