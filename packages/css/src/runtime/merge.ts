import { CLEARS_TABLE } from "../clears.generated";
import { widthSlot } from "./conditions";
import { keyIn, partsOf } from "./key";
import type { StyleValue } from "./types";

/**
 * Composing blocks, over the CLASS STRING and nothing else.
 *
 * ## Why a string
 *
 * A merge keeps, per thing set, the one written later, so it needs to know what each class sets.
 * That KEY is in the class name — see `keyToken` — so a block needs no map beside it and is just
 * its class string. A map would be an object, a new one on every render, and a child receiving it
 * would re-render for nothing (`RMD020`). Two merges with the same contents are the same string,
 * compared the way every other prop is compared, so the identity question disappears rather than
 * being answered.
 *
 * ## What the string cannot carry, and what does
 *
 * Two things, and both are REGISTERED by the module that needs them rather than shipped to every
 * page — see {@link shorthands} and {@link conditionsOf}. A table of every shorthand family is
 * 23 KB, 3.7 KB gzipped, which is larger than this whole runtime, and a page that writes three
 * shorthands would be paying for all the rest.
 */

/**
 * What one shorthand clears, by the PROPERTY as a key writes it — `p` clears `pl`, `pr`, `pt`,
 * `pb`.
 *
 * Registered by the emitted module, for the shorthands that module actually writes. Keyed by the
 * property alone and never by the whole key, because the CONTEXT composes itself: a key is
 * `<context><property>`, so `@media_print.p` clears `@media_print.pl` by putting the same context
 * back in front. That works for a hashed context too — the hash is a function of the context and is
 * shared by every property sitting in it.
 *
 * Module-level state, and harmless: it is bounded by the source, it never grows while a page runs,
 * and there is nothing in it to evict.
 */
const CLEARS = new Map<string, readonly string[]>();

/** The generated table, read on first use: each shorthand's DIRECT members, braces expanded. */
let direct: Map<string, readonly string[]> | undefined;

/** What each shorthand clears in full, once asked — the table followed down every chain. */
const closures = new Map<string, readonly string[]>();

/** `a_{b,c}_d` is `a_b_d a_c_d`, the one shorthand the generator writes. */
const BRACES = /^(.*)\{(.*)\}(.*)$/;

function readTable(): Map<string, readonly string[]> {
  const table = new Map<string, readonly string[]>();
  for (const line of CLEARS_TABLE.split("\n")) {
    const at = line.indexOf(": ");
    if (at === -1) continue;
    const members = line.slice(at + 2).split(" ");
    table.set(
      line.slice(0, at),
      members.flatMap((one) => {
        const [, head, middle, tail] = BRACES.exec(one) ?? [];
        return middle === undefined ? [one] : middle.split(",").map((part) => head + part + tail);
      }),
    );
  }
  return table;
}

/**
 * What this release knows a shorthand clears — every member, and every member of a member.
 *
 * The walk keeps a SEEN set, and it has to: `gap` and `grid-gap` are one property under two names
 * and each lists the other.
 */
function builtIn(property: string): readonly string[] {
  const known = closures.get(property);
  if (known !== undefined) return known;
  direct ??= readTable();
  const table = direct;
  const seen = new Set<string>();
  const walk = (from: string): void => {
    for (const one of table.get(from) ?? NONE)
      if (one !== property && !seen.has(one)) {
        seen.add(one);
        walk(one);
      }
  };
  walk(property);
  const found = seen.size === 0 ? NONE : [...seen];
  closures.set(property, found);
  return found;
}

/**
 * Register the shorthands a module writes. Called by emitted code; never written by hand.
 *
 * Idempotent, and it has to be: two modules writing `padding` each register it, and a dev server
 * re-runs a module on every save.
 *
 * **The UNION, because two registrations can disagree.** `set` alone is idempotent only while the
 * lists match, and one build never produces two different lists for a key — the emitter writes the
 * whole family. Two builds do: a library shipping blocks compiled against another version of this
 * package carries its own `_clears({ … })`, and an application on a newer one has both. Measured
 * with `set`: a shorter list registered second took the first one's longhands away, and a
 * `padding-left` survived a `padding` written after it — silently, decided by whichever module the
 * bundler put last.
 *
 * The union rather than first-wins: these are one family described twice, and clearing a longhand a
 * newer version has dropped costs nothing, because no class carries it.
 *
 * **`conditionsOf` and `namesOf` keep `set`, and the difference is the VALUE rather than the
 * caution.** Each of those maps a key to one string — the query a hash stands for, the name an
 * abbreviation stands for — and two different strings cannot be unioned. Both are read only by the
 * development warning and dropped from a production build, so a disagreement between two builds
 * costs a sentence in a warning rather than a declaration on a page.
 */
export function shorthands(table: Readonly<Record<string, readonly string[]>>): void {
  for (const property in table) {
    const already = CLEARS.get(property) ?? builtIn(property);
    CLEARS.set(property, [...new Set([...already, ...table[property]])]);
  }
}

/**
 * A key's CONDITIONS, for the development-only warning below — registered the same way.
 *
 * The warning needs to compare how strongly two conditions override, and a key carries its context
 * as the author's own text or as a hash. A hash cannot be read, so the text is registered beside it
 * — by the module, for the keys it writes, and only where there is a condition and no selector,
 * which is the only shape the warning can say anything about.
 *
 * **Emitted inside a development guard**, so a production bundle drops the call and this map stays
 * empty. The warning is development-only, so nothing is lost where nothing would have been said.
 */
const CONDITIONS = new Map<string, string>();

export function conditionsOf(table: Readonly<Record<string, string>>): void {
  for (const key in table) CONDITIONS.set(key, table[key]);
}

/**
 * The CSS name behind a key's property form — `p` is `padding` — for the warning's own sentence.
 *
 * A key writes a property the way a class name can hold it: abbreviated where there is an
 * abbreviation, and with its dashes as `_` where there is not. That is unreadable in a message,
 * and a message naming `pl` where the author wrote `padding-left` is a message that sends somebody
 * looking for a string in no file.
 *
 * Registered with the conditions and dropped with them in a production build, because the only
 * thing that reads either is the development warning.
 */
const NAMES = new Map<string, string>();

export function namesOf(table: Readonly<Record<string, string>>): void {
  for (const form in table) NAMES.set(form, table[form]);
}

/** What the author called it, or the form itself where nothing registered a name. */
const nameOf = (form: string): string => NAMES.get(form) ?? form;

const NONE: readonly string[] = [];

/** The prefix every class this compiler writes carries — fixed, never configurable. */
const OURS = "r-";

/** The keys one key clears, in full — its own context put back in front of each longhand. */
function clearedBy(key: string): readonly string[] {
  const { important, context, property } = partsOf(key);
  let covered = CLEARS.get(property);
  if (covered === undefined) {
    // Kept where the next call finds it first: this runs for every class in every merge.
    covered = builtIn(property);
    CLEARS.set(property, covered);
  }
  // Importance back in front: an important shorthand clears the important longhands, and no others.
  const prefix = (important ? "!." : "") + context;
  return covered.length === 0 ? NONE : covered.map((one) => prefix + one);
}

/**
 * Whether a warning has already been said, so a render loop says it once.
 *
 * Dev only, and it never grows in a production build: nothing reaches it, because the only caller is
 * inside the guard below and a bundler that replaces `process.env.NODE_ENV` drops the branch and
 * everything it alone referenced.
 */
const said = new Set<string>();

/**
 * Forget what a process has been told, so a test starts from nothing.
 *
 * Exported for the tests and for nothing else — none of these is cleared at runtime. The warnings
 * are never cleared because saying each thing once is the point; the two registries are never
 * cleared because a module registers on load and is loaded once.
 */
export function forget(): void {
  said.clear();
  CLEARS.clear();
  CONDITIONS.clear();
  NAMES.clear();
}

/**
 * How strongly a key's CONDITIONS override, or `undefined` when the pair cannot be compared.
 *
 * Only a key whose module registered its conditions is answerable, and a module registers only
 * where there is a condition and NO selector. A selector adds specificity, which beats source order
 * on its own — so `&:hover { color: red }` against `@media { color: blue }` is settled by the
 * selector and not by the sheet, and comparing them would report correct CSS.
 *
 * A key with no context at all is slot 0, which is what an unconditional declaration is.
 */
function slotOf(key: string): number | undefined {
  const conditions = CONDITIONS.get(key);
  if (conditions === undefined) return partsOf(key).context === "" ? 0 : undefined;
  return conditions.split("|").every((one) => one.startsWith("@")) ? widthSlot([conditions]) : undefined;
}

/**
 * An override that composition asks for and the STYLESHEET will not honour, said out loud in dev.
 *
 * **The one hole the compiler cannot see.** Two declarations of one property under different
 * conditions are different keys, so the merge keeps both, both classes land, and the sheet breaks
 * the tie by how strongly each condition overrides — see `widthSlot`. Within one block
 * `override-out-of-order` reports where that contradicts the author's order. Across a SPREAD it
 * cannot: `...$(base)` is a runtime value, and the compiler does not know what is in it.
 *
 * Measured in Chromium, on the shape people write — a base carrying the theme and a modifier
 * adjusting it:
 *
 *     const base = @@( @media (prefers-color-scheme: dark) { color: white; } );
 *     const card = @@( ...$(base); @media (min-width: 40rem) { color: blue; } );
 *
 * With the modes ordered against breakpoints the way Tailwind orders them this one is right, and the
 * mirror of it — a base with the breakpoint, a modifier with the mode — is the one that loses. Either
 * way something loses silently, and only the runtime holds both blocks at once, so this is the only
 * place the question can be asked at all.
 *
 * Said once per pair, because a render loop would otherwise say it a thousand times.
 */
/**
 * A narrower shorthand composed after a wider one when both are WHOLE —
 * `narrower-after-a-whole-shorthand`, which the compiler refuses inside one block, for the blocks it
 * cannot see together.
 *
 * Both classes stay, because a narrower shorthand does not clear a wider one, and both sit in the
 * one word layer `v`: the answer follows which file the build read first. A class is whole when its
 * key is a shorthand's and it is not a split's marker (which ends in `-`) — read off the key, so a
 * value long enough to be hashed is found as well as a readable one.
 */
function warnAboutWholeShorthands(chosen: ReadonlyMap<string, string>): void {
  // `all` is not one: it has its own weaker layer, `a`, so whatever follows it wins.
  const whole = (key: string, className: string) =>
    className.startsWith(OURS) &&
    !className.endsWith("-") &&
    partsOf(key).property !== "all" &&
    clearedBy(key).length > 0;
  const entries = [...chosen];
  for (const [index, [key, className]] of entries.entries()) {
    if (!whole(key, className)) continue;

    const covered = new Set(clearedBy(key));
    for (const [laterKey, later] of entries.slice(index + 1)) {
      if (!covered.has(laterKey) || !whole(laterKey, later)) continue;
      const message =
        `[@ramonda/css] \`${later}\` is composed after \`${className}\`, and both reach the stylesheet ` +
        `whole, so no order keeps the later one winning on every page. Set its longhands instead.`;
      if (said.has(message)) continue;
      said.add(message);
      console.warn(message);
    }
  }
}

function warnAboutOrder(chosen: ReadonlyMap<string, string>): void {
  /** Property -> what was composed that SETS it, in composition order. */
  const byProperty = new Map<string, { key: string; property: string; slot: number }[]>();

  const register = (property: string, one: { key: string; property: string; slot: number }) => {
    const list = byProperty.get(property);
    if (list === undefined) byProperty.set(property, [one]);
    else list.push(one);
  };

  for (const key of chosen.keys()) {
    const slot = slotOf(key);
    if (slot === undefined) continue;

    // Grouped by importance too: between an important declaration and an ordinary one importance
    // decides, whatever their conditions, so the two are never compared.
    const { important, property } = partsOf(key);
    const one = { key, property, slot };
    const group = (name: string) => (important ? `!${name}` : name);
    register(group(property), one);

    /**
     * **And every longhand a SHORTHAND sets**, for every shorthand family.
     *
     * Grouped by the exact property name alone, `padding` and `padding-left` are never compared, so
     * a shorthand under a condition silently beats a longhand composed after it. Measured against
     * plain CSS in Chromium: `...{@media (min-width: 1px) { padding: 11px }}; padding-left: 4px`
     * computed 11px where hand-written CSS gives 4px.
     *
     * The clear-list is what answers it, for the same reason it does the clearing: a shorthand's
     * registration IS the list of longhands it sets. The context is stripped here, since the
     * question being asked is about two keys in DIFFERENT contexts.
     */
    for (const each of clearedBy(key)) {
      const sets = partsOf(each).property;
      if (sets !== property) register(group(sets), one);
    }
  }

  for (const [group, list] of byProperty) {
    // The group's name carries importance (`!c`); the message names the property itself.
    const property = group.startsWith("!") ? group.slice(1) : group;
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
      const later = nameOf(one.property === property ? property : one.property);
      const earlier = strongest.property === property ? "it" : `\`${nameOf(strongest.property)}\`, which sets it too,`;
      const message =
        `[@ramonda/css] \`${later}\` is composed later under \`${context(one.key)}\` than ` +
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

/** A key's conditions, for the message — as the module registered them. */
const context = (key: string): string => CONDITIONS.get(key) ?? "no condition";

/**
 * What a `match` chooses — the class its subject names, or the `_` arm, or nothing.
 *
 * ## Why nothing is a real answer
 *
 * A subject can hold a value no arm was written for: a type can be cast, data can arrive from a
 * server, a union can grow. When that happens **no declaration applies** — nothing comes back, the
 * merge skips it, and whatever was set above it stands. That is the same answer `when $(false)`
 * gives, and it is the reason an arm can be a class at all: every outcome was decided when the
 * block compiled, including the outcome of not matching.
 *
 * ## Why the table is built by the compiler
 *
 * Its keys are the arms as written and its values are their class names, both known at build time,
 * so the object is a constant in the emitted module. Nothing is allocated here and nothing is
 * remembered: this is a lookup, which is what makes a match cost a render nothing.
 */
export function pick(subject: unknown, arms: Readonly<Record<string, string>>, otherwise?: string): string | undefined {
  if (subject === null || subject === undefined) return otherwise;
  const found = arms[String(subject)];
  return found === undefined ? otherwise : found;
}

/**
 * Compose blocks: later wins, per thing set.
 *
 * **Named for what it merges, because `@ramonda/core` exports a `merge` of its own** — a deep
 * structural merge for state identity, `merge(previous, next, identity?)`. The two took the same
 * name from opposite ends, and the collision is silent rather than loud: `merge("lead", block)`
 * against core's signature typechecks clean (`previous` is `unknown`, `next` is `T`) and returns
 * `block`, dropping `"lead"` — measured on this repository, in `tsc` and at run time. A file that
 * imports from both packages is one line away from that, so the name says which merge this is.
 *
 * **This is the only place a call site can decide anything, and that is measured.** The order of
 * classes in a `class` attribute decides nothing — the stylesheet's order does, and with layers the
 * layer does — so two whole-block classes cannot express "this one wins". Keeping ONE class per
 * thing set means the merge picks which classes land, and there is never a tie to break.
 *
 * A falsy argument is a group that is switched off, which is what `disabled && block` compiles to,
 * and what a `match` naming no arm gives back.
 *
 * ## A shorthand clears its own longhands
 *
 * `padding` and `padding-left` are different properties, so a merge would keep both and the SHEET
 * would break the tie — measured in Chromium, and possibly against the call site. So this does what
 * CSS's own cascade does. The other direction needs nothing: the sheet emits longhands after
 * shorthands, so a longhand written later already wins.
 *
 * **Associative**, which is what makes a nested `when` mean the same as a flattened one — and it is
 * the property the clearing rule could have broken, since clearing removes keys rather than
 * replacing them. Measured over 50,301 random groupings drawn from one shorthand family: zero
 * disagreements.
 */
export function mergeClassNames(...parts: readonly (string | false | null | undefined)[]): StyleValue {
  /** Insertion-ordered, which is what keeps the classes in the order they were composed. */
  const chosen = new Map<string, string>();
  /** How many parts actually arrived, for the dev warning below. */
  let given = 0;

  for (const part of parts) {
    if (!part) continue;
    given++;

    for (const className of part.split(" ")) {
      if (className === "") continue;
      /**
       * **A class this compiler did not write keys on ITSELF**, and that is not caution.
       *
       * `mergeClassNames("lead", @@( … ))` is how a block goes beside a class of the author's own
       * now that `className` is where a block lands, so a foreign name reaching here is ordinary
       * rather than a misuse. `keyIn` reads the key out of OUR spelling — everything between `r-` and the first
       * `-` — and on a name that is not ours it reads letters: measured, `lead` and `head` both come
       * to `ad`, so one would have silently displaced the other.
       *
       * Keyed on itself **behind a space**, which no key of ours can hold: a class attribute is
       * whitespace-separated, so a space in a key is a thing a class name cannot be. Without it a
       * class literally named `pl` was cleared by a `padding` beside it — measured, and it is the
       * same coincidence one step along.
       *
       * Keyed that way a foreign class displaces nothing, clears nothing, and dedupes with an
       * identical one. The prefix is fixed and not configurable — see `CONTRACT.md` §3 — which is
       * what makes this test exact rather than a guess.
       */
      const key = className.startsWith(OURS) ? keyIn(className) : ` ${className}`;

      for (const cleared of clearedBy(key)) chosen.delete(cleared);
      // Deleted first, so a key set twice moves to where it was set LAST rather than staying where
      // it was set first — which is what "later wins" means for the order the classes come out in.
      chosen.delete(key);
      chosen.set(key, className);
    }
  }

  /**
   * Only when more than one part was composed. A single block's contradictions are the compiler's
   * to report, at the author's own line, and it does — this exists for what a spread hides.
   */
  /**
   * Whether this is a development build, spelled so that nothing breaks where nobody defines it —
   * and spelled out HERE, as a ternary, because both are measured. A bundler replaces
   * `process.env.NODE_ENV` and a minifier is then expected to drop this branch. Vite 8's does not
   * inline a function that returns a constant, and does not fold `typeof process < "u" && false`;
   * with either spelling the warning, its words and its slot table stayed in a production bundle.
   * Asked on each call rather than once, so a test can switch `NODE_ENV`.
   */
  if (given > 1 && (typeof process === "undefined" ? false : process.env?.NODE_ENV !== "production")) {
    warnAboutOrder(chosen);
    warnAboutWholeShorthands(chosen);
  }

  let className = "";
  for (const one of chosen.values()) className = className === "" ? one : `${className} ${one}`;
  return className as StyleValue;
}
