import { widthSlot } from "./conditions";
import type { StyleValue, StyleVarValue } from "./types";

/**
 * A block's entry for one thing it sets: the class that sets it, and the values a hole carries.
 *
 * Two shapes because most declarations have no hole and pay nothing for one. A hole's custom
 * property is named after the CLASS — `--<class>-<n>` — so no name has to travel.
 */
export type StyleEntry = string | readonly [className: string, ...values: StyleVarValue[]];

/**
 * What a `~` key holds: the KEYS a property clears, in full.
 *
 * A list rather than a joined string, and full keys rather than property names — both were nearly
 * wrong. A key carries its context (`@media (min-width: 40rem)|:hover|padding`), so `padding` inside
 * a `@media` must clear `padding-left` inside THAT `@media` and not the one outside it; and a key
 * may contain spaces, so anything joined by one could not be split back.
 */
export type StyleClears = readonly string[];

/**
 * What one `@@( … )` compiles to: a map from what a declaration SETS to the class that sets it.
 *
 * A key beginning with `~` is not a declaration. It is the list of things the property named after
 * it clears — see {@link merge} — and it never reaches an element.
 */
export type StyleMap = { readonly [key: string]: StyleEntry | StyleClears };

/** How a clear-list is marked. No CSS property may begin with `~`, so nothing collides. */
const CLEARS = "~";

/**
 * Where a merged value keeps the map it came from.
 *
 * `const base = @@( … )` compiles to a VALUE, because that is what the `css` prop takes — and
 * `...{{base}};` in another block hands that value back to a merge, which needs the MAP. Without
 * this it failed quietly and only sometimes: iterating a value's own keys happens to yield a
 * plausible class string, so a base spread into a modifier still rendered — with nothing
 * overridable and nothing cleared.
 *
 * A symbol, so it is not a key any map can have and not a field anything serialises.
 */
const FROM = Symbol.for("ramonda.css.map");

/**
 * The map behind a merged value, or the map itself.
 *
 * **A value with NO map is the third case, and it used to be read as a map.** `block("r-x", ["--r-x-0"])("red")`
 * is what the public `block` produces, and it carries no map — so its own fields were read as
 * declarations: measured, `merge(block("r-def"))` came back with `className: "r-def undefined
 * undefined"`, the word `undefined` written into an element's class attribute.
 *
 * It cannot compose, and that is a fact about the value rather than a limitation here: a map says
 * what each class SETS, and a bare value has thrown that away. What it can still do is land — so it
 * contributes its class and its holes under its own class name as the key, which no CSS property can
 * collide with and no clear-list can name. It takes part in no override, which is the honest
 * consequence of having no map: there is nothing to decide with.
 *
 * Not reachable from compiled code, which emits `_merge({ … })` — but `block` and `merge` are both
 * public, and the README, `CONTRACT.md`, `DESIGN.md` and `PLAN.md` all showed `block(…)` as what the
 * compiler emits, which it has not for some time. The documents pointed straight at this.
 */
function mapOf(one: StyleMap | StyleValue): StyleMap {
  const behind = (one as { [FROM]?: StyleMap })[FROM];
  if (behind !== undefined) return behind;

  const value = one as Partial<StyleValue>;
  if (typeof value.className !== "string" || !Array.isArray(value.values)) return one as StyleMap;
  return { [value.className]: [value.className, ...(value.values as StyleVarValue[])] };
}

/**
 * A DECLARATION WITH NOTHING TO SET, which is a hole whose value never arrived.
 *
 * `...{base}; color: {tint}` with `tint = null` used to delete the base's class for that key and
 * leave the modifier's, whose `var()` was then unset — so `color` computed to inherit instead of
 * falling back to the base's red. **The comments in this file and in `value.ts` both promised the
 * fall-back**, and each was right about its own step: the loss happened one step earlier, where the
 * key was displaced.
 *
 * Dropping the whole entry is safe because a class stands for exactly ONE declaration — there is
 * nothing else on it to lose. And it costs nothing, because a declaration reading an unset `var()`
 * is invalid at computed-value time and is dropped by the browser anyway: the class was never going
 * to apply, it was only in the way of the one that would have.
 *
 * ONE missing value among several is enough, for that same reason: `border-left: {w} solid {c}`
 * with `c` missing is one declaration, and it is dropped whole.
 *
 * The type refuses `null` and `undefined` in a hole — see `__val` in `compiler/virtual.ts` — so this
 * is the belt for what a type cannot hold: a cast, an `any`, a JavaScript caller, data off an API.
 */
function setsNothing(entry: StyleEntry | StyleClears | undefined): boolean {
  if (entry === undefined || typeof entry === "string") return entry === undefined;
  for (let index = 1; index < entry.length; index++) {
    const value = entry[index];
    if (value === undefined || value === null) return true;
  }
  return false;
}

/**
 * Whether a warning has already been said, so a render loop says it once.
 *
 * Dev only, and it never grows in a production build: nothing reaches it, because the only caller is
 * inside the guard below and a bundler that replaces `process.env.NODE_ENV` drops the branch and
 * everything it alone referenced. Measured through a real Vite production build — neither the
 * sentence nor `process` appears in the output.
 */
const said = new Set<string>();

/**
 * Forget what has been said, so a test can watch the warning happen more than once.
 *
 * Exported for the tests and for nothing else — the set is deliberately never cleared at runtime,
 * which is what makes a render loop say each thing once.
 */
export function forget(): void {
  said.clear();
}

/** Whether this is a development build, spelled so that nothing breaks where nobody defines it. */
const inDevelopment = (): boolean => typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

/**
 * How strongly a key's CONTEXT overrides, or `undefined` when the pair cannot be compared.
 *
 * A key is `conditions… | selector? | property`, and its doc says it is never parsed back — the
 * parts share a separator a selector is allowed to contain, so `[title|="x"]` splits into nonsense.
 * The property is safe, being the tail after the LAST separator. The context is not, so this only
 * answers when every part of it begins with `@`, which a condition does and a selector cannot.
 *
 * **A selector is why that matters rather than being caution.** A selector adds specificity, which
 * beats source order on its own — so `&:hover { color: red }` against `@media { color: blue }` is
 * settled by the selector and not by the sheet. Comparing them would report correct CSS, which is
 * the failure mode this package has paid for before.
 */
function slotOf(context: string): number | undefined {
  if (context === "") return 0;
  return context.split("|").every((one) => one.startsWith("@")) ? widthSlot([context]) : undefined;
}

/**
 * An override that composition asks for and the STYLESHEET will not honour, said out loud in dev.
 *
 * **The one hole the compiler cannot see.** Two declarations of one property under different
 * conditions are different keys, so the merge keeps both, both classes land, and the sheet breaks
 * the tie by how strongly each condition overrides — see `widthSlot`. Within one block
 * `override-out-of-order` reports where that contradicts the author's order. Across a SPREAD it
 * cannot: `...{base}` is a runtime value, and the compiler does not know what is in it.
 *
 * Measured in Chromium, on the shape people write — a base carrying the theme and a modifier
 * adjusting it:
 *
 *     const base = @@( @media (prefers-color-scheme: dark) { color: white; } );
 *     const card = @@( ...{base}; @media (min-width: 40rem) { color: blue; } );
 *
 * With the modes ordered against breakpoints the way Tailwind orders them this one is right, and the
 * mirror of it — a base with the breakpoint, a modifier with the mode — is the one that loses. Either
 * way something loses silently, and only the runtime holds both maps at once, so this is the only
 * place the question can be asked at all.
 *
 * Said once per pair, because a render loop would otherwise say it a thousand times.
 */
function warnAboutOrder(chosen: Record<string, StyleEntry | StyleClears>): void {
  /** Property -> what was composed that SETS it, in composition order. */
  const byProperty = new Map<string, { key: string; property: string; slot: number }[]>();

  const register = (property: string, one: { key: string; property: string; slot: number }) => {
    const list = byProperty.get(property);
    if (list === undefined) byProperty.set(property, [one]);
    else list.push(one);
  };

  for (const key in chosen) {
    if (key.startsWith(CLEARS)) continue;
    const cut = key.lastIndexOf("|");
    const slot = slotOf(cut === -1 ? "" : key.slice(0, cut));
    if (slot === undefined) continue;

    const property = cut === -1 ? key : key.slice(cut + 1);
    const one = { key, property, slot };
    register(property, one);

    /**
     * **And every longhand a SHORTHAND sets**, which this missed entirely — all 98 families.
     *
     * Grouping by the exact property name meant `padding` and `padding-left` were never compared,
     * so a shorthand under a condition silently beat a longhand composed after it. Measured against
     * plain CSS in Chromium: `...{@media (min-width: 1px) { padding: 11px }}; padding-left: 4px`
     * computed 11px where hand-written CSS gives 4px. Swept across the table: 98 families asked, 0
     * warned.
     *
     * The single-file checker has always caught this, through `covers()` and the shorthand table —
     * and the runtime may not import that table, which is why `conditions.ts` exists at all. It does
     * not need to: **the clear-list is already in the map**, because clearing is how a shorthand
     * displaces a longhand. Its keys carry their own context, which is stripped here, since the
     * question being asked is about two entries in DIFFERENT contexts.
     */
    const cleared = chosen[`${CLEARS}${key}`];
    if (!Array.isArray(cleared)) continue;
    for (const each of cleared as readonly string[]) {
      const at = each.lastIndexOf("|");
      const sets = at === -1 ? each : each.slice(at + 1);
      if (sets !== property) register(sets, one);
    }
  }

  for (const [property, list] of byProperty) {
    let strongest = list[0];
    for (const one of list.slice(1)) {
      if (one.slot >= strongest.slot) {
        strongest = one;
        continue;
      }
      /**
       * Which properties the message names. They are the same one in the ordinary case, and a
       * longhand against its own shorthand in the case above — where naming only the group would
       * say `padding-left` twice and point at neither line the author wrote.
       */
      const later = one.property === property ? `\`${property}\`` : `\`${one.property}\``;
      const earlier = strongest.property === property ? "it" : `\`${strongest.property}\`, which sets it too,`;
      const message =
        `[@ramonda/css] ${later} is composed later under \`${context(one.key)}\` than ` +
        `${earlier === "it" ? `under \`${context(strongest.key)}\`` : `${earlier} under \`${context(strongest.key)}\``}` +
        `, and it will not override it — the stylesheet emits the stronger condition last, so the ` +
        `earlier one wins wherever both apply. Put the two under one condition, or compose them the ` +
        `other way round.`;
      if (said.has(message)) continue;
      said.add(message);
      console.warn(message);
    }
  }
}

/** A key's context, for the message — the whole key when it has none. */
const context = (key: string): string => {
  const cut = key.lastIndexOf("|");
  return cut === -1 ? "no condition" : key.slice(0, cut);
};

/**
 * Compose blocks into one map — the primitive, and the one that is closed over its own output.
 *
 * `merge` returns the VALUE the framework takes, which is a different shape and cannot be composed
 * again; a nested group has to compose, so this is what it composes with. The clear-lists are
 * carried into the result for the same reason: a composed map has to behave like the maps it came
 * from, or `compose(compose(a, b), c)` would stop clearing halfway.
 *
 * **Associative**, which is what makes a nested `if` mean the same as a flattened one — and it is
 * the property the clearing rule could have broken, since clearing removes keys rather than
 * replacing them. Measured over 50,301 random groupings drawn from one shorthand family: zero
 * disagreements.
 */
export function compose(...maps: readonly (StyleMap | StyleValue | false | null | undefined)[]): StyleMap {
  /** Insertion-ordered, which is what keeps a composed map behaving like the sequence it came from. */
  const chosen: Record<string, StyleEntry | StyleClears> = {};
  /** How many maps actually arrived, for the dev warning below. */
  let given = 0;

  for (const one of maps) {
    if (!one) continue;
    given++;
    const map = mapOf(one);
    for (const key in map) {
      if (key.startsWith(CLEARS)) continue;
      // A declaration with nothing to set is not set, so it neither displaces nor clears anything.
      if (setsNothing(map[key])) continue;

      const cleared = map[`${CLEARS}${key}`];
      if (Array.isArray(cleared)) {
        for (const one of cleared) delete chosen[one];
        chosen[`${CLEARS}${key}`] = cleared;
      }
      // Deleted first, so a key set twice moves to where it was set LAST rather than staying where
      // it was set first — which is what "later wins" means for the order the classes come out in.
      delete chosen[key];
      chosen[key] = map[key];
    }
  }

  /**
   * Only when more than one map was composed. A single block's contradictions are the compiler's to
   * report, at the author's own line, and it does — this exists for what a spread hides.
   */
  if (given > 1 && inDevelopment()) warnAboutOrder(chosen);

  return chosen;
}

/**
 * Compose blocks: later wins, per thing set.
 *
 * **This is the only place a call site can decide anything, and that is measured.** The order of
 * classes in a `class` attribute decides nothing — the stylesheet's order does, and with layers the
 * layer does — so two whole-block classes cannot express "this one wins". Keeping ONE class per
 * thing set means the merge picks which classes land, and there is never a tie to break.
 *
 * A falsy argument is a group that is switched off, which is what `disabled && block` compiles to.
 *
 * ## A shorthand clears its own longhands
 *
 * `padding` and `padding-left` are different properties, so a merge keeps both and the SHEET breaks
 * the tie — measured in Chromium, and possibly against the call site. So this does what CSS's own
 * cascade does. The other direction needs nothing: the sheet emits longhands after shorthands, so a
 * longhand written later already wins.
 *
 * **The list travels with the block that needs it**, under a `~` key, rather than from a table of
 * all 78 shorthands. That is what keeps this package's promise of shipping almost nothing: a page
 * pays for the shorthands its blocks actually write.
 *
 * ## What comes out
 *
 * The value the framework already takes — a class string, custom property names, values — so nothing
 * in `@ramonda/core` changes for any of this. The class string simply holds several classes, which
 * is what a class attribute is for.
 *
 * This is the BOUNDARY; {@link compose} is the primitive, and it is the one that composes with
 * itself.
 */
export function merge(...maps: readonly (StyleMap | StyleValue | false | null | undefined)[]): StyleValue {
  const chosen = compose(...maps);

  let className = "";
  const properties: string[] = [];
  const values: StyleVarValue[] = [];

  for (const key in chosen) {
    if (key.startsWith(CLEARS)) continue;
    const entry = chosen[key] as StyleEntry;

    if (typeof entry === "string") {
      className = className === "" ? entry : `${className} ${entry}`;
      continue;
    }

    const [name, ...carried] = entry;
    className = className === "" ? name : `${className} ${name}`;
    /**
     * Every value is carried, because `compose` has already dropped any entry missing one — see
     * {@link setsNothing}.
     *
     * This used to skip a missing value here and keep the class, which is the answer `toStyleObject`
     * and the framework still give for a value handed to them directly. It is the wrong answer one
     * step in: by the time it ran, the entry it was patching up had already displaced the base it
     * was supposed to fall back to. One question, asked where it can be answered.
     */
    for (const [index, value] of carried.entries()) {
      properties.push(`--${name}-${index}`);
      values.push(value);
    }
  }

  /**
   * The map travels with the value, so a spread of it composes rather than iterating its fields.
   *
   * Not enumerable: it must not appear in a spread of the value, in `JSON.stringify`, or in anything
   * that walks its keys — it is how a value is composed again, not part of what a value IS.
   */
  const value = { className, properties, values };
  Object.defineProperty(value, FROM, { value: chosen, enumerable: false });
  return value;
}
