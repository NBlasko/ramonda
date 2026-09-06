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
 * How many hex characters of the hash the class carries.
 *
 * **The length guarantees nothing, and it is worth saying plainly.** Two different blocks landing on
 * the same name is a birthday problem, and probability is not a promise. The guarantee is the
 * assertion made where the sheet is assembled, which sees every block at once and can check that no
 * two distinct ones share a name.
 *
 * The length only decides whether that assertion ever fires — and **firing is a failed build, not a
 * wrong page**, which is what lets this be short. The sheet sees every rule in a build at once, so a
 * collision is a loud stop with both files named; nothing silently ships.
 *
 * So the WIDTH is chosen and the bits follow from it: **nine base62 characters**, which is 53.6 bits.
 * Measured on the real playground the whole app has 56 atomic rules; at 10,000 the chance is 3.7e-9,
 * one build in two hundred and seventy million. Eight characters would be 47.6 bits and 4.2e-7,
 * still fine; seven would be 41.6 bits and 2.7e-5, which is where it stops being safe.
 *
 * **Choosing the width rather than the bits is not a detail.** Taking 48 bits and writing them in
 * nine characters wastes the first one — 2^48 is 2% of 62^9, so almost every name began with a `0`,
 * which is a character that carries nothing and reads as noise. The number is reduced into the width
 * instead, so all nine characters are used and all of them mean something.
 *
 * ## Why base62 rather than hex, and why the width rather than the bits
 *
 * Bytes were never the reason to be short — measured, 8, 12 and 16 hex all gzip to the same 46.7 KB,
 * because the name is the part that repeats. **Reading is the reason.** A block is one class per
 * DECLARATION now, so an element carries three or four of these and a complicated one carries
 * twenty-eight, and eighteen characters each is a wall of noise in the markup.
 *
 * A wider alphabet is free: 53.6 bits are nine base62 characters, eleven in base36, fourteen in hex.
 * So the class is `r-` plus nine — eleven characters against the eighteen this started at, and the
 * tripwire is still one nobody will ever see.
 *
 * The `r-` is two of those eleven and is kept: it is what says a class was generated, and it is what
 * keeps a generated name from ever being an author's own.
 *
 * Case matters and is safe: a class attribute is matched case-sensitively in standards mode, and a
 * custom property name is case-sensitive in CSS itself — which is also why `normalise` keeps the case
 * of one the author writes.
 */
export const HASH_LENGTH = 9;

/** What that width carries: `Math.log2(62 ** 9)`, to one decimal. */
export const HASH_BITS = 53.6;

/** The space the hash is reduced into, so every one of the nine characters is used. */
const SPACE = 62n ** BigInt(HASH_LENGTH);

/** Digits, lower case, upper case — every character a CSS ident may hold after the first. */
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

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
 * A class name a person can read, or the hash when one cannot be written.
 *
 * `r-<abbreviation>-<value>`, with the value **verbatim** and spaces as `_`. Verbatim is what makes
 * it lossless, and lossless is what makes it safe: stripping the characters a class name cannot hold
 * was measured to merge `opacity: .5` with `opacity: 5`, two rules into one, which is the worst
 * failure this package has.
 *
 * **The hash is the FLOOR, not the default.** It answers for a declaration carrying a hole, a name
 * over {@link NAME_BUDGET}, a value holding a character that cannot be written, and any CONTEXT —
 * a selector or a conditional at-rule — which the encoder does not yet spell. So a form not yet
 * covered is always correct and merely less pretty, which is what lets the readable half grow one
 * context at a time rather than in one commit.
 *
 * **The two forms can never collide, structurally rather than by luck.** A hash is base62, which has
 * no `-`, so a hashed name holds none after the prefix; a readable name always holds the one that
 * separates the property from the value. And two readable names differ whenever their declarations
 * do, because the abbreviation map forbids a `-` inside an abbreviation — so the first `-` always
 * ends it, and `p` with the value `l-40px` cannot be read as `pl` with `40px`.
 */
export function nameFor(declaration: {
  property: string;
  canonical: string;
  identity: string;
  selector: string;
  conditions: readonly string[];
  holes: readonly number[];
}): string {
  const hash = () => classNameFor(declaration.identity);

  if (declaration.holes.length > 0) return hash();
  if (declaration.selector !== "" || declaration.conditions.length > 0) return hash();

  // From the canonical text rather than from anywhere else, so the name and the rule cannot disagree
  // about what the value is.
  const colon = declaration.canonical.indexOf(":");
  const value = declaration.canonical
    .slice(colon + 1)
    .replace(/;$/, "")
    .replace(/ /g, "_");
  if (value === "" || !SAFE_VALUE.test(value)) return hash();

  const name = `r-${ABBREVIATIONS[declaration.property] ?? declaration.property}-${value}`;
  return name.length > NAME_BUDGET ? hash() : name;
}
