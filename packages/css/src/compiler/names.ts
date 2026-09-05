import { createHash } from "node:crypto";
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
 * The length only decides whether that assertion ever fires — and firing is expensive, because the
 * name is already written into the emitted JavaScript by then. So it is set to make the assertion a
 * tripwire that never trips: **64 bits**, which at 100,000 rules gives 2.7e-10.
 *
 * ## Why base62 rather than hex, and why the width rather than the bits
 *
 * Bytes were never the reason to be short — measured, 8, 12 and 16 hex all gzip to the same 46.7 KB,
 * because the name is the part that repeats. **Reading is the reason.** A block is one class per
 * DECLARATION now, so an element carries three or four of these and a complicated one carries
 * twenty-eight, and eighteen characters each is a wall of noise in the markup.
 *
 * A wider alphabet is the answer that costs nothing: the same 64 bits need 16 hex characters, 13 in
 * base36, and **11 in base62**. So the class is `r-` plus 11 rather than `r-` plus 16 — 13 characters
 * against 18, with the same tripwire. Reducing the BITS would have been the other way to shorten it,
 * and it is the one that trades the guarantee away.
 *
 * Case matters and is safe: a class attribute is matched case-sensitively in standards mode, and a
 * custom property name is case-sensitive in CSS itself — which is also why `normalise` keeps the case
 * of one the author writes.
 */
export const HASH_BITS = 64;

/** How many base62 characters those bits need. `Math.ceil(64 / Math.log2(62))`. */
export const HASH_LENGTH = 11;

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
  // The first 64 bits, as one number, so the encoding below is a base change and not a re-hash.
  let left = digest.readBigUInt64BE(0);

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
