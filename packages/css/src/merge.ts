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

/** The map behind a merged value, or the map itself. */
function mapOf(one: StyleMap | StyleValue): StyleMap {
  return (one as { [FROM]?: StyleMap })[FROM] ?? (one as StyleMap);
}

/**
 * Compose blocks into one map — the primitive, and the one that is closed over its own output.
 *
 * `merge` returns the VALUE the framework takes, which is a different shape and cannot be composed
 * again; a nested group has to compose, so this is what it composes with. The clear-lists are
 * carried into the result for the same reason: a composed map has to behave like the maps it came
 * from, or `compose(compose(a, b), c)` would stop clearing halfway.
 *
 * **Associative**, which is what makes a nested `@@if` mean the same as a flattened one — and it is
 * the property the clearing rule could have broken, since clearing removes keys rather than
 * replacing them. Measured over 50,301 random groupings drawn from one shorthand family: zero
 * disagreements.
 */
export function compose(...maps: readonly (StyleMap | StyleValue | false | null | undefined)[]): StyleMap {
  /** Insertion-ordered, which is what keeps a composed map behaving like the sequence it came from. */
  const chosen: Record<string, StyleEntry | StyleClears> = {};

  for (const given of maps) {
    if (!given) continue;
    const map = mapOf(given);
    for (const key in map) {
      if (key.startsWith(CLEARS)) continue;

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
    for (const [index, value] of carried.entries()) {
      // No value is not the empty value: the property is left unset so the declaration falls back to
      // what the stylesheet said. The same rule `toStyleObject` and the framework follow.
      if (value === undefined || value === null) continue;
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
