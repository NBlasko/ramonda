import { nameFor } from "./compiler/dollar";
import { ARITY, KEYWORDS, PRIMITIVE, SHORTHANDS } from "./compiler/keywords.generated";
import type { PropertyRules } from "./config";
import { SYNTAX, type Kind, isVariable } from "./declared";

/**
 * What a project's declared variables become: a stylesheet, and a module to write them with.
 *
 * ## Two outputs from one declaration, which is the point
 *
 * `DESIGN.md` settles that the config is the SOURCE and the CSS is output — a project does not write
 * `:root` at all. That is what makes the fallback one value used twice rather than a second copy of
 * a number kept in step by hand: the same declaration becomes the rule that sets the variable and
 * the fallback every use carries.
 *
 * - **The stylesheet** sets each variable and registers it with `@property`, so a wrong value that
 *   arrives at runtime — from a server, from somebody's own CSS — is refused by the browser. Types
 *   cannot reach that, and it is free here because the kind is already written.
 * - **The module** is `$`, the object a block and ordinary TypeScript both reach a variable through.
 *
 * ## What is NOT here
 *
 * Themes. A variable may be set by a media query, an ancestor, a tenant's values from a server, or
 * code this never sees, and modelling any of that was tried and dropped — the reasons are in
 * `DESIGN.md`. The names are readable precisely so overriding is ordinary CSS.
 */

/** One variable, once its path is known. */
export interface Named {
  /** The path it was declared at, `color.primary.main`, for a message that points at the config. */
  readonly path: string;
  /** The custom property, `--color-primary-main`. */
  readonly name: `--${string}`;
  readonly kind: Kind;
  readonly value: string | number;
}

/** A group of declared variables, as the config holds them. */
export type Declarations = { readonly [name: string]: unknown };

function refuse(message: string): never {
  throw new Error(`[ramonda-css] ${message}`);
}

/**
 * Every declared variable, flattened, in the order the config declares them.
 *
 * **Declaration order rather than sorted**, because the stylesheet is something people read: a
 * palette written together stays together. Nothing depends on the order — these are distinct names
 * on one element, so no two of them can be in the cascade's way.
 */
export function namesIn(declarations: Declarations): readonly Named[] {
  const found: Named[] = [];

  const walk = (group: Declarations, trail: readonly string[]): void => {
    for (const [segment, one] of Object.entries(group)) {
      const here = [...trail, segment];

      if (isVariable(one)) {
        found.push({
          path: here.join("."),
          name: nameFor(here.join(".")),
          kind: one.kind,
          value: one.value as string | number,
        });
        continue;
      }

      if (typeof one === "object" && one !== null) {
        walk(one as Declarations, here);
      }
    }
  };

  walk(declarations, []);
  return found;
}

/**
 * Two paths spelling one custom property, which the config cannot see happening.
 *
 * `{ "a-b": { c } }` and `{ a: { "b-c" } }` both reach `--a-b-c`, because the separator between
 * levels is a character a name may also hold. Left alone the second would overwrite the first in the
 * stylesheet, and `$` would offer two paths to one variable with nothing said anywhere.
 *
 * **Separate from {@link namesIn} on purpose.** The CHECKER asks that function what a project
 * declares, once per block, and a collision is not a per-block fault — it is one fault about the
 * config, and it belongs to whoever writes the files. So the walk answers and this decides.
 */
export function verifyNames(named: readonly Named[]): void {
  const claimed = new Map<string, string>();

  for (const one of named) {
    const already = claimed.get(one.name);
    if (already !== undefined) {
      refuse(
        `two variables spell one custom property.\n\n` +
          `        \`${already}\` and \`${one.path}\` both become \`${one.name}\`.\n\n` +
          `        A level is joined to the next with a dash, and a name may hold one too, so\n` +
          `        two paths can meet. Rename either.`,
      );
    }
    claimed.set(one.name, one.path);
  }
}

/**
 * The `@property` rule for one variable, or nothing when registering would say nothing.
 *
 * **`inherits: true`, and that is not a preference.** An unregistered custom property inherits, so
 * a registration saying `false` would quietly change how every existing use behaves — a variable set
 * on `:root` would stop reaching the elements reading it. The registration exists to add a guarantee,
 * not to alter the cascade.
 *
 * **`any` is registered too, and my first reason for skipping it was wrong.** `*` accepts every token
 * sequence, so the rule refuses nothing — that much was right. But refusing is not the only thing a
 * registration does: `initial-value` is what makes the name resolve when NOTHING sets it, and
 * measured, `syntax: "*"` with an initial value does exactly that. Two different guarantees, and I
 * had collapsed them into one.
 *
 *     `*` WITH initial-value, never set      reads "anything at all"
 *     `*` without initial-value, never set   reads ""
 *
 * ## What registering changes besides refusing, measured in Chrome
 *
 * A registered variable's COMPUTED value is normalised, where an unregistered one reads back
 * verbatim:
 *
 *     registered   `--x: #10b981`   reads  "rgb(16, 185, 129)"
 *     unregistered `--x: #10b981`   reads  "#10b981"
 *     registered   `--x: 2rem`      reads  "32px"
 *
 * That is usually what a reader wants — a resolved value rather than a token — but it means `read`
 * cannot promise to hand back the literal that was written, and a length comes back absolutised
 * against the element it was read on. Worth knowing before it surprises somebody.
 *
 * And the refusal is real, including the case a type cannot express: `<integer>` given `1.5` falls
 * to its initial value, measured.
 */
function registration(one: Named): string {
  return (
    `@property ${one.name} {\n` +
    `  syntax: "${SYNTAX[one.kind]}";\n` +
    `  inherits: true;\n` +
    `  initial-value: ${one.value};\n` +
    `}`
  );
}

/** The TypeScript identifier-safe spelling of a path segment, for the emitted object. */
function key(segment: string): string {
  return JSON.stringify(segment);
}

/** The emitted module's shape, nested the way the config was written. */
function moduleTree(named: readonly Named[]): string {
  const root: Record<string, unknown> = {};

  for (const one of named) {
    const segments = one.path.split(".");
    let here = root;
    for (const segment of segments.slice(0, -1)) {
      here[segment] ??= {};
      here = here[segment] as Record<string, unknown>;
    }
    here[segments[segments.length - 1]] = one;
  }

  const write = (node: Record<string, unknown>, indent: string): string => {
    const lines = Object.entries(node).map(([segment, next]) => {
      if (next !== null && typeof next === "object" && "name" in (next as Named)) {
        const one = next as Named;
        const token = `Token<${JSON.stringify(one.kind)}, ${JSON.stringify(one.value)}>`;
        return `${indent}  ${key(segment)}: ${JSON.stringify(`var(${one.name})`)} as ${token},`;
      }
      return `${indent}  ${key(segment)}: {\n${write(next as Record<string, unknown>, `${indent}  `)}\n${indent}  },`;
    });
    return lines.join("\n");
  };

  return `{\n${write(root, "")}\n}`;
}

/** What one run of codegen produces. Empty strings when a project declares nothing. */
export interface Generated {
  /** `:root`, and one `@property` per variable that can be registered. */
  readonly css: string;
  /** The `$` module, in TypeScript, for the project's own compiler to read. */
  readonly module: string;
}

/**
 * A NAME for what one property accepts here, so a value made outside a block can be annotated.
 *
 * ```ts
 * const gap: Value<"padding-left"> = "8px";
 * <div css={@@( padding-left: {gap}; )}>…</div>
 * ```
 *
 * Ninety-six properties say what they take, so a value reaching one through a hole has to say what
 * it is — and assembling `CssDimension<CssLengthUnit | "%">` by hand to do it is both awkward and
 * wrong to ask, since the answer is already written down one place away.
 *
 * **It is emitted HERE rather than exported from the package, and that is the whole reason it
 * exists.** Today it points at the shipped type. When a project can narrow a property itself — an
 * arity, a unit list — that narrowing will be this module's own, and `Value<"padding-left">` will
 * mean the project's answer with no annotation anywhere needing to change. Writing
 * `CssProperties["padding-left"]` at each site would mean editing every one of them.
 */
/**
 * What each primitive becomes as a type here, and which declared-variable kinds its slot accepts.
 *
 * CSS says which primitive a property takes — that is `PRIMITIVE`, shipped. This is the other half,
 * and it lives with codegen because it is a decision of ours rather than a fact about CSS, and
 * because the config is what will narrow it further.
 *
 * **`integer` cannot refuse a fraction and is here anyway.** Measured, neither `number` nor
 * `` `${number}` `` refuses `1.5`; what it CAN do is accept a variable declared as an integer and
 * refuse one declared as a colour. The fraction stays the checker's sentence and the browser's
 * `@property` refuses it at run time.
 *
 * `length-percentage` accepts three kinds, because a length and a percentage are each one.
 */
const NARROW: Readonly<
  Record<string, { readonly value: string; readonly kinds: readonly Kind[]; readonly said: string }>
> = {
  angle: { value: "CssDimension<CssAngleUnit>", kinds: ["angle"], said: "an angle" },
  color: { value: "CssColor", kinds: ["color"], said: "a colour" },
  integer: {
    value: "number | `${number}` | `${string}(${string})`",
    kinds: ["integer", "number"],
    said: "a whole number",
  },
  length: { value: "CssDimension<CssLengthUnit>", kinds: ["length"], said: "a length" },
  "length-percentage": {
    value: 'CssDimension<CssLengthUnit | "%">',
    kinds: ["length", "length-percentage", "percentage"],
    said: "a length or a percentage",
  },
  number: { value: "number | `${number}` | `${string}(${string})`", kinds: ["number", "integer"], said: "a number" },
  percentage: { value: 'CssDimension<"%">', kinds: ["percentage"], said: "a percentage" },
  resolution: { value: "CssDimension<CssResolutionUnit>", kinds: ["resolution"], said: "a resolution" },
  time: { value: "CssDimension<CssTimeUnit>", kinds: ["time"], said: "a time" },
};

/** The colour keywords, so a colour property does not list all 192 of them beside `CssColor`. */
const COLOURS = new Set((KEYWORDS.color ?? "").split(" ").filter(Boolean));

/**
 * The property map this project's blocks are checked against.
 *
 * **`Omit` rather than writing all 828 out, and that was measured both ways.** Written out costs +5
 * instantiations against +2,400 for `Omit` — but a doc comment does not survive being written out by
 * something that does not have it, and `Omit` PASSES THE DOCUMENTATION THROUGH for every property it
 * does not touch. Measured: through `Omit`, an untouched property keeps its hover text and an
 * overridden one loses it. So 732 keep theirs, the 96 narrowed here are given a sentence saying what
 * they now take, and the cost is paid once per program.
 */
/**
 * One property's rule with every key readable, which the config's own type deliberately is not.
 *
 * `PropertyRule<P>` hides `shorthand` on a longhand and `arity` where there is no count, so a
 * person writing a config cannot spell a key that means nothing. Reading them back is the other
 * direction: here every key may or may not be there, and this is what says so once rather than at
 * each access.
 */
interface AnyRule {
  readonly shorthand?: boolean;
  readonly arity?: number;
  readonly units?: readonly string[];
  readonly values?: readonly (string | number)[];
}

/** What a project said about one property, with the wildcard already folded in. */
function ruleFor(rules: PropertyRules | undefined, property: string): AnyRule {
  const sweep = (rules?.["*"] ?? {}) as AnyRule;
  const own = (rules?.[property as keyof PropertyRules] ?? {}) as AnyRule;
  return { ...sweep, ...own };
}

/**
 * A dimension type carrying the project's units, or the shipped one when it said nothing.
 *
 * `units: ["px"]` turns `CssDimension<CssLengthUnit>` into `CssDimension<"px">` — the parameter is
 * already there for exactly this, which is why narrowing units costs nothing to express.
 */
function withUnits(value: string, units: readonly string[] | undefined): string {
  if (units === undefined || units.length === 0 || !value.startsWith("CssDimension<")) return value;
  return `CssDimension<${units.map((one) => JSON.stringify(one)).join(" | ")}>`;
}

interface Mapped {
  readonly rows: string;
  /** Shorthands this project switched off, dropped from the map rather than narrowed to nothing. */
  readonly removed: readonly string[];
  readonly uses: ReadonlySet<string>;
  /** Properties this project gave a closed list, so the completion table stops offering more. */
  readonly closed: readonly string[];
}

function propertyMap(rules: PropertyRules | undefined): Mapped {
  const rows: string[] = [];
  const removed: string[] = [];
  const closed: string[] = [];
  const uses = new Set<string>(["Narrowed", "Token"]);

  /**
   * A shorthand this project switched off, which is a REMOVAL rather than a narrowing.
   *
   * Left in the map as `never` it would say *Type '"8px"' is not assignable to type 'never'*, which
   * names nothing a person can act on. Dropped from the map it is *'padding' does not exist in
   * type* — the property is gone, which is what the project asked for and what the message says.
   * The same choice came up in the config's own type and the same answer won, measured both ways.
   */
  for (const property of Object.keys(SHORTHANDS)) {
    if (ruleFor(rules, property).shorthand === false) removed.push(property);
  }
  const gone = new Set(removed);

  /** A closed list is that list, whatever CSS would otherwise allow here. */
  for (const [property, rule] of Object.entries(rules ?? {})) {
    if (property === "*" || gone.has(property)) continue;
    const values = (rule as AnyRule).values;
    if (values === undefined) continue;

    closed.push(property);
    /**
     * A number is written as a number AND as the text it becomes, and the second is not a nicety.
     *
     * A block is CSS, so `z-index: 5` reaches the type as the string `"5"` — the virtual file emits
     * the declaration's value as written. A list of `[1, 2, 5, 10]` therefore refused every one of
     * its own permitted values, measured, which is refusing correct CSS: the one failure this
     * package may not have. A project writes the list the way it thinks about it and both spellings
     * are admitted.
     */
    const permitted = values.flatMap((one) =>
      typeof one === "number" ? [JSON.stringify(one), JSON.stringify(String(one))] : [JSON.stringify(one)],
    );

    rows.push(
      `  /** \`${property}\` — only the ${values.length} value(s) this project permits. */\n` +
        `  ${JSON.stringify(property)}: ${permitted.join(" | ")} | CssGlobal | \`var(\${string})\`;`,
    );
  }
  const said = new Set(closed);

  for (const [property, primitive] of Object.entries(PRIMITIVE)) {
    const narrow = NARROW[primitive];
    if (narrow === undefined || gone.has(property) || said.has(property)) continue;

    const value = withUnits(narrow.value, ruleFor(rules, property).units);

    /**
     * A property that takes SEVERAL values admits a multi-value string, and the shape is deliberate.
     *
     * Classifying `gap` and `padding` narrowed them to ONE value, so `padding: 8px 12px` — correct
     * CSS — was refused. Writing the repeat out as `` `${V} ${V}` `` was measured instead and cannot
     * ship: at 49 units by four positions TypeScript silently stops checking, accepting anything.
     *
     * `` `${string} ${string}` `` is what is left. It admits every multi-value value, and it still
     * refuses a TOKEN of the wrong kind — a branded string is not a two-word template — which is the
     * fault this was reported for: `gap: $.color.accent.main` compiled.
     *
     * **The honest loss:** `gap: 8px red` passes. Before any of this it was `string | number` and so
     * did everything else; the count is the `too-many-values` rule's and the words are
     * `unknown-value`'s. What the type buys here is the kind of a variable, which is what it was
     * asked for.
     */
    const several = (ARITY[property] ?? 1) > 1 ? " | `${string} ${string}`" : "";
    const words = (KEYWORDS[property] ?? "").split(" ").filter(Boolean);
    const keywords = value.includes("CssColor") ? words.filter((one) => !COLOURS.has(one)) : words;
    const head = keywords.length === 0 ? "never" : keywords.map((one) => JSON.stringify(one)).join(" | ");
    const kinds = narrow.kinds.map((one) => JSON.stringify(one)).join(" | ");

    for (const name of [
      "CssColor",
      "CssDimension",
      "CssAngleUnit",
      "CssLengthUnit",
      "CssResolutionUnit",
      "CssTimeUnit",
    ]) {
      if (value.includes(name)) uses.add(name);
    }

    rows.push(
      `  /** \`${property}\` — ${narrow.said}, and this project's variables of that kind. */\n` +
        `  ${JSON.stringify(property)}: Narrowed<${head}, ${value} | Token<${kinds}>${several}>;`,
    );
  }

  return { rows: rows.join("\n"), removed, uses, closed };
}

const HEADER = "/* Generated by @ramonda/css from ramonda.css.ts. Do not edit. */";

export function generate(declarations: Declarations, rules?: PropertyRules): Generated {
  const named = namesIn(declarations);
  verifyNames(named);

  /**
   * Nothing declared AND nothing narrowed is nothing to write.
   *
   * Either one on its own is enough, and the second case is real: a project may want strict
   * properties and no variables at all. Writing the module for the variables alone would have left
   * that project with a config it wrote and no types from it — silently, which is the shape of
   * fault this package keeps finding.
   */
  const constrained = Object.keys(rules ?? {}).length > 0;
  if (named.length === 0 && !constrained) return { css: "", module: "" };

  const root = named.map((one) => `  ${one.name}: ${one.value};`).join("\n");
  const registrations = named
    .map(registration)
    .filter((one) => one !== "")
    .join("\n\n");

  const css =
    named.length === 0 ? "" : `${HEADER}\n\n:root {\n${root}\n}\n${registrations === "" ? "" : `\n${registrations}\n`}`;

  /**
   * A TYPE-ONLY import, and that is the whole runtime cost of `$`: none.
   *
   * A variable's value is the string `var(--name)`, written here rather than made by a factory, so
   * importing `$` pulls in no code at all — the import is erased and what is left is an object of
   * strings. The kind and the fallback ride in the type, where the checking happens, and a reader
   * opening this file still sees both.
   */
  const { rows, removed, uses, closed } = propertyMap(rules);
  const fromPackage = [
    "CssColor",
    "CssDimension",
    "CssAngleUnit",
    "CssLengthUnit",
    "CssResolutionUnit",
    "CssTimeUnit",
    "Token",
  ]
    .filter((one) => uses.has(one))
    .join(", ");

  const module =
    `${HEADER}\n\n` +
    `import type { ${fromPackage} } from "@ramonda/css";\n` +
    `import type { ${closed.length === 0 ? "" : "CssGlobal, "}CssProperties as Base, CssValue, Narrowed } from "@ramonda/css/properties";\n\n` +
    `/** Every variable this project declares. Reach one by the path it was declared at. */\n` +
    `export const $ = ${named.length === 0 ? "{}" : moduleTree(named)} as const;\n\n` +
    `/** The ${rows === "" ? 0 : rows.split("\n").length / 2} properties this project narrows, and what each takes. */\n` +
    `interface Narrowings {\n${rows}\n}\n\n` +
    `/** What this project's blocks are checked against — the shipped map, with those replaced. */\n` +
    `export type CssProperties = Omit<Base, keyof Narrowings${removed.length === 0 ? "" : ` | ${removed.map((one) => JSON.stringify(one)).join(" | ")}`}> & Narrowings;\n\n` +
    (removed.length === 0
      ? ""
      : `/** The ${removed.length} shorthand(s) this project switched off — writing one is now an unknown property. */\n` +
        `export type Removed = ${removed.map((one) => JSON.stringify(one)).join(" | ")};\n\n`) +
    `/** The shape of one block here. The virtual file reads this. */\n` +
    `export type CssBlockShape = Partial<CssProperties> & {\n` +
    `  [nested: \`&\${string}\`]: CssBlockShape[];\n` +
    `} & { [at: \`@\${string}\`]: CssBlockShape[] } & { [dashed: \`-\${string}\`]: CssValue };\n` +
    `export type { CssBlock, CssCondition, CssSpreadable, CssValue } from "@ramonda/css/properties";\n\n` +
    `/** What one property accepts in this project — \`const gap: Value<"padding-left"> = "8px"\`. */\n` +
    `export type Value<P extends keyof CssProperties> = CssProperties[P];\n`;

  return { css, module };
}
