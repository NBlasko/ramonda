import { createHash } from "node:crypto";
import { ABBREVIATIONS } from "./keywords.generated";
import { HOLE } from "./normalise";

/**
 * The names, which are the only thing two independent builds have to agree on.
 *
 * A server build and a client build never speak to each other. Each hashes its own copy of the
 * source and both write the result into markup that has to match, so a name may depend on the
 * normalised text and on nothing else — no counter, no file path, no order of compilation. Get that
 * wrong and the failure is a hydration mismatch on a page that renders correctly in isolation.
 */

/**
 * How many base62 characters of the hash the class carries.
 *
 * **The length guarantees nothing, and it is worth saying plainly.** Two different blocks landing
 * on the same name is a birthday problem, and probability is not a promise. The guarantee is the
 * assertion made where the sheet is assembled, which sees every block at once and can check that no
 * two distinct ones share a name. The length only decides whether that assertion ever fires — and
 * **firing is a failed build with both files named, not a wrong page**, which is what lets this be
 * short.
 *
 * So the WIDTH is chosen and the bits follow from it: **nine base62 characters**, which is 53.6
 * bits. At 10,000 atomic rules the chance of a collision is 3.7e-9; eight characters would be
 * 4.2e-7, still fine; seven would be 2.7e-5, which is where it stops being safe. The number is
 * reduced INTO the width rather than truncated to some bit count, so all nine characters are used —
 * 48 bits written in nine characters would almost always begin with a `0`, which carries nothing
 * and reads as noise.
 *
 * ## Why base62
 *
 * Bytes are not the reason to be short — measured, 8, 12 and 16 hex all gzip to the same 46.7 KB,
 * because the name is the part that repeats. **Reading is the reason.** A block is one class per
 * DECLARATION, so an element carries several of these, and a wider alphabet is free: 53.6 bits are
 * nine base62 characters, eleven in base36, fourteen in hex.
 *
 * The `r-` is kept: it is what says a class was generated, and it is what keeps a generated name
 * from ever being an author's own.
 *
 * Case matters and is safe: a class attribute is matched case-sensitively in standards mode, and a
 * custom property name is case-sensitive in CSS itself — which is also why `normalise` keeps the
 * case of one the author writes.
 */
export const HASH_LENGTH = 9;

/** What that width carries: `Math.log2(62 ** 9)`, to one decimal. */
export const HASH_BITS = 53.6;

/** The space the hash is reduced into, so every one of the nine characters is used. */
const SPACE = 62n ** BigInt(HASH_LENGTH);

/** Digits, lower case, upper case — every character a CSS ident may hold after the first. */
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * What a NAMED site compiles to — the name the stylesheet uses for it.
 *
 * Two of the three are named by their BODY and nothing else, and that is right: two `@@keyframes`
 * with the same steps are the same animation, and two `@@font-face` with the same `src` are the
 * same face. Identical ones anywhere in a build collapse to one rule, which is the property the
 * whole design rests on.
 *
 * **A `@@property` is not like them.** A keyframes is a VALUE; a registered custom property is a
 * place to keep one. Two registrations that read the same are still two variables, the way `let x =
 * 0; let y = 0;` is two variables — so the author's own BINDING is part of what names it. Named by
 * body alone, two tokens declared side by side with the same `syntax`, `inherits` and
 * `initial-value` — the ordinary shape of a palette — got one name, the emitted literal held a
 * DUPLICATE KEY, and `color: var({accent})` read the other token's value. Nothing warned: the two
 * `@property` rules genuinely are identical, so the sheet's collision assertion cannot fire.
 *
 * The binding is stable across files, which is what keeps the dedupe promise: an import resolves to
 * the site in the module that DECLARES it, so `import { accent as brand }` still names `accent`'s
 * variable. Two modules declaring the same name with the same body are one variable, which is the
 * shared token they both meant.
 */
export function nameForSite(at: string, name: string, normalised: string): string {
  const hashed = classNameFor(at === "property" ? `${name}\u0000${normalised}` : normalised);
  /**
   * A `@property` registers a CUSTOM property, and a custom property is spelled with two dashes.
   * `@property r-… { … }` is not a rule any browser keeps, so the dashes are part of the name — in
   * the stylesheet, and in the string the site compiles to.
   */
  return at === "property" ? `--${hashed}` : hashed;
}

/**
 * What a named site's BINDING stands for — `$(brand)` in a block, `const brand` in code.
 *
 * The name of a `@@keyframes` or a `@@property` IS what other rules refer to, so it is the binding.
 * A `@@font-face` is different: what a block refers to is the `font-family` declared inside it, and
 * the hash is only the rule's identity (two faces of one family — two weights — are two rules).
 * With the hash as the binding, `font-family: $(brand)` asks for a family called `r-…` and the font
 * silently never loads. So the binding is the family, exactly as written.
 */
export function bindingForSite(at: string, name: string, normalised: string): string {
  if (at === "font-face") {
    const family = /(?:^|[;{])\s*font-family\s*:\s*([^;}]+)/i.exec(normalised)?.[1]?.trim();
    if (family !== undefined && family !== "") return family;
  }
  return nameForSite(at, name, normalised);
}

/**
 * `r-` plus the hash of the normalised block.
 *
 * The prefix is not decoration: a CSS class may not begin with a digit, and half of all hashes do.
 * It is also fixed rather than configurable, because a configurable prefix would mean two packages
 * emitting different names for the same block — and identical blocks deduplicating to one rule with
 * no registry and no coordination is the property the whole design rests on.
 */
export function classNameFor(normalised: string): string {
  const digest = createHash("sha256").update(normalised, "utf8").digest();
  // Reduced into the width rather than truncated to it: a truncation to 48 bits left the first of
  // the nine characters almost always `0`, because 2^48 is 2% of 62^9.
  let left = digest.readBigUInt64BE(0) % SPACE;

  let name = "";
  for (let index = 0; index < HASH_LENGTH; index++) {
    name = ALPHABET[Number(left % 62n)] + name;
    left /= 62n;
  }
  return `r-${name}`;
}

/**
 * `--<class>-<n>` — scoped to the block, never positional.
 *
 * Positional names (`--r0` for every block's first hole) have a failure that no test of either
 * component alone can find. A card that styles its own title through a nested rule and a title with
 * a block of its own both call their first hole `--r0`; the card's rule applies TO the title, and
 * `var(--r0)` resolves on the element the declaration applies to — so it finds the title's value and
 * the card's colour silently disappears. Neither component is wrong; only the pairing is.
 *
 * Scoping the name to the class removes the class of bug rather than the instance of it. Measured
 * cost: 5.3% gzipped at 10,000 instances. See DESIGN.md.
 */
export function variableNameFor(className: string, index: number): string {
  return `--${className}-${index}`;
}

/** A hole placeholder in the canonical text: the index, delimited. */
const PLACEHOLDER = new RegExp(`${HOLE}(\\d+)${HOLE}`, "g");

/**
 * The canonical text with every placeholder replaced by the variable it stands for — the last step,
 * because it is the step that could not have happened earlier.
 *
 * The names are circular: the variable name comes from the class, the class from the hash, and the
 * hash from this text. Substituting before hashing would mean hashing a name that does not exist
 * yet. So the text is hashed with placeholders in it and the names go in afterwards, and this
 * ordering is also what the server and client builds are agreeing on when they agree on a name.
 */
export function substitute(normalised: string, className: string): string {
  return normalised.replace(
    PLACEHOLDER,
    (_match, index: string) => `var(${variableNameFor(className, Number(index))})`,
  );
}

/**
 * How long a readable name may be before the hash is the better answer.
 *
 * **Measured rather than chosen.** On the declarations the playground actually writes, 29 of 31 come
 * to 32 characters or fewer and the two above it are 61 and 69 — a `transition` with two parts each.
 * The cliff is where the budget is: everything ordinary stays readable and the outliers, which
 * nobody was going to read anyway, become a hash.
 */
export const NAME_BUDGET = 32;

/**
 * The characters a value may hold and still be written into a class name.
 *
 * Conservative on purpose, and the direction is chosen: a character left out costs a hash, which is
 * always correct, while one wrongly let in is a class attribute or a selector that does not parse.
 * A space is not here because it is rewritten as `_` before this is asked.
 */
const SAFE_VALUE = /^[a-zA-Z0-9#.,%()/_+*=<>:;!&|~^$?@[\]{}-]+$/;

/**
 * The characters a PROPERTY NAME may hold and still be written into a class name.
 *
 * What it costs to skip is not cosmetic. `readHead` keeps a name's interior whitespace, and nothing
 * above here refuses it, so `--brand` wrapped across two lines — which is what a missing `;` looks
 * like — would produce a class name holding a newline. Emitted as a selector that is a `\` followed
 * by a newline, which is **not a valid escape**: measured, css-tree, lightningcss and jsdom all
 * refuse it, so a browser drops the rule and a lightningcss step throws on the whole stylesheet.
 *
 * A space or a tab is milder and still broken. The selector then names one class containing
 * whitespace, while the markup's `class` attribute tokenises into two — so the rule matches nothing
 * that exists.
 *
 * Exactly what a CSS identifier may hold, and no more: letters, digits, `-`, `_`, and anything
 * outside ASCII. Everything else falls to the hash, which is always correct.
 */
const SAFE_PROPERTY = /^[a-zA-Z0-9_\u00a1-\uffff-]+$/;

/**
 * A class name a person can read, or the hash when one cannot be written.
 *
 * `r-<abbreviation>-<value>`, with the value **verbatim** and spaces as `_`. Verbatim is what makes
 * it lossless, and lossless is what makes it safe: stripping the characters a class name cannot hold
 * was measured to merge `opacity: .5` with `opacity: 5`, two rules into one, which is the worst
 * failure this package has.
 *
 * **The hash is the FLOOR, not the default.** It answers for a declaration carrying a hole, a name
 * over {@link NAME_BUDGET}, and anything — a property, a value or a context — holding a character
 * that cannot be written. So a form not yet covered is always correct and merely less pretty, which is what lets
 * the readable half grow one context at a time rather than in one commit.
 *
 * **The two forms can never collide, structurally rather than by luck.** A hash is base62, which has
 * no `-`, so a hashed name holds none after the prefix; a readable name always holds the one that
 * separates the property from the value. And two readable names differ whenever their declarations
 * do, because the abbreviation map forbids a `-` inside an abbreviation — so the first `-` always
 * ends it, and `p` with the value `l-40px` cannot be read as `pl` with `40px`.
 *
 * The same argument covers CONTEXT: every context form starts with a character an abbreviation
 * cannot — `:`, `.`, `_`, `@`, `[`, and `!` for importance — so a name carrying one can never be read
 * as a name without.
 *
 * ## Why a resolved reference keeps its hash in the name
 *
 * `color: var({accent})` names itself `r-c-var(--r-6lbmZbNkr)`, which is a written name with a hash
 * inside it, and the binding is right there — so `r-c-accent` looks free. It is not: a class must be
 * a function of the RULE, and a binding name is not one. Two files that each declare a `@@property`
 * called `accent`, with different descriptors, generate different custom properties — and both would
 * then want `r-c-accent` for two different rules. The collision assertion fails the build rather than
 * corrupting a page, but a build that fails is not an improvement. The hash in that name IS the
 * identity.
 */
export function nameFor(declaration: {
  property: string;
  canonical: string;
  identity: string;
  selector: string;
  conditions: readonly string[];
  holes: readonly number[];
  /** Whether it is `!important` — part of the key, see `keyToken`. */
  important?: boolean;
}): string {
  const key = keyToken(declaration);
  /**
   * The VALUE falls to a hash on its own, and the key stays whatever it was.
   *
   * The key is what a merge reads, so it can never be given up; and once it is kept anyway, keeping
   * the property readable beside an unreadable value costs nothing.
   */
  const hash = () => `r-${key}-${shortHash(declaration.identity, HASH_LENGTH)}`;

  // From the canonical text rather than from anywhere else, so the name and the rule cannot disagree
  // about what the value is.
  const colon = declaration.canonical.indexOf(":");
  const spelled = declaration.canonical.slice(colon + 1).replace(/;$/, "");
  const value = spelled.replace(/ /g, "_");
  if (value === "" || !SAFE_VALUE.test(value)) return hash();
  /**
   * A `_` the AUTHOR wrote, refused for the same reason `contextOf` refuses one: the space became a
   * `_` on the line above, and `_` is a character a value may already hold — so the encoding is not
   * injective and two different values can claim one class.
   *
   * Found by fuzzing the name against the identity: `font-family: My_Font` and `font-family: My
   * Font` are two different families and would be one class; so would `grid-area: a_b` against
   * `grid-area: a b`.
   *
   * Tested BEFORE the spaces are folded, so it is the author's underscore being asked about.
   */
  if (spelled.includes("_")) return hash();

  const name = `r-${key}-${value}`;
  return name.length > NAME_BUDGET ? hash() : name;
}

/**
 * A class name as a SELECTOR holds it, which is not how the markup holds it.
 *
 * A class attribute takes anything but whitespace, so `r-c-#fff` goes into the markup as it is. A
 * selector does not: `#` starts an id, `.` starts another class, `(` opens a function — so
 * `.r-c-#fff` would parse as `.r-c` followed by `#fff` and match nothing the markup carries. Each of
 * them takes a `\` in front of it.
 *
 * What is left alone is what an identifier may already hold: letters, digits, `_`, `-`, and anything
 * outside ASCII, which CSS treats as an identifier character.
 *
 * Both minifiers were measured to keep these: esbuild and lightningcss.
 */
export function escapeClass(className: string): string {
  return className.replace(/[^a-zA-Z0-9_\u00a0-\uffff-]/g, (character) => `\\${character}`);
}

/**
 * A selector list, which is two selectors sharing a body rather than one context.
 *
 * `&:hover, &:focus` names two states and there is no single spelling for it — so it is left to the
 * hash rather than given a name that reads like one thing and is two.
 */
const A_LIST = /,/;

/** What a context may hold and still be written. Quotes are out: markup would have to escape one. */
const SAFE_CONTEXT = /^[a-zA-Z0-9@:.[\]()=_ -]+$/;

/**
 * The context a declaration sits in, written for a class name — or nothing, when it cannot be.
 *
 * **Literal, and that was decided rather than defaulted to.** A short name from a design scale —
 * `md-` for `@media (min-width: 40rem)` — is exactly the magic the hash is being replaced for, and
 * there is no scale here to be short against. So it is the author's own text with its whitespace
 * collapsed, and a name that grows past {@link NAME_BUDGET} becomes a hash like any other.
 *
 * **Every form starts with a character an abbreviation cannot** — `:` a pseudo-class, `.` a class,
 * `_` a descendant, `@` a conditional at-rule, `[` an attribute — which is what keeps a name with a
 * context from ever reading as a name without one. The descendant marker matters twice over:
 * `& .title` and `&.title` are different selectors, and `_` is what keeps them different names.
 */
function contextOf(selector: string, conditions: readonly string[]): string | undefined {
  /**
   * The conditions joined, then the selector appended VERBATIM — never joined to them.
   *
   * A selector carries its own leading space when it is a descendant, and that space is the whole
   * difference between `& .title` and `&.title`. Joining with one would have added it to the
   * compound form too, and `@media print` with `.title` would have become the same name as
   * `@media print` with ` .title` — two different rules, one class.
   */
  /**
   * The selector's own text, with the leading `&` taken off — that `&` is where the class goes, and
   * the class is what the name is being built for. A `&` ANYWHERE ELSE cannot be written literally
   * (`.parent &` would have to name the class inside itself), so those fall to the hash.
   */
  const own = selector.startsWith("&") ? selector.slice(1) : selector;
  if (own.includes("&")) return undefined;

  const written = `${conditions.join(" ")}${own}`.replace(/\s+/g, " ");
  if (written === "") return "";
  if (A_LIST.test(written) || !SAFE_CONTEXT.test(written)) return undefined;
  /**
   * A `_` the AUTHOR wrote, which is what the space becomes below — so a text already holding one
   * cannot be written and hashes instead.
   *
   * `& .a b` and `& .a_b` are different selectors and would both come out `r-_.a_b-c-red`, two
   * different rules claiming one class. No escaping makes the encoding injective while `_` stands
   * for a space and is also a character a selector may hold. Refusing costs one readable name; the
   * alternative costs a rule.
   */
  if (written.includes("_")) return undefined;

  /**
   * A `-` the AUTHOR wrote, which the KEY cannot hold — see {@link keyToken}.
   *
   * The key is everything up to the first `-` in the class name, so a context carrying one would
   * end the key in the middle of itself. Encoding it as `_` would not do either: `_` already stands
   * for a space, and `@media (min width)` against `@media (min-width)` would come out one string.
   *
   * It costs the contexts that matter most — `@media (min-width: 40rem)` is the ordinary one — so
   * those keep a readable PROPERTY and a hashed context rather than falling to the hash whole.
   */
  if (written.includes("-")) return undefined;

  // A leading space is a DESCENDANT and is what `_` stands for; every other space is inside the
  // text the author wrote and becomes one too, so nothing about the shape is lost.
  return written.replace(/ /g, "_");
}

/**
 * The class that goes in front of a split's pieces: the FAMILY's key and an EMPTY value, `r-p-`.
 *
 * It has no rule, so it sets nothing on a page. It is there for the merge, which reads a key out of
 * every class: this one says a whole shorthand was written here, so everything the family covers,
 * written earlier, is cleared before the pieces land. Without it the pieces clear only their own
 * keys, and two things are left standing that CSS would reset. Both measured in all three engines:
 *
 * - a longhand this release's split has no piece for — a package built before CSS added it;
 * - a class an older release wrote for the WHOLE property, when it was still a longhand — `overflow`
 *   before `overflow-x` and `overflow-y`. The key is the same, so the marker replaces it.
 *
 * **The empty value is what makes it recognisable**, and nothing else would: no declaration has an
 * empty value, while a class with no value at all is also what a named site compiles to. So a class
 * ending in `-` is a marker, always — which is how `check-css-splitting` tells it from a class
 * whose rule is missing.
 */
export function markerFor(family: string, selector: string, conditions: readonly string[], important = false): string {
  return `r-${keyToken({ property: family, selector, conditions, important })}-`;
}

/**
 * The KEY a class name carries: **what this declaration sets**, written into the name itself.
 *
 * ## Why a class has to carry it
 *
 * A merge keeps, per thing set, the one written later — and *the thing set* is the context and the
 * property together, never the value. While a block travelled as a MAP the key was the map's own
 * key and the class carried nothing. A block that travels as a string has only its classes, so the
 * key has to be in them or a merge across a component boundary cannot decide anything.
 *
 * ## Where it sits, and how it ends
 *
 * First, and it ends at the **first `-`** — so everything after that is the value's, wherever the
 * value happens to hold a `-` of its own (`-4px`, `sans-serif`, `a-b`). That is what the encodings
 * below are protecting: nothing inside a key may be a `-`.
 *
 * ## The four shapes, and why each is distinguishable from the others
 *
 * | | |
 * |---|---|
 * | `c` | no context; the property, written |
 * | `:hover.c` | a written context, a `.`, then the property |
 * | `0Ab3k.c` | a context that could not be written, hashed; the property still readable |
 * | `0Ab3kQ` | neither could be written, so the whole key is hashed |
 *
 * **A written key never begins with `0`**, because a CSS property cannot begin with a digit and
 * every context form begins with `:`, `.`, `_`, `@`, `[` or `!` (importance, which `partsOf` takes off
 * first). So the leading `0` says *hashed* and
 * cannot be mistaken for anything an author wrote. The `.` says where a hashed context ends: a
 * property may not hold one, so the LAST `.` is always the boundary.
 *
 * **It is injective by construction**, which is the whole of what a key owes. Two declarations get
 * one key only when their context and property are the same text — or when two hashes collide, and
 * that is asserted where the sheet is assembled, with both rules named. See `Sheet.add`.
 */
export function keyToken(declaration: {
  property: string;
  selector: string;
  conditions: readonly string[];
  important?: boolean;
}): string {
  /**
   * IMPORTANCE is part of what a class sets, written as one more context in front: `!.pl`.
   *
   * Without it an ordinary `padding-left` and an important one shared the key `pl`, so a merge let
   * the later replace the earlier — `padding: 1px !important; padding-left: 2px` gave 2px where CSS
   * gives 1px, inside one block. As a context it composes the way every context does: `!.p` clears
   * `!.pl` and not `pl`, so an important shorthand clears the important longhands before it and an
   * ordinary one clears none of them; two classes of different importance both stay, and the
   * mirrored `i` layer decides between them as CSS does.
   */
  const bang = declaration.important === true ? "!." : "";
  const property = writableProperty(declaration.property);
  const context = contextOf(declaration.selector, declaration.conditions);

  if (property === undefined) {
    return `${bang}0${shortHash(keyTextOf(declaration), 6)}`;
  }
  if (context === undefined) {
    return `${bang}0${shortHash(keyTextOf({ ...declaration, property: "" }), 5)}.${property}`;
  }
  return bang + (context === "" ? property : `${context}.${property}`);
}

/** The exact text a key stands for, which is what a hash of it has to be a function of. */
export function keyTextOf(declaration: { property: string; selector: string; conditions: readonly string[] }): string {
  return [...declaration.conditions, declaration.selector, declaration.property].join("|");
}

/**
 * A property name written into a key, with its `-` as `_`.
 *
 * A key may hold no `-` at all, and half of CSS's property names have one. The swap is injective
 * because a property name in practice holds no `_` — and where one does, the readable form is
 * refused rather than risked, which is the same answer `contextOf` gives an author's `_`.
 *
 * `--brand` becomes `__brand` and `-webkit-box-orient` becomes `_webkit_box_orient`, both of which
 * read as themselves. The ABBREVIATION is preferred wherever there is one, so the common properties
 * are a character or two.
 */
export function writableProperty(property: string): string | undefined {
  const written = ABBREVIATIONS[property] ?? property;
  if (!SAFE_PROPERTY.test(written) || written.includes("_")) return undefined;
  return written.replace(/-/g, "_");
}

/** A hash of the given width, in the same base62 alphabet the class hash uses. */
function shortHash(text: string, width: number): string {
  const digest = createHash("sha256").update(text, "utf8").digest();
  let left = digest.readBigUInt64BE(0) % 62n ** BigInt(width);

  let name = "";
  for (let index = 0; index < width; index++) {
    name = ALPHABET[Number(left % 62n)] + name;
    left /= 62n;
  }
  return name;
}
