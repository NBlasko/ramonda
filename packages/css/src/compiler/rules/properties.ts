/** Rules about a declaration's PROPERTY: a name CSS does not have, a prefix, its spelling, where it stands. */

import { canonicalPrelude } from "../normalise";
import { PREFIXED } from "../prefixed.generated";
import { type Declaration } from "../ast";
import { nearest } from "../nearest";
import { DESCRIPTORS, PROPERTIES } from "../keywords.generated";
import { KNOWN, type Block, type NestedRule, rulesIn } from "./shared";
import { type Finding } from "./index";

/**
 * Whether two spellings differ only in CASE — in which case nothing is reported, and the FORMATTER
 * is what settles it.
 *
 * Found in review pass 3, by asking what the checker says about correct CSS: it reported
 * `color: currentColor`, the spelling MDN documents and very nearly everybody writes. Every rule is
 * an error, so that is a failed build. The forty `<system-color>` names went with it — `Canvas`,
 * `ButtonFace`, `AccentColor` — each spelled here exactly as the specification prints them.
 *
 * ## What the rest of the ecosystem does, measured
 *
 * `csstype` is the shared type behind emotion, styled-components, vanilla-extract and StyleX, and
 * its colour is:
 *
 *     type Color = ColorBase | SystemColor | DeprecatedSystemColor | "currentColor" | (string & {});
 *
 * It lists `currentColor` in capitals outright, keeps the spec's case for the system colours, and
 * ends with an escape hatch that admits any string — 529 of those in the file. So none of them can
 * report a case at all. We were the only tool failing a build on it.
 *
 * ## The canonical form does NOT change
 *
 * `keywords CSS spells with capitals` measured Chrome: `ButtonText` in, `"buttontext"` out, and the
 * same for `currentColor`. Lower case is what the browser does to the value anyway, so it stays
 * what the normaliser writes and what the class is built from.
 *
 * ## Why the REPORT goes, and it is not that the ecosystem is laxer
 *
 * The rule's own justification is *one spelling is what lets two blocks agree on one class* — and
 * measured, `canonicalValue` gives the same string for either case already. Identity never depended
 * on the author being told.
 *
 * And the refusal was never argued for. The note above `a keyword written in capitals` says *the
 * verdict does not change — it is still refused — but the REASON becomes true*: the verdict was
 * carried over from when this was `unknown-value`, which was a false report. Nobody decided that
 * correct CSS should fail a build; it was inherited from a bug.
 *
 * **`ramonda-css format` still rewrites every one of them**, which is the user's own condition for
 * this — *"neka formater obavezno to resava"* — and `toolingCli.test.ts` holds it to that through
 * the real biome, on a value, a pseudo-class, an at-rule name and a media feature at once.
 *
 * A difference that is MORE than case is still reported, because it is a real one: `&:before` is a
 * pseudo-element written with a pseudo-class's colon, and `2n + 1` is not spelled `2n+1`.
 */
export function onlyCase(written: string, canonical: string): boolean {
  return written.toLowerCase() === canonical.toLowerCase();
}

export function spelling(block: Block, findings: Finding[]): void {
  for (const item of rulesIn(block)) {
    if (item.at === undefined) continue;

    const written = item.prelude.trim();
    const canonical = canonicalPrelude(written);
    if (canonical === written || onlyCase(written, canonical)) continue;

    findings.push({
      rule: "non-canonical-spelling",
      at: item.at,
      length: item.prelude.length,
      message:
        `write this as \`${canonical}\` — the two are the same CSS, and one spelling is what lets a ` +
        `declaration here override the same one written elsewhere. \`ramonda-css format\` fixes it.`,
    });
  }
}

/**
 * The prefixes that have names, read off {@link PREFIXED} rather than written out.
 *
 * Hard-coding them was wrong in both directions and both were measured. `-o-` was in the list and no
 * engine has a single `-o-` name left — Presto has been gone since 2013 — and `-apple-` was NOT in
 * it, while WebKit has two (`-apple-pay-button-style`, `-apple-pay-button-type`), so a real property
 * was reported as an unknown prefix.
 *
 * Derived, there is one source for both halves of the question and they cannot drift apart. Measured
 * today: `-webkit-` 182, `-ms-` 48, `-moz-` 30, `-apple-` 2.
 */
export const PREFIXES = [...new Set(PREFIXED.map((one) => /^(-[a-z]+-)/.exec(one)?.[1] ?? one))].sort();

/**
 * A NAME THAT LOOKS PREFIXED AND IS NOT, which passed in silence.
 *
 * `unknown-property` returned early for every name starting with `-`, and the generator says why:
 * "each one a name nobody misspells into a different property". Found by somebody typing
 * `-wdasdsdebkit-line-clamp: 3` — it compiled, it shipped, and it did nothing.
 *
 * **A list of valid prefixed NAMES would be the wrong repair, and that was measured.** MDN's data
 * holds a hundred of them and does not hold `-webkit-font-smoothing` or `-moz-osx-font-smoothing`,
 * which are two of the most-written lines in real CSS. Reporting those would be refusing valid CSS,
 * which is the one failure this package may not have — so the name after the prefix is not checked,
 * and cannot be.
 *
 * The prefix itself is a different question and is answerable. What is left unreported is a real
 * prefix on a name no browser has, which is the same trade CSS itself makes: a declaration a browser
 * does not understand is dropped, and that is what a prefix is for.
 */
function unknownPrefix(item: Declaration, findings: Finding[]): void {
  const name = item.property;
  // `--anything` is a custom property, which is the author's own name and always valid.
  if (name.startsWith("--")) return;

  const cut = name.indexOf("-", 1);
  const prefix = cut === -1 ? name : name.slice(0, cut + 1);

  if (!PREFIXES.includes(prefix)) {
    const meant = nearest(prefix, PREFIXES);
    findings.push({
      rule: "unknown-prefix",
      at: item.at ?? 0,
      length: name.length,
      message:
        `\`${name}\` begins with a dash, so it is a vendor-prefixed property — and \`${prefix}\` is not ` +
        `one of the four prefixes there are: ${PREFIXES.join(", ")}. ` +
        (meant === undefined
          ? "A custom property takes two dashes: `--name`."
          : `Did you mean \`${meant}${name.slice(prefix.length)}\`?`),
    });
    return;
  }

  /**
   * **The NAME after the prefix, which passed while only the prefix was checked.** Found by somebody
   * typing `-webkit-border-before-coloaasdsdr: "asdasdsadsd"` and watching it compile.
   *
   * A list of valid names was refused once, on the grounds that `mdn-data` holds 99 and has neither
   * `-webkit-font-smoothing` nor `-moz-osx-font-smoothing`, so a list built from it would refuse
   * lines people write every day. That measurement was right and the conclusion was not: the ENGINES
   * keep their own lists, and asked directly they give 262 names between them — with
   * `-webkit-font-smoothing` in all three of them. See `scripts/build-prefixed-properties.mjs`.
   *
   * A name an engine adds after that script was last run is refused until it is run again. That is
   * the cost, it is real, and `ramonda-css-ignore <reason>` is the escape for exactly this shape.
   */
  if (PREFIXED.includes(name)) return;

  const meant = nearest(name, PREFIXED);
  findings.push({
    rule: "unknown-property",
    at: item.at ?? 0,
    length: name.length,
    message:
      `\`${name}\` is not a property Chromium, Firefox or WebKit has. ` +
      (meant === undefined
        ? "A vendor-prefixed name is a browser's own, so this one belongs to none of them."
        : `Did you mean \`${meant}\`?`),
  });
}

/**
 * A property name CSS does not have.
 *
 * **It was DASHED names only, and the build compiled the rest.** The split was half right: a dashed
 * name cannot be an unquoted object key and a quoted key gets no *did you mean* — measured — while
 * a bare name gets `TS2561`, which says it better. But it says it better in the CHECKER. Vite and
 * esbuild run these rules and no TypeScript at all, so `dsiplay: flex` and even `zzz: flex` reached
 * the stylesheet with nothing said anywhere. Found in review pass 6, by asking both consumers the
 * same question about the same file.
 *
 * So it speaks for both now, and `inOrder` drops the compiler's word on the line — the arrangement
 * `unknown-token` and `variablesOnly` already have. A name with no near miss is reported too,
 * without a suggestion: the types are not there to say it in the build.
 */
export function unknownProperty(item: Declaration, findings: Finding[], body?: string): void {
  const name = item.property;
  if (item.at === undefined) return;
  // A custom property is the author's, and a vendor-prefixed name is a browser's — neither is in
  // CSS's own list. The PREFIX is checked separately; see `unknownPrefix`.
  if (name.startsWith("-")) {
    unknownPrefix(item, findings);
    return;
  }
  /**
   * It has to LOOK like a property name, and the dash test was doing this by accident.
   *
   * Dropping that guard so the build sees a plain typo exposed every shape the parser records as a
   * declaration without one being there — a spread comes through as `... 0 `, and forty-one tests
   * went red at once saying it is not a CSS property. True, and not a thing to report.
   */
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name)) return;

  /**
   * Inside a named block the vocabulary is that at-rule's descriptors, and only those: `src` is not
   * a property and `font-family` in a `@font-face` is not the property of the same name. An at-rule
   * with no table gets no report at all, which is the safe direction — the types still have it.
   */
  const among = body === undefined ? PROPERTIES : DESCRIPTORS[body];
  if (among === undefined || among.includes(name)) return;
  if (body === undefined && KNOWN.has(name)) return;

  /**
   * A name whose only fault is its CASE is the same CSS, and `unknownValue`'s note already settled
   * what to do about that: *saying it does not exist is a lie the author cannot act on.* That was
   * applied to a value's keywords and not to the name beside them.
   *
   * Measured in Chromium, Firefox and WebKit: `COLOR: red` sets `color` to red in all three, and
   * `CSS.supports("COLOR", "red")` is true in all three. So the verdict is the one that half
   * reached — still refused, because a repository wants one spelling, and `non-canonical-spelling`
   * is the id whose formatter rewrites it.
   *
   * **Before `nearest`, and that is not an ordering detail.** A distance measured in substitutions
   * puts `COLOR` five away from `color`, so a mis-cased name got `is not a CSS property` with no
   * suggestion at all — the least useful message of the two.
   */
  const lowered = name.toLowerCase();
  if (lowered !== name && (body === undefined ? KNOWN.has(lowered) : among.includes(lowered))) {
    findings.push({
      rule: "non-canonical-spelling",
      at: item.at,
      length: name.length,
      message:
        `\`${name}\` and \`${lowered}\` are the same property to a browser. Write \`${lowered}\`, which ` +
        `is the spelling this project uses — \`ramonda-css format\` does it for you.`,
    });
    return;
  }

  /**
   * The near miss is measured against the LOWER-CASED name, so a typo shouted still gets one.
   *
   * `DSIPLAY` is six substitutions from `display` and none from `dsiplay`, so it came back with no
   * suggestion while the same typo in lower case got one. The name in the message stays as the
   * author wrote it.
   */
  const meant = nearest(lowered, among);
  const said = meant === undefined ? "" : ` Did you mean \`${meant}\`?`;

  findings.push({
    rule: "unknown-property",
    at: item.at,
    length: name.length,
    message:
      body === undefined
        ? `\`${name}\` is not a CSS property.${said}`
        : `\`${name}\` is not a \`@${body}\` descriptor.${said}`,
  });
}

/**
 * A property name holding whitespace, which no CSS identifier may.
 *
 * **The class name survives it and the DECLARATION does not.** `nameFor` falls to the hash for such
 * a name, so the stylesheet parses — but the rule it emits still says `--a b: red`, which no browser
 * accepts, so an element carrying the class gets nothing. A review found the naming half; this is the
 * half that tells the author.
 *
 * Nothing reported it before. `unknown-property` returns early for a name starting with `-` and for
 * one with no `-` at all, so both of the shapes an author actually writes walked past it: two words
 * where one belongs, and a name wrapped across lines — which is also what a missing `;` looks like
 * from here.
 *
 * The dashed form is suggested only when it IS a property, because a suggestion that is not one
 * would be a guess dressed as an answer.
 */
export function propertyNotAName(item: Declaration, findings: Finding[]): boolean {
  const name = item.property;
  if (item.at === undefined || !/\s/.test(name)) return false;
  // A spread is not a property and carries no name — see `isSpread`, and the parser's own note.
  if (name.startsWith("...")) return false;
  /**
   * A `//` comment, which CSS does not have and `line-comment` reports from the TEXT pass. The
   * parser reads one as a property name, and it is a name full of whitespace — so this would say
   * *`// why color` is not a property name* beside a diagnostic that already explains the real
   * fault. The two passes cannot see each other's findings, so the skip is here.
   */
  if (name.trimStart().startsWith("//")) return false;

  const dashed = name.trim().replace(/\s+/g, "-");
  const real = KNOWN.has(dashed) || dashed.startsWith("--");

  findings.push({
    rule: "property-not-a-name",
    at: item.at,
    length: name.length,
    message:
      `\`${name.trim().replace(/\s+/g, " ")}\` is not a property name — a CSS name holds no whitespace, so ` +
      `the browser drops the declaration.` +
      (real ? ` Did you mean \`${dashed}\`?` : " A `-` between the words, or a `;` missing above this line."),
  });
  return true;
}

/**
 * A declaration written straight into a `@keyframes` body, outside any frame.
 *
 * The same index signature accepts it, and the browser does not: a declaration at that level belongs
 * to no time, so it is dropped and the animation is missing whatever it said.
 */
export function declarationOutOfPlace(item: Declaration, findings: Finding[]): void {
  findings.push({
    rule: "declaration-out-of-place",
    at: item.at ?? 0,
    length: item.property.length,
    message:
      `\`${item.property}\` is not inside a frame. A \`@keyframes\` block holds frames — \`from\`, \`to\`, ` +
      `a percentage — and a declaration outside one belongs to no time, so the browser drops it.`,
  });
}

/**
 * A nested rule inside a body that holds descriptors.
 *
 * `@font-face` and `@property` are a flat list of descriptors: there is no element to select against
 * and nothing for a nested rule to mean. The types report the KEY as one no descriptor has, which is
 * true but reads as a spelling question; this says what is actually wrong with it.
 */
export function ruleOutOfPlace(rule: NestedRule, atRule: string, findings: Finding[]): void {
  findings.push({
    rule: "rule-out-of-place",
    at: rule.at ?? 0,
    length: rule.prelude.trimEnd().length,
    message:
      `\`${rule.prelude.trim()}\` cannot go here. A \`@${atRule}\` block is a flat list of descriptors — ` +
      `there is no element to select against, so a nested rule has nothing to apply to.`,
  });
}

/**
 * The same property declared twice with the SAME value, which says nothing either way.
 *
 * **Only when the value matches, and that narrowing is the whole rule.** Two declarations of one
 * property with DIFFERENT values is a deliberate idiom — a fallback for an engine that will drop the
 * second, `width: 100px; width: fit-content;`. Reporting it would be reporting a technique, which is
 * how a checker earns being switched off.
 */
export function repeated(item: Declaration, seen: Map<string, string>, findings: Finding[]): void {
  // A hole makes two declarations different whatever the text says: the values are decided at
  // render, and nothing here knows they will agree.
  if (item.value.some((part) => part.kind === "hole")) {
    seen.delete(item.property);
    return;
  }

  const value = item.value
    .map((part) => (part.kind === "text" ? part.text : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  if (seen.get(item.property) === value && item.at !== undefined) {
    findings.push({
      rule: "repeated-declaration",
      at: item.at,
      length: item.property.length,
      message: `\`${item.property}\` is already set to \`${value}\` in this block. The first one can never apply.`,
    });
  }

  seen.set(item.property, value);
}
