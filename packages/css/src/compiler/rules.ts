import type { Block, BlockItem, Declaration, NestedRule, ValuePart } from "./ast";
import { conflict, covers, flatten, sheetRank } from "./flatten";
import { holeOutOfPlace } from "./errors";
import { DESCRIPTORS, KEYWORDS, NOT_IN_A_RULE, PROPERTIES, PROPERTY_NAMED, UNITS } from "./keywords.generated";
import { closingHole } from "./read";
import type { BlockSite } from "./scan";

/**
 * The CSS checker: the faults the type map deliberately cannot catch.
 *
 * ## What is left to it, and every boundary was measured
 *
 * Each candidate was put through the real type check before a rule was written for it, so nothing
 * here repeats a diagnostic somebody already gets:
 *
 * | written | the types | here |
 * |---|---|---|
 * | `dsiplay: flex` | `TS2561`, **with** *did you mean* | — |
 * | `flex-dirction: row` | `TS2353`, **no suggestion** | `unknown-property` |
 * | `position: statik` | `TS2820`, with *did you mean* | — |
 * | `display: flexx` | **silent** | `unknown-value` |
 * | `border-left: 4px sollid red` | **silent** | `unknown-value` |
 * | `color: red; color: red` | **silent** | `repeated-declaration` |
 *
 * A bare property name is left to the types because they say it better. A dashed one is not, and the
 * reason is one character wide: a QUOTED object key gets no suggestion from TypeScript, and a dashed
 * name cannot be written unquoted.
 *
 * ## It may not import `@ramonda/check`
 *
 * The technique is shared; the code is not. A rule here reads a parsed `Block`, not a `ts.Program` —
 * there is no value to follow, no declaration to resolve, and nothing the other package's machinery
 * would help with.
 */

/** One thing worth saying about a block. */
export interface Finding {
  /** The rule's id, which is what a reader searches for. */
  readonly rule: RuleId;
  /** The author's own offset — of the FAULT, not of the block that holds it. */
  readonly at: number;
  /**
   * How much of the author's text the fault covers.
   *
   * An editor draws a squiggle from this, and a zero-width one is a mark nobody can see. It is the
   * offending text itself — the property name, the word in the value — never the whole declaration.
   */
  readonly length: number;
  /** What is wrong and what to write instead, in one sentence. */
  readonly message: string;
}

export type RuleId =
  | "unknown-property"
  | "unknown-value"
  | "repeated-declaration"
  | "hole-out-of-place"
  | "uncolourable-block"
  | "run-on-declaration"
  | "line-comment"
  | "unknown-unit"
  | "glued-hole"
  | "at-rule-out-of-place"
  | "unknown-frame"
  | "declaration-out-of-place"
  | "rule-out-of-place"
  | "override-out-of-order";

/** Accepted by every property, whatever else it accepts. */
const GLOBAL = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

/** The same list as a set, for the "does this exist" question rather than the "what was meant" one. */
const KNOWN = new Set(PROPERTIES);

/**
 * What an editor will not colour, which is the one thing here a BUILD has no business failing over.
 *
 * An editor stops consulting syntax injections the moment it enters a tag's attribute list, so a
 * bare `css=@@( … )` is coloured only as the FIRST attribute on the tag name's own line. Written
 * anywhere else it compiles, is checked, and looks like an error — with nothing on the screen to say
 * why, because what failed is a grammar nobody can see.
 *
 * So it is reported where it can be acted on and nowhere else: the editor plugin draws it as a
 * SUGGESTION. `checkBlock`'s findings stop a build; this one must not, because nothing is wrong.
 */
export function checkSite(source: string, site: BlockSite): Finding[] {
  if (!site.wrap || firstOnTheTagLine(source, site.start)) return [];

  return [
    {
      rule: "uncolourable-block",
      at: site.start,
      length: site.name.length,
      message:
        `an editor colours a bare block only as the first attribute on the tag name's own line — ` +
        `write it as \`${site.name}={@@( … )}\`, which is the same value and is coloured anywhere.`,
    },
  ];
}

/**
 * Whether the name at `start` follows the tag's own name with nothing but spaces between.
 *
 * A newline is enough to lose the colours, which is why this is not `isAttribute` with a flag: that
 * one walks over attributes and line breaks to prove the site is in a tag at all, and here both of
 * those are the answer NO.
 */
function firstOnTheTagLine(source: string, start: number): boolean {
  let index = start - 1;
  while (index >= 0 && (source.charCodeAt(index) === 32 || source.charCodeAt(index) === 9)) index--;

  const end = index + 1;
  while (index >= 0 && isTagNameCharacter(source.charCodeAt(index))) index--;

  return index >= 0 && end > index + 1 && source.charCodeAt(index) === 60; /* < */
}

/** A tag name: an identifier, plus the `.` of a member expression and the `-` of a custom element. */
function isTagNameCharacter(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 95 ||
    code === 36 ||
    code === 45 ||
    code === 46
  );
}

/**
 * What is true of the block's TEXT rather than of its parse.
 *
 * `//` is the whole of it, and it needs the text because the parser has no idea what a line comment
 * is — it reads the characters as part of a property name and hands them on. Measured end to end:
 * `// why` is written into the stylesheet verbatim, `.r-x{// why\n  color:red;}`, and a real CSS
 * compiler then refuses the WHOLE file with `SyntaxError: Unexpected token Semicolon`, naming
 * nothing about the block, the file or the line. A build that fails somewhere else entirely, for a
 * comment.
 *
 * A `//` inside a string or a function is text, not a comment — `url(https://example.com/a.png)` is
 * the case that matters, and `url(//cdn/a.png)` is the same without a scheme. Both are stepped over
 * whole, the same discipline every scanner in this package uses.
 */
export function checkText(source: string, open: number, end: number): Finding[] {
  const findings: Finding[] = [];
  let parens = 0;

  for (let index = open + 1; index < end; index++) {
    const code = source.charCodeAt(index);

    if (code === 34 /* " */ || code === 39 /* ' */) {
      index = endOfString(source, index);
      continue;
    }
    if (code === 47 /* / */ && source.charCodeAt(index + 1) === 42 /* * */) {
      const close = source.indexOf("*/", index + 2);
      index = close === -1 ? end : close + 1;
      continue;
    }
    if (code === 123 /* { */ && source.charCodeAt(index + 1) === 123) {
      // Not `indexOf("}}")`: a hole holds JavaScript, so an object literal inside one has its own —
      // see `closingHole`, which three scanners share for exactly this reason.
      const close = closingHole(source, index);
      index = close === -1 ? end : close + 1;
      continue;
    }
    if (code === 40 /* ( */) parens++;
    else if (code === 41 /* ) */) parens = Math.max(0, parens - 1);
    else if (parens === 0 && code === 47 && source.charCodeAt(index + 1) === 47) {
      findings.push({
        rule: "line-comment",
        at: index,
        length: 2,
        message:
          "CSS has no `//` comment — this and the rest of the line are written into the stylesheet, " +
          "and the build refuses the file. Write `/* … */`.",
      });
      // One per block: the rest of the line is already claimed, and a file full of them is one habit.
      return findings;
    }
  }

  return findings;
}

/**
 * A block's faults, and `at` is the at-rule it IS — `keyframes`, `font-face`, `property` — if any.
 *
 * A named site holds a different vocabulary, and passing the name is what keeps this from reporting
 * correct CSS: `src` is not a property, `from` is not a selector, and a body typed against the
 * properties would be wrong on every line. Most of a named body belongs to the TYPES, which know
 * each at-rule's own descriptors and say *did you mean* about them. What is left here is the two
 * faults a type cannot see, because both are about shape rather than about a name.
 */
export function checkBlock(block: Block, at?: string): Finding[] {
  const findings: Finding[] = [];
  walk(block.items, findings, at === undefined ? undefined : at.toLowerCase());
  overrideOutOfOrder(block, findings);
  return findings.sort((a, b) => a.at - b.at);
}

/**
 * A declaration written to override an earlier one, which the stylesheet's order will not let win.
 *
 * **The stylesheet has ONE order and a block has another.** A rule is shared by every element that
 * names it, so the sheet cannot honour any block's order — it emits unconditional rules before
 * conditional ones and broader properties before the ones they cover, and that is what makes the
 * common shapes right. Inside a block, the author's order is what decides. The two agree almost
 * always, and where they do not the author's loses SILENTLY.
 *
 * Measured against plain CSS in Chromium, the same declarations in the same order:
 *
 * | written | plain CSS | ours |
 * |---|---|---|
 * | `@media { padding: 40px }` then `padding: 8px` | 8px | **40px** |
 * | `@media { padding: 40px }` then `padding-left: 8px` | left 8px | **left 40px** |
 * | `@media { &:hover { … } }` then a plain one | same | same — a selector adds specificity |
 * | two under the SAME condition | same | same — the rank does not separate them |
 *
 * The merge cannot answer it: two different keys are two classes, both land, and the sheet breaks
 * the tie. Reported rather than silently reordered, because the sheet's order is what makes every
 * other block right and a page nobody edited must not move.
 *
 * Only the SELECTOR has to match, because a selector adds specificity and that beats source order
 * on its own — measured, and it is why the rule would otherwise report correct CSS.
 */
function overrideOutOfOrder(block: Block, findings: Finding[]): void {
  const flat = flatten(block);

  for (const [index, later] of flat.entries()) {
    for (const earlier of flat.slice(0, index)) {
      if (earlier.selector !== later.selector) continue;
      // The same key is the same thing set twice, and the merge already keeps the later one.
      if (earlier.key === later.key) continue;
      if (!conflict(earlier.property, later.property)) continue;

      /**
       * The merge settles it, so the sheet never gets to. A later shorthand CLEARS its own
       * longhands, and the clear-list carries the context — so it reaches an earlier longhand under
       * the same conditions and no other. Measured: `padding-left: 40px; padding: 8px` is the same
       * as plain CSS, and reporting it would be reporting correct CSS.
       */
      const sameContext = earlier.conditions.join("|") === later.conditions.join("|");
      if (sameContext && covers(later.property, earlier.property)) continue;

      if (sheetRank(later) >= sheetRank(earlier)) continue;

      const where = earlier.conditions.length > 0 ? earlier.conditions.join(" ") : `\`${earlier.property}\``;
      findings.push({
        rule: "override-out-of-order",
        at: later.at ?? 0,
        length: later.property.length,
        message:
          `\`${later.property}\` is written to override ${where} above it, and it will not — the ` +
          `stylesheet emits ${earlier.conditions.length > 0 ? "conditional rules after unconditional ones" : "a shorthand before its own longhands"}, ` +
          `so the earlier one wins wherever both apply. Write it above, or put it under the same condition.`,
      });
      return;
    }
  }
}

/**
 * `body` is the at-rule whose body these items ARE, and it changes what an item may be:
 *
 * - `keyframes` — frames, each holding ordinary declarations. A declaration outside a frame is
 *   dropped by the browser, so it is reported here.
 * - anything else named — descriptors, which are declarations and nothing else. A nested rule is
 *   reported, and the property rules stand down: the descriptor vocabulary is the types'.
 */
function walk(items: readonly BlockItem[], findings: Finding[], body?: string): void {
  /** What each property was last declared as, for `repeated-declaration`. Per rule, not per block. */
  const seen = new Map<string, string>();

  for (const item of items) {
    if (item.kind === "rule") {
      if (body !== undefined && body !== "keyframes") {
        ruleOutOfPlace(item, body, findings);
        continue;
      }
      if (body === "keyframes") unknownFrame(item, findings);
      else atRuleOutOfPlace(item, findings);
      holeInHead(item.prelude, item.at, body === "keyframes" ? "a frame" : "a selector", findings);
      // A nested rule has its own scope: `color` beside it and `color` inside it are two
      // declarations on two different elements, and neither repeats the other. A frame's contents
      // are ordinary declarations, which is why the name does not travel into it.
      walk(item.items, findings);
      continue;
    }

    if (body === "keyframes") {
      declarationOutOfPlace(item, findings);
      continue;
    }

    /**
     * A hole read into the PROPERTY, which is what a forgiving parse does with one written where a
     * custom property cannot go. `{{name}}: 24px` puts it in the name; a hole standing alone with no
     * colon after it puts the whole declaration there.
     */
    holeInHead(item.property, item.at, item.value.length === 0 ? "a declaration" : "a property name", findings);
    // Against the right vocabulary: the properties in an ordinary block, that at-rule's descriptors
    // in a named one. The types report WHETHER a name exists either way; this is the suggestion,
    // which a quoted key never gets from them.
    unknownProperty(item, findings, body);
    /**
     * The run-on FIRST, and it silences the value check for the same declaration.
     *
     * A missing `;` makes the next declaration part of this one's value, so the words in it are words
     * this property does not accept — and both rules have something true to say about one mistake.
     * Measured on the shape a person writes: `gap: 8px` with no `;` above `padding: 4px 0;` came back
     * as BOTH *`gap` does not accept `padding`* and *`padding` is being read as part of `gap`'s
     * value*. The second is the one that says what to do.
     */
    const before = findings.length;
    runOn(item, findings);
    if (findings.length === before && body === undefined) unknownValue(item, findings);
    unknownUnit(item, findings);
    gluedHole(item, findings);
    repeated(item, seen, findings);
  }
}

/* ── the rules ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Two declarations run together, which is what a missing `;` makes of them.
 *
 * **Nothing else reports it, and that had to be measured.** `padding: 4px 0 border-left: 1px solid
 * red` is one value to the parser, and `padding` is not among the 123 properties whose values are a
 * closed union — so the type layer has no grounds and `unknown-value` has nothing to check against.
 * The browser drops both declarations and the page renders without the style, silently, which is the
 * whole reason this exists.
 *
 * **A colon inside a value is the tell.** CSS values do not contain bare colons; the three places one
 * legitimately appears — inside a string, inside `url( … )`, inside any other function — are exactly
 * where this does not look. A hole is skipped too: what is inside one is TypeScript, and a colon
 * there is a type annotation or a conditional.
 */
function runOn(declaration: Declaration, findings: Finding[]): void {
  for (const part of declaration.value) {
    if (part.kind !== "text" || part.at === undefined) continue;

    const at = bareColon(part.text);
    if (at === -1) continue;

    /** The name the colon belongs to, which is the declaration that was swallowed. */
    let start = at;
    while (start > 0 && isNameCharacter(part.text.charCodeAt(start - 1))) start--;
    const name = part.text.slice(start, at);
    if (name === "") continue;

    findings.push({
      rule: "run-on-declaration",
      at: part.at + start,
      length: name.length,
      message:
        `\`${name}\` is being read as part of \`${declaration.property}\`'s value — ` +
        `the declaration before it has no \`;\`, so the browser drops both.`,
    });
    return;
  }
}

/** The first colon that is not inside a string or a function, or -1. */
function bareColon(text: string): number {
  let depth = 0;
  let quote = 0;

  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);

    if (quote !== 0) {
      if (code === 92 /* \ */) index++;
      else if (code === quote) quote = 0;
      continue;
    }

    if (code === 34 /* " */ || code === 39 /* ' */) quote = code;
    else if (code === 40 /* ( */) depth++;
    else if (code === 41 /* ) */) depth = Math.max(0, depth - 1);
    else if (code === 58 /* : */ && depth === 0) return index;
  }

  return -1;
}

/** A CSS property name's characters, which is what stands before the colon that gave it away. */
function isNameCharacter(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 45 ||
    code === 95
  );
}

/**
 * A dashed property name that is nearly one CSS has.
 *
 * **Bare names are left to the types**, which report them with TypeScript's own *did you mean*. A
 * dashed one cannot be an unquoted object key, and a quoted key gets no suggestion — measured. So
 * this fills exactly that hole and nothing else.
 *
 * A name with no near miss is not reported either: the types already said it does not exist, and
 * repeating that with nothing added is noise.
 */
function unknownProperty(item: Declaration, findings: Finding[], body?: string): void {
  const name = item.property;
  if (item.at === undefined) return;
  // A custom property is the author's, and a vendor-prefixed name is a browser's — neither is in
  // CSS's own list and neither is a typo of anything in it.
  if (name.startsWith("-") || !name.includes("-")) return;

  /**
   * Inside a named block the vocabulary is that at-rule's descriptors, and only those: `src` is not
   * a property and `font-family` in a `@font-face` is not the property of the same name. An at-rule
   * with no table gets no report at all, which is the safe direction — the types still have it.
   */
  const among = body === undefined ? PROPERTIES : DESCRIPTORS[body];
  if (among === undefined || among.includes(name)) return;
  if (body === undefined && KNOWN.has(name)) return;

  const meant = nearest(name, among);
  if (meant === undefined) return;

  findings.push({
    rule: "unknown-property",
    at: item.at,
    length: name.length,
    message:
      body === undefined
        ? `\`${name}\` is not a CSS property. Did you mean \`${meant}\`?`
        : `\`${name}\` is not a \`@${body}\` descriptor. Did you mean \`${meant}\`?`,
  });
}

/**
 * A bare word in a value that the property does not accept.
 *
 * This is the half the types gave up on. A property whose grammar is a closed keyword set gets a
 * real union and TypeScript reports it; the other 428 take COMBINATIONS — `display: inline flow-root`
 * — and a union of their single keywords would reject valid CSS.
 *
 * A checker has no such constraint, because it reads one token and says something about that token
 * alone. `KEYWORDS` holds the properties whose grammar admits no arbitrary identifier; a property
 * reachable through `<custom-ident>` and its kind is absent, because `animation-name: slidein` is a
 * name the author invented and nothing here can judge it.
 */
function unknownValue(item: Declaration, findings: Finding[]): void {
  const names = PROPERTY_NAMED[item.property];
  if (names !== undefined) return propertyNames(item, names, findings);

  const accepted = KEYWORDS[item.property];
  if (accepted === undefined) return;

  // An EMPTY row is a property that accepts no keyword at all — see the generator. Splitting `""`
  // would give a set holding one empty string, which matches nothing and reads as a bug later.
  const keywords = new Set(accepted === "" ? [] : accepted.split(" "));

  for (const word of words(item.value)) {
    if (keywords.has(word.text) || GLOBAL.has(word.text)) continue;

    const meant = nearest(word.text, [...keywords]);
    findings.push({
      rule: "unknown-value",
      at: word.at ?? item.valueAt ?? item.at ?? 0,
      length: word.text.length,
      message:
        meant === undefined
          ? `\`${item.property}\` does not accept \`${word.text}\`.`
          : `\`${item.property}\` does not accept \`${word.text}\`. Did you mean \`${meant}\`?`,
    });
  }
}

/**
 * A value whose bare words are keywords or PROPERTY NAMES — `transition-property`, `will-change`,
 * and the `transition` shorthand.
 *
 * Their grammars admit a free identifier, which is normally the honest reason to check nothing: a
 * name somebody invented cannot be told from a name somebody mistyped. Here it can, because the
 * identifier is a property name and that is a closed set this package already generates.
 *
 * **The shorthand is checked by elimination rather than by a model of its grammar.** `transition`
 * mixes a property, two times and an easing function in one comma-separated list, and nothing here
 * parses that. It does not have to: a time is not a bare word, `cubic-bezier( … )` is a function, and
 * the keywords come from the longhands — so what is left is a property name. `animation` is
 * deliberately not treated the same way, because `animation-name` is the author's own `@keyframes`.
 *
 * **Three things are not typos and must not be reported.** A vendor-prefixed property is not in the
 * generated list, which holds only unprefixed names. A custom property is animatable and is the
 * author's own word. And a CSS-wide keyword is accepted everywhere.
 */
function propertyNames(item: Declaration, accepted: string, findings: Finding[]): void {
  const keywords = new Set(accepted === "" ? [] : accepted.split(" "));

  for (const word of words(item.value)) {
    if (word.text.startsWith("-")) continue;
    if (keywords.has(word.text) || GLOBAL.has(word.text) || KNOWN.has(word.text)) continue;

    const meant = nearest(word.text, PROPERTIES as string[]);
    findings.push({
      rule: "unknown-value",
      at: word.at ?? item.valueAt ?? item.at ?? 0,
      length: word.text.length,
      message:
        `\`${item.property}\` does not accept \`${word.text}\` — it takes a property name` +
        (keywords.size === 0 ? "." : ` or one of ${[...keywords].sort().join(", ")}.`) +
        (meant === undefined ? "" : ` Did you mean \`${meant}\`?`),
    });
  }
}

/** The at-rules that name something for the whole stylesheet, so a block may not hold one. */
const ELSEWHERE = new Set(NOT_IN_A_RULE);

/**
 * An at-rule that is not part of an element's rule.
 *
 * A block IS one element's rule. `@keyframes`, `@font-face` and `@property` are not that — each names
 * something the whole stylesheet can use — and written inside a block they compile, nest inside the
 * class rule, and do nothing at all. Measured: `@keyframes slide { … }` came out as
 * `.r-…{@keyframes slide{…}}`, which no browser resolves and nothing else reports.
 *
 * The list is a deny-list, and which mistake that chooses is written down where it is generated: the
 * at-rules that DO nest are a growing set, so an allow-list would have reported `@scope` and
 * `@starting-style` as faults on the day they arrived.
 */
function atRuleOutOfPlace(rule: NestedRule, findings: Finding[]): void {
  if (!rule.prelude.startsWith("@")) return;

  const name = `@${rule.prelude.slice(1).split(/[\s(]/, 1)[0].toLowerCase()}`;
  if (!ELSEWHERE.has(name)) return;

  findings.push({
    rule: "at-rule-out-of-place",
    at: rule.at ?? 0,
    length: name.length,
    message:
      `\`${name}\` is not part of an element's rule — it names something the whole stylesheet uses, ` +
      `and inside a block it compiles to a rule no browser resolves. Put it in a stylesheet; a block ` +
      `holds what applies to this element.`,
  });
}

/**
 * A CSS number, which is more than the shape a person types.
 *
 * Measured in Chromium, all of these are kept as frames: `.5%` becomes `0.5%`, `1e2%` becomes
 * `100%`, `+50%` becomes `50%`. A rule written from `50%` alone reported four correct spellings — so
 * this is the grammar rather than the habit, and the range is asked separately, because `150%` is a
 * number this matches and a frame the browser drops.
 */
const NUMBER = /^[+]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/;

/** The same, carrying a `%`, with the number kept so its range can be asked. */
const PERCENTAGE = /^([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)%$/;

/**
 * A word in a `@keyframes` body that is not a frame.
 *
 * **The types cannot ask this and it was measured before it was written.** A frame is any string to
 * an index signature — that is what lets `50%` and `0%, 100%` through — so `form { opacity: 0 }`
 * type-checks, compiles, ships, and animates nothing: the browser drops a frame it cannot read and
 * the animation runs with one keyframe fewer, or with none.
 *
 * A frame is `from`, `to`, or a percentage, and a comma-separated list of those is one frame with
 * several times. A bare number is called out on its own, because a missing `%` reads as correct to
 * everyone who writes it.
 */
function unknownFrame(rule: NestedRule, findings: Finding[]): void {
  for (const part of rule.prelude.split(",")) {
    const frame = part.trim().toLowerCase();
    if (frame === "" || frame === "from" || frame === "to") continue;

    const percentage = PERCENTAGE.exec(frame);
    if (percentage !== null) {
      const time = Number.parseFloat(percentage[1]);
      if (time >= 0 && time <= 100) continue;

      findings.push({
        rule: "unknown-frame",
        at: rule.at ?? 0,
        length: rule.prelude.trimEnd().length,
        message:
          `\`${part.trim()}\` is not a keyframe — a frame is a time between 0% and 100%, and the ` +
          `browser drops one outside it along with everything that frame would have set.`,
      });
      return;
    }

    const meant = NUMBER.test(frame) ? `${frame}%` : nearest(frame, ["from", "to"]);
    findings.push({
      rule: "unknown-frame",
      at: rule.at ?? 0,
      length: rule.prelude.trimEnd().length,
      message:
        `\`${part.trim()}\` is not a keyframe. ` +
        (meant === undefined
          ? "A frame is `from`, `to`, or a percentage, and a browser drops one it cannot read."
          : `Did you mean \`${meant}\`?`),
    });
    return;
  }
}

/**
 * A declaration written straight into a `@keyframes` body, outside any frame.
 *
 * The same index signature accepts it, and the browser does not: a declaration at that level belongs
 * to no time, so it is dropped and the animation is missing whatever it said.
 */
function declarationOutOfPlace(item: Declaration, findings: Finding[]): void {
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
function ruleOutOfPlace(rule: NestedRule, atRule: string, findings: Finding[]): void {
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
 * Text with no whitespace between it and a hole, which does not do what it reads as.
 *
 * A hole becomes one custom property, so `{{n}}px` becomes `var(--r-…-0)px` — and a `var()` is
 * substituted as TOKENS, so the `12` and the `px` never become one length. **Measured in Chromium**
 * with `--w: 12`: `padding-left: var(--w)px` computes to `0px`, and
 * `padding-left: 8px; padding-left: var(--w)px` computes to `0px` as well — invalid at
 * computed-value time takes the property to its initial value and the earlier declaration with it.
 * `calc(var(--w) * 1px)` computes to `12px`, and so does a hole that carries its own unit.
 *
 * The word reader steps over a glued piece rather than judging it — it has to, or `px` would be
 * reported as a value `padding-left` does not accept. That silence was recorded as a false report
 * and is now known to have been a TRUE one with the wrong message. This is the right message.
 */
function gluedHole(item: Declaration, findings: Finding[]): void {
  for (const [position, part] of item.value.entries()) {
    if (part.kind !== "hole") continue;

    const before = item.value[position - 1];
    const after = item.value[position + 1];
    const glued =
      (before !== undefined && before.kind === "text" && !endsInSpace(before.text)) ||
      (after !== undefined && (after.kind === "hole" || (after.kind === "text" && !startsWithSpace(after.text))));
    if (!glued) continue;

    findings.push({
      rule: "glued-hole",
      at: item.valueAt ?? item.at ?? 0,
      length: Math.max(1, (item.end ?? 0) - (item.valueAt ?? 0)),
      message:
        "a hole becomes one custom property, and text written against it is not part of that value — " +
        "`{{n}}px` becomes `var(--…)px`, which computes to nothing and takes any earlier declaration " +
        "of the property with it. Put the unit inside the hole, or write `calc({{n}} * 1px)`.",
    });
    return;
  }
}

/**
 * Whether a character keeps a hole apart from what is written next to it.
 *
 * Whitespace is the obvious one, and it is not the only one: `calc( … )` and a comma-separated list
 * are their own grammars, so `calc({{n}} * 1px)` and `minmax(0, {{n}})` concatenate nothing. What is
 * left — a letter, a digit, a `#`, a `-` — would run into the substituted tokens and produce a value
 * the browser refuses.
 */
function separates(code: number): boolean {
  return (
    isSpace(code) ||
    code === 40 /* ( */ ||
    code === 41 /* ) */ ||
    code === 44 /* , */ ||
    code === 47 /* / */ ||
    code === 42 /* * */ ||
    code === 43 /* + */
  );
}

/** A run that ends in something that separates — or an empty one, which separates by being nothing. */
function endsInSpace(text: string): boolean {
  return text === "" || separates(text.charCodeAt(text.length - 1));
}

/** The same at the other end. */
function startsWithSpace(text: string): boolean {
  return text !== "" && separates(text.charCodeAt(0));
}

/** Every unit CSS has, for the question below. */
const KNOWN_UNITS = new Set(UNITS);

/**
 * A number whose unit is NEARLY one — `150oms`, `10pxx`.
 *
 * **It began as a near miss and that was too weak**, measured on the shape a person actually types:
 * `150xxms` and `150asdasdms` both passed, because neither is within an edit or two of `ms`. The
 * caution behind it was `mdn-data`'s unit list being incomplete — thirty units, missing `%`, the
 * line-height units, every container-query unit and every viewport variant — and that is answered by
 * the supplement rather than by refusing to speak: measured after it, every exotic real unit is in
 * the set, `q` and `x` and `ic` and `rcap` and `dppx` and `svmin` and `cqmax` among them.
 *
 * So it is a membership test now, and the near miss only chooses the SUGGESTION. What is left is the
 * one risk worth naming: a unit invented after this list was generated is reported until the list is
 * regenerated, which is `scripts/build-css-properties.mjs` and one command.
 */
function unknownUnit(item: Declaration, findings: Finding[]): void {
  for (const part of item.value) {
    if (part.kind !== "text" || part.at === undefined) continue;

    for (const found of part.text.matchAll(/(?<![\w.#-])\d*\.?\d+([a-zA-Z%]+)/g)) {
      const unit = found[1].toLowerCase();
      if (KNOWN_UNITS.has(unit)) continue;

      const meant = nearest(unit, UNITS as string[]);
      const at = part.at + found.index + found[0].length - found[1].length;
      findings.push({
        rule: "unknown-unit",
        at,
        length: found[1].length,
        message: `\`${found[1]}\` is not a CSS unit.` + (meant === undefined ? "" : ` Did you mean \`${meant}\`?`),
      });
    }
  }
}

/**
 * The same property declared twice with the SAME value, which says nothing either way.
 *
 * **Only when the value matches, and that narrowing is the whole rule.** Two declarations of one
 * property with DIFFERENT values is a deliberate idiom — a fallback for an engine that will drop the
 * second, `width: 100px; width: fit-content;`. Reporting it would be reporting a technique, which is
 * how a checker earns being switched off.
 */
function repeated(item: Declaration, seen: Map<string, string>, findings: Finding[]): void {
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

/**
 * A hole where a custom property cannot go: a property name, a selector, a whole declaration.
 *
 * The build refuses these outright — a custom property holds a VALUE, so there is no correct
 * compilation — and this exists to say it FIRST, in an editor, while it is being typed rather than
 * at the end of a build. It is reachable only from a forgiving parse, which is what an editor uses.
 */
function holeInHead(
  text: string,
  at: number | undefined,
  what: "a declaration" | "a property name" | "a selector" | "a frame",
  findings: Finding[],
): void {
  const found = text.indexOf("{{");
  if (found === -1 || at === undefined) return;

  // The `{{`, which is where the author has to move something. The expression's own length is not
  // the fault and underlining it would say the expression is wrong.
  findings.push({ rule: "hole-out-of-place", at: at + found, length: 2, message: holeOutOfPlace(what) });
}

/* ── reading a value ───────────────────────────────────────────────────────────────────────── */

interface Word {
  readonly text: string;
  readonly at: number | undefined;
}

/**
 * The bare identifiers in a value, and nothing else.
 *
 * Everything skipped here is something no keyword table could judge, and each was a false report
 * before it was skipped: a string's contents (`content: "flexx"`), a function's name and arguments
 * (`rgb(0 0 0)`, `var(--x, flex)`), a number or a length, a hex colour, and `!important`.
 *
 * A hole contributes nothing at all — its value is decided at render, and this is a build-time read.
 */
function words(parts: readonly ValuePart[]): Word[] {
  const out: Word[] = [];

  for (const [position, part] of parts.entries()) {
    if (part.kind !== "text") continue;
    const text = part.text;

    /**
     * A word TOUCHING a hole is part of the hole's value, not a value of its own.
     *
     * `padding: {{n}}px` is one length written in two pieces, and `px` on its own is nothing a
     * property accepts. Measured before this existed, on every property with a keyword row:
     * `gap: {{n}}px` reported *`gap` does not accept `px`* — a false report on correct CSS, which is
     * how a checker earns being switched off. Whitespace is what separates values, so a piece with
     * none between it and the hole is the same value.
     */
    const glued = {
      before: position > 0 && parts[position - 1].kind === "hole" && !isSpace(text.charCodeAt(0)),
      after:
        position + 1 < parts.length &&
        parts[position + 1].kind === "hole" &&
        !isSpace(text.charCodeAt(text.length - 1)),
    };
    const first = out.length;

    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);

      if (code === 34 || code === 39) {
        index = endOfString(text, index);
        continue;
      }
      if (code === 33 /* ! */) {
        // `!important`, and anything else in that position is not a value word either.
        while (index < text.length && !isSpace(text.charCodeAt(index))) index++;
        continue;
      }
      if (code === 35 /* # */ || (code >= 48 && code <= 57) || code === 46 /* . */) {
        while (index < text.length && !isSpace(text.charCodeAt(index)) && text.charCodeAt(index) !== 44) index++;
        continue;
      }
      /**
       * A leading `-` belongs to the word when a letter or another `-` follows it, which is CSS's own
       * identifier rule: `-webkit-transform` and `--brand` are one word each, and `-8px` is a number.
       * Without it, a vendor-prefixed property read as `webkit-transform` and a custom property as
       * `brand` — both reported as typos of something they are not.
       */
      const dashed = code === 45 && (isWordStart(text.charCodeAt(index + 1)) || text.charCodeAt(index + 1) === 45);
      if (!dashed && !isWordStart(code)) continue;

      const start = index;
      if (dashed) index += text.charCodeAt(index + 1) === 45 ? 2 : 1;
      while (index < text.length && isWordCharacter(text.charCodeAt(index))) index++;

      // A function: the name is not a keyword and its arguments are its own grammar.
      if (text.charCodeAt(index) === 40 /* ( */) {
        index = endOfCall(text, index);
        continue;
      }

      out.push({ text: text.slice(start, index), at: part.at === undefined ? undefined : part.at + start });
      index--;
    }

    if (glued.before && out.length > first) out.splice(first, 1);
    if (glued.after && out.length > first) out.pop();
  }

  return out;
}

function endOfString(text: string, start: number): number {
  const quote = text.charCodeAt(start);
  let index = start + 1;
  while (index < text.length) {
    if (text.charCodeAt(index) === 92) {
      index += 2;
      continue;
    }
    if (text.charCodeAt(index) === quote) return index;
    index++;
  }
  return index;
}

function endOfCall(text: string, open: number): number {
  let index = open + 1;
  let depth = 1;
  while (index < text.length && depth > 0) {
    const code = text.charCodeAt(index);
    if (code === 34 || code === 39) {
      index = endOfString(text, index);
    } else if (code === 40) depth++;
    else if (code === 41) depth--;
    index++;
  }
  return index - 1;
}

const isSpace = (code: number) => code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
const isWordStart = (code: number) => (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
const isWordCharacter = (code: number) => isWordStart(code) || (code >= 48 && code <= 57) || code === 45 || code === 95;

/* ── the near miss ─────────────────────────────────────────────────────────────────────────── */

/**
 * The closest name, or nothing when nothing is close.
 *
 * The bound is what keeps the suggestion honest: a name three edits away from `flex-direction` is
 * not a typo of it, and offering one anyway sends a reader to change a line that was right for a
 * different reason. Scaled by length, so a short name needs a closer match than a long one.
 */
function nearest(word: string, among: readonly string[]): string | undefined {
  const bound = Math.min(3, Math.max(1, Math.floor(word.length / 4)));
  let best: string | undefined;
  let closest = bound + 1;

  for (const candidate of among) {
    if (Math.abs(candidate.length - word.length) > closest) continue;
    const distance = editDistance(word, candidate, closest);
    if (distance < closest) {
      closest = distance;
      best = candidate;
    }
  }

  return best;
}

/**
 * Levenshtein, abandoned as soon as every cell in a row is past the bound.
 *
 * The bound is what makes this affordable: `unknown-value` asks it once per word against a set that
 * can be 160 colours long, and a full matrix per candidate would be the checker's whole cost.
 */
function editDistance(a: string, b: string, bound: number): number {
  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);

  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost);
      row.push(value);
      if (value < best) best = value;
    }

    if (best > bound) return bound + 1;
    previous = row;
  }

  return previous[b.length];
}
