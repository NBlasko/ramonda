import { expressionFor, nameFor } from "./compiler/dollar";
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
  /** The initial — what `:root` sets and what `@property` registers. */
  readonly value: string | number;
  /**
   * Every value it may take, or `"any"`, or nothing when it never changes.
   *
   * This is what the TYPE carries, and `value` is what the stylesheet carries. They were one field
   * until a user asked how a theme is supposed to work: a variable a theme moves between two colours
   * has one initial and two possible values, and a type claiming only the first is claiming
   * something the browser will not use.
   */
  readonly range?: readonly (string | number)[] | "any";
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
          value: one.value,
          ...(one.range === undefined ? {} : { range: one.range }),
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

/**
 * What a variable may BE, as a type — its range when it declared one, its value when it did not.
 *
 * `"any"` becomes the kind's own value type, which is what "it changes and we do not pin it" means:
 * a tenant's colour from a server is a colour and nothing narrower can be said about it.
 */
function rangeOf(one: Named): string {
  /**
   * A bare declaration is MARKED, because it means the variable never changes.
   *
   * The range and the initial coincide here by design — a variable that named one value has a range
   * of one value — so the type was already right and `toStyle` already refused to set it. What it
   * said was `not assignable to type 'never'`, which a person who wrote `16px` meaning *the default*
   * cannot act on. The mark is what lets the refusal name the fix. See `Fixed` in `token.ts`.
   *
   * `range: ["16px"]` is NOT marked and must not be: a range that holds one value is a range, and
   * setting the variable to that value is a thing the project said it may do.
   */
  if (one.range === undefined) return `Fixed<${JSON.stringify(one.value)}>`;
  if (one.range === "any") return `ValueByKind[${JSON.stringify(one.kind)}]`;
  return one.range.map((each) => JSON.stringify(each)).join(" | ");
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
        const token = `Token<${JSON.stringify(one.kind)}, ${rangeOf(one)}>`;
        return `${indent}  ${key(segment)}: ${JSON.stringify(`var(${one.name})`)} as ${token},`;
      }
      return `${indent}  ${key(segment)}: Object.freeze({\n${write(next as Record<string, unknown>, `${indent}  `)}\n${indent}  }),`;
    });
    return lines.join("\n");
  };

  /**
   * **Frozen at every level, and `as const` is not enough.**
   *
   * `as const` makes TypeScript refuse `$.color.accent.main = "…"`, which catches every reasonable
   * way somebody could do it. A cast walks past that — and this repository's own rule is to prove it
   * statically AND stop it anyway, because a type is not a defence.
   *
   * Mutating `$` would be the worst kind of change: the value is written into the stylesheet at build
   * time, so assigning to it changes what one module reads and nothing else, and the page keeps the
   * old value. The way to change a variable is `toStyle`, where the new value is checked against the
   * kind and lands on an element.
   */
  return `Object.freeze({\n${write(root, "")}\n})`;
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
export const NARROW: Readonly<
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
  readonly variablesOnly?: boolean;
}

/**
 * Every kind a property's value can BE, for matching a `"<kind>"` selector.
 *
 * The same table the narrowing uses, so a selector reaches exactly the properties the types can
 * narrow. `"<length>"` therefore reaches `padding-left`, whose grammar is `<length-percentage>`: a
 * project saying *lengths* means lengths, and `NARROW` already writes down that a length-percentage
 * is one.
 */
function kindsOf(property: string): readonly string[] {
  return NARROW[PRIMITIVE[property] ?? ""]?.kinds ?? [];
}

/**
 * What a project said about ONE property, with the three selectors merged in order.
 *
 *     "*"              every property
 *     "<length>"       every property whose value is that kind
 *     "padding-left"   that property
 *
 * **Each binds more tightly than the one before**, which is the shape CSS itself has and the reason
 * the selectors are spelled this way. Merged key by key rather than replaced, so a kind can say
 * `variablesOnly` while the property beneath it says `values` and both apply — and so two shared
 * configs still combine, which is what design C was chosen for.
 *
 * A property matching SEVERAL kind selectors takes them in the order CSS's own names sort, which is
 * only reachable by naming two kinds one property has — `<length>` and `<length-percentage>` both
 * reach `padding-left`. Sorted rather than left to object order so the answer does not depend on
 * which line somebody typed first.
 */
export function ruleFor(rules: PropertyRules | undefined, property: string): AnyRule {
  if (rules === undefined) return {};

  const sweep = (rules["*"] ?? {}) as AnyRule;
  const byKind = kindsOf(property)
    .map((kind) => `<${kind}>`)
    .sort()
    .map((selector) => (rules[selector as keyof PropertyRules] ?? {}) as AnyRule);
  const own = (rules[property as keyof PropertyRules] ?? {}) as AnyRule;

  return Object.assign({}, sweep, ...byKind, own) as AnyRule;
}

/**
 * The kinds this project takes only from its variables, for the RULE — which reads composite
 * properties no type describes.
 *
 * A kind selector is the only place this can come from: `border-left: 4px solid red` has no kind of
 * its own, so nothing about that property says a colour inside it was hardcoded. What the rule then
 * owns is the value; what exempts a property is its own `variablesOnly: false`, asked separately.
 */
export function variablesOnlyKinds(rules: PropertyRules | undefined): readonly string[] {
  if (rules === undefined) return [];

  const kinds: string[] = [];
  for (const [key, rule] of Object.entries(rules)) {
    const kind = /^<(.+)>$/.exec(key);
    if (kind !== null && (rule as AnyRule).variablesOnly === true) kinds.push(kind[1]);
  }
  return kinds;
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

/**
 * Which declared-variable kinds fit a property, for one the project gave a closed list.
 *
 * The same table the narrowing uses. A property CSS cannot classify has no answer here, and a
 * variable cannot be checked into it — which is right: nothing knows what kind belongs there.
 */
function kindsFor(property: string): string | undefined {
  const narrow = NARROW[PRIMITIVE[property] ?? ""];
  return narrow === undefined ? undefined : narrow.kinds.map((one) => JSON.stringify(one)).join(" | ");
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

  /**
   * The properties a closed list could reach — asked per PROPERTY, like every other setting.
   *
   * This walked the config's own KEYS, which was invisible while the only keys were property names
   * and `"*"`. A kind selector broke it three ways at once: `"<time>": { values: [...] }` emitted a
   * row literally named `"<time>"` and constrained nothing, `"*"` was skipped and so did nothing
   * silently, and a property with `values` beside `variablesOnly` never consulted the second.
   *
   * A name is itself; a kind selector is every property of that kind. `"*"` carrying a closed list
   * is refused in the config, because a list of permitted values for all 935 properties is not a
   * thing anybody means — and doing nothing about it quietly was the worse of the two answers.
   */
  const candidates = new Set<string>();
  for (const key of Object.keys(rules ?? {})) {
    const kind = /^<(.+)>$/.exec(key);
    if (key === "*") continue;
    if (kind === null) {
      candidates.add(key);
      continue;
    }
    if ((rules?.[key as keyof PropertyRules] as AnyRule | undefined)?.values === undefined) continue;
    for (const property of Object.keys(PRIMITIVE)) {
      if (kindsOf(property).includes(kind[1])) candidates.add(property);
    }
  }

  /** A closed list is that list, whatever CSS would otherwise allow here. */
  for (const property of candidates) {
    if (gone.has(property)) continue;
    const rule = ruleFor(rules, property);
    const values = rule.values;
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

    /**
     * **A variable of the right kind goes in too, and none did.**
     *
     * A closed list had no `Token` in it at all, so `z-index: $.layer.modal` was refused — with the
     * project's own list in the message — however right the variable was. Measured; the user met it.
     * A declared variable IS one of these values when its own range fits inside the list, which is
     * what `Token<kind, permitted>` says.
     */
    const kinds = kindsFor(property);
    const token = kinds === undefined ? "" : ` | Token<${kinds}, ${permitted.join(" | ")}>`;
    if (kinds !== undefined) uses.add("Token");

    /**
     * `variablesOnly` removes the LITERAL spelling and nothing else — the list still binds.
     *
     * The user's own words, and they settle what the setting means: *"variabla takodje mora da
     * postuje range. Ako im se ne svidja, pa onda prosiri range."* A variable is checked against
     * the list by its declared value, through `Token<kind, permitted>`, so this is not a way around
     * a range. It is the same list with one spelling of it taken away.
     *
     * A property with no kind cannot express that — nothing can check a variable into it — so the
     * literals stay rather than the property being narrowed to nothing a person could write.
     */
    const onlyVariables = rule.variablesOnly === true && kinds !== undefined;
    const written = onlyVariables ? "" : `${permitted.join(" | ")}`;
    const said = onlyVariables
      ? `only the ${values.length} value(s) this project permits, and only as one of its variables`
      : `only the ${values.length} value(s) this project permits`;

    rows.push(
      `  /** \`${property}\` — ${said}. */\n` +
        `  ${JSON.stringify(property)}: ${written}${written === "" ? token.slice(3) : token} | CssGlobal | \`var(\${string})\`;`,
    );
  }
  const said = new Set(closed);

  for (const [property, primitive] of Object.entries(PRIMITIVE)) {
    const narrow = NARROW[primitive];
    if (narrow === undefined || gone.has(property) || said.has(property)) continue;

    /**
     * A kind this project writes only as a variable: the literal value type goes, the token stays.
     *
     * `currentcolor` comes back explicitly. It is in the `<color>` grammar's own word list and is
     * therefore filtered out of the keywords below as "a value the value type already covers" — but
     * it is not a colour anybody hardcoded, it is a reference to the inherited one. Refusing it
     * would be refusing an escape hatch CSS itself provides.
     */
    const onlyVariables = ruleFor(rules, property).variablesOnly === true;
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

    /**
     * **The permitted values reach the TOKEN too, wherever the project set a range.**
     *
     * `Token<"length">` leaves the value unconstrained, so a variable declared `30px` went into a
     * property narrowed to `px` and to four values alike — measured, and it is a capability this
     * already had and was not using. With the range in the slot, a variable whose own value falls
     * outside what the property permits is refused by the value, not by the kind.
     *
     * Only where a range EXISTS: `units` or `values` on the property. Nowhere else is there anything
     * to check against, so nowhere else can this get in the way.
     *
     * What it checks is the variable's DECLARED value, which under a theme is the fallback rather
     * than what the browser will use. That is the honest limit, and it is narrow: a variable themed
     * into a different range is a different variable.
     */
    const ranged = ruleFor(rules, property).units === undefined ? "" : `, ${value}`;

    /**
     * What a variables-only property still takes BESIDE its variables, per primitive.
     *
     * `currentcolor` for a colour: it is in the `<color>` grammar's own word list and is filtered
     * out of the keywords as "a value the value type already covers", but it is not a colour
     * anybody hardcoded — it is a reference to the inherited one, and refusing it would be refusing
     * an escape hatch CSS itself provides.
     *
     * **A bare `0` wherever the value is a dimension**, and that is a fault this review found.
     * Measured, `variablesOnly: ["length"]` refused `padding-left: 0` — the most common declaration
     * in CSS — with `Narrowed<never, Token<…>>`. A zero length needs no unit in CSS, `CssDimension`
     * holds `0 | "0"` for that reason, and a project saying *lengths come from variables* is not
     * asking for `$.space.none`. The dimensionless zero went out with the literals because the two
     * lived in one type.
     *
     * Both spellings, because a block is CSS and `padding-left: 0` arrives as the string `"0"`,
     * while a hole can hand over the number.
     *
     * Not for `<number>` or `<integer>`: a zero there is a number written out, which is exactly what
     * the setting is refusing.
     *
     * It goes in the VALUE slot, not beside the keywords: `Narrowed<K extends string, V>` constrains
     * its first parameter to `string`, and `0` is a number — measured, `TS2344` on every row.
     */
    const zero = onlyVariables && value.includes("CssDimension") ? ` | 0 | "0"` : "";
    const kept = onlyVariables
      ? primitive === "color"
        ? `${head === "never" ? "" : `${head} | `}"currentcolor"`
        : head
      : head;
    const literals = onlyVariables ? "" : `${value} | `;

    rows.push(
      `  /** \`${property}\` — ${narrow.said}${onlyVariables ? ", and only as one of this project's variables" : ", and this project's variables of that kind"}. */\n` +
        `  ${JSON.stringify(property)}: Narrowed<${kept}, ${literals}Token<${kinds}${ranged}>${several}${zero}>;`,
    );
  }

  return { rows: rows.join("\n"), removed, uses, closed };
}

/**
 * `Var<K>` — the variables this project declares of one kind, as a type.
 *
 * ```ts
 * const tone: Var<"color"> = toggle ? $.color.accent.quiet : $.color.accent.main;
 * ```
 *
 * **Asked for by a user**, whose annotation could not be written: `Token<"color", …>` wants the
 * variable's RANGE as its second parameter, and a value toggled between two variables has two
 * ranges — neither of which the author should have to name, and one of which is a marker they
 * cannot guess.
 *
 * Inference already carries the local case: `const tone = toggle ? $.a : $.b` needs no annotation
 * and drops into a hole. This is for where inference cannot reach — a class field, a parameter, a
 * return type.
 *
 * An INTERFACE keyed by kind rather than a conditional over a union, for two reasons. Hovering it
 * shows the variables themselves rather than a computation. And a kind this project declares nothing
 * of is simply not a key, so `Var<"time">` in a project with no times is refused by the constraint
 * with the kinds it does have — rather than resolving to `never` and failing later against a value.
 */
function byKind(named: readonly Named[]): string {
  const kinds = new Map<string, string[]>();
  for (const one of named) {
    const already = kinds.get(one.kind) ?? [];
    already.push(`typeof ${expressionFor(one.path)}`);
    kinds.set(one.kind, already);
  }
  if (kinds.size === 0) return "";

  const rows = [...kinds.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, each]) => `  ${JSON.stringify(kind)}: ${each.join(" | ")};`)
    .join("\n");

  return (
    `\n/** Every variable this project declares, by kind — what \`Var\` reads. */\n` +
    `export interface VarByKind {\n${rows}\n}\n\n` +
    `/** Any variable of a kind — \`const tone: Var<"color"> = toggle ? $.a.b : $.a.c\`. */\n` +
    `export type Var<K extends keyof VarByKind> = VarByKind[K];\n`
  );
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
  /** `ValueByKind` is named only by a variable whose range is `"any"` — see `rangeOf`. */
  const open = named.some((one) => one.range === "any");
  /** And `Fixed` only by one declared BARE, which is the mark that it never changes. */
  const bare = named.some((one) => one.range === undefined);
  const fromPackage = [
    "CssColor",
    "CssDimension",
    "CssAngleUnit",
    "CssLengthUnit",
    "CssResolutionUnit",
    "CssTimeUnit",
    "Fixed",
    "Token",
    "ValueByKind",
  ]
    .filter((one) => uses.has(one) || (one === "ValueByKind" && open) || (one === "Fixed" && bare))
    .join(", ");

  const module =
    `${HEADER}\n\n` +
    `import type { ${fromPackage} } from "@ramonda/css";\n` +
    `import type { ${closed.length === 0 ? "" : "CssGlobal, "}CssProperties as Base, CssValue, Narrowed } from "@ramonda/css/properties";\n\n` +
    `/** Every variable this project declares. Reach one by the path it was declared at. */\n` +
    /**
     * No `as const`: it is only legal on a literal, and `Object.freeze( … ) as const` is `TS1355`.
     *
     * Nothing is lost. Every leaf carries its own `as Token< … >`, which is where the literal types
     * come from, and `Object.freeze` returns `Readonly<T>` — so a group is readonly too.
     */
    `export const $ = ${named.length === 0 ? "Object.freeze({})" : moduleTree(named)};\n\n` +
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
    `export type Value<P extends keyof CssProperties> = CssProperties[P];\n` +
    byKind(named);

  return { css, module };
}
