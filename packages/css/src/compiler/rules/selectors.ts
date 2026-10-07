/** Rules about a nested rule's selector or at-rule: unknown, out of place, or reaching another element. */

import { AT_RULE_LINKS, MEDIA_FEATURES, NOT_IN_A_RULE, SELECTORS } from "../keywords.generated";
import { nearest } from "../nearest";
import { branchOf } from "../read";
import { selectorsOf, type Block, type BlockItem, type NestedRule, rulesIn } from "./shared";
import { type Finding } from "./index";
import { typedInto } from "./namedSites";
import { PREFIXES } from "./properties";
import { NUMBER, PERCENTAGE } from "./values";

/**
 * A selector whose subject is another element, in a project that keeps a block to its own element.
 *
 * A parent reaching into a child (`.title { … }`, `& > img`) or a sibling (`& + .card`) makes two
 * independently composed elements depend on each other, and neither file says so. The SUBJECT is
 * the last compound — what follows the last combinator — and a selector is the element's own when
 * `&` is in it: `&:hover`, `&::before`, `&.active`, `&:has(> img)` and `[data-theme="dark"] &` all
 * style this element. A nested selector with no `&` is relative, so it means a descendant, as CSS
 * nesting reads it. A condition and a group (`@media`, `when`) are not selectors. Inside a rule
 * already reported, nothing more is said — the one report is the fault.
 */
export function stylesAnotherElement(block: Block, findings: Finding[]): void {
  const subjectOf = (selector: string): string => {
    let depth = 0;
    let quote = "";
    let last = 0;
    for (let index = 0; index < selector.length; index++) {
      const char = selector[index];
      if (quote !== "") {
        if (char === "\\") index++;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (char === "(" || char === "[") depth++;
      else if (char === ")" || char === "]") depth--;
      else if (depth === 0 && /[\s>+~]/.test(char)) last = index + 1;
    }
    return selector.slice(last).trim();
  };
  const walkItems = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      if (item.kind !== "rule") continue;
      const prelude = item.prelude.trim();
      const notASelector = prelude.startsWith("@") || /^(?:when|else|match)\b/.test(prelude);
      const other = notASelector ? undefined : selectorsOf(prelude).find((one) => !subjectOf(one.trim()).includes("&"));
      if (other === undefined || item.at === undefined) {
        walkItems(item.items);
        continue;
      }
      findings.push({
        rule: "styles-another-element",
        at: item.at,
        length: item.prelude.length,
        message:
          `\`${other.trim()}\` styles another element, and \`styleOtherElements: false\` keeps a block to its own. ` +
          "Give that element a block of its own, or pass one to it as a prop.",
      });
    }
  };
  walkItems(block.items);
}

/** A feature's name, wherever it sits inside a `@media` condition. */
const A_FEATURE = /\(\s*([a-zA-Z][\w-]*)\s*[:)<>=]/g;
const KNOWN_FEATURES = new Set(MEDIA_FEATURES);

/**
 * A `@media` feature that is nearly one CSS has.
 *
 * The fault it leaves is the quiet kind: measured in Chromium 151, every one of these survives a
 * parse with its text intact, `cssRules` and all —
 *
 *     @media (min-widht: 40rem)                    kept
 *     @media (prefers-reduced-mErrorotion: reduce) kept
 *     @media (nonsense)                            kept
 *     @media (min-width 40rem)                     kept, and it has no colon
 *
 * — because an unknown feature is `<general-enclosed>` in the grammar, which is **legal CSS that
 * never matches**. So a typo is not invalid; it is a block that silently never applies.
 *
 * A NEAR MISS only, for the reason every table-backed rule here says the same thing: the list is a
 * snapshot, a feature invented after it is valid, and reporting valid CSS is how a checker earns
 * being switched off. `@supports` and `@container` are left alone — their conditions are a
 * different grammar with different names.
 *
 * The table is written down because nothing can supply it, and it is verified against a real
 * browser in `apps/playground-core/browser`: for a name Chromium knows, exactly one of `(f)` and
 * `not (f)` holds; for one it does not, both are false. That is the oracle a stylesheet parse is
 * not.
 */
export function mediaFeatures(block: Block, findings: Finding[]): void {
  for (const item of rulesIn(block)) {
    if (!item.prelude.startsWith("@media") || item.at === undefined) continue;

    for (const found of item.prelude.matchAll(A_FEATURE)) {
      const name = found[1];
      // A browser's own feature is not in CSS's list and is not a typo of anything in it.
      if (name.startsWith("-") || KNOWN_FEATURES.has(name)) continue;

      const meant = nearest(name, MEDIA_FEATURES as string[]) ?? typedInto(name);
      if (meant === undefined) continue;

      findings.push({
        rule: "unknown-media-feature",
        at: item.at + (found.index ?? 0) + found[0].indexOf(name),
        length: name.length,
        message:
          `\`${name}\` is not a media feature, so this condition never matches and the rules inside ` +
          `it never apply — a browser keeps it rather than refusing it. Did you mean \`${meant}\`?`,
      });
    }
  }
}

/**
 * A prelude spelled a way that is the same CSS and a different class.
 *
 * `:hover` and `:HOVER` are one rule to a browser, and two keys here — because a declaration's key
 * is its own text, and folding it in the compiler is not available: CSS is case-insensitive about
 * the words of the LANGUAGE and case-sensitive about an author's identifiers, so lowering a
 * selector would merge `.a` with `.A`. Not folding at all has a measured cost: a base and a
 * modifier one space apart keep both classes, so the modifier does not override and the winner is
 * decided by whichever file the bundler reaches first.
 *
 * So the SOURCE is canonical, and this is what says so. `ramonda-css format` writes the same
 * answer.
 *
 * **It reports exactly what the canonicaliser changes.** A shape `canonicalCondition` and
 * `canonicalSelector` leave alone — `:nth-child(2n + 1)`, `@supports ((display: grid))`, both of
 * which need real parsing to rewrite — is a shape this says nothing about. An error with no fix is
 * worse than a spelling, and one function asked two ways cannot drift from the other consumer.
 */
/**
 * `@layer` written INSIDE a block, which looks like a cascade control and cannot be one.
 *
 * **The stylesheet is already one layer.** Everything this compiler emits is wrapped in
 * `@layer ramonda { … }`, which is what puts it beneath an author's own unlayered CSS whatever order
 * the files load in.
 *
 * So a `@layer a` inside a block makes a SUBLAYER, `ramonda.a` — and whether that beats `ramonda.b`
 * is decided by which of the two the sheet writes first, because CSS orders layers it was given no
 * explicit order for by first appearance. The sheet writes per file, in each file's own source
 * order, so the answer is a property of the BUILD. The author gets a lever whose other end is not in
 * their hands.
 *
 * **Layers themselves are not refused, and the message has to say so** — this is the one refusal
 * here that an author will read as a missing feature. `@layer` belongs in their own stylesheet,
 * where the order can be declared, and `ramonda` can be ordered among their layers from there.
 * Measured: `@layer app, ramonda;` at the top of an authored sheet orders both.
 *
 * The place this would become real is a declared order — somewhere for `@layer a, b;` to be written
 * inside our own layer. There is nowhere in a block to write it, so it is a feature rather than a
 * fix, and it is not pretended at here.
 */
export function layerInABlock(block: Block, findings: Finding[]): void {
  for (const item of rulesIn(block)) {
    const prelude = item.prelude.trim();
    if (item.at === undefined || !/^@layer\b/i.test(prelude)) continue;

    findings.push({
      rule: "layer-in-a-block",
      at: item.at,
      length: item.prelude.length,
      message:
        "a style block cannot hold `@layer`. Everything compiled here is already emitted inside " +
        "`@layer ramonda`, so a layer written in a block is a sublayer of it — and which sublayer " +
        "wins is decided by the order the stylesheet happens to write them in, not by anything " +
        "written here. Declare your layers in your own stylesheet, where the order can be given: " +
        "`@layer app, ramonda;` puts this package's output wherever you want it among them.",
    });
  }
}

/**
 * The ROOT written where it would have to be a descendant of the element — which it never is.
 *
 * Everything in a block is nested in the element's own rule, so `:root { … }` there compiles to
 * `.r-… :root`: the root, under the element. The root is the `<html>` element and is nobody's
 * descendant, so the rule applies nowhere — it compiles, ships, and does nothing, which is the shape
 * a theme written into a block takes. `html` is the same element by its tag.
 *
 * What stays silent is every way the root is NOT a descendant: the element under it,
 * `:root.dark & { … }`, which is how a theme reaches a block; the element being it, `&:root`, a block
 * on `<html>`; and `:root` inside a function's argument, `&:not(:root)`. Read per selector of a list,
 * and only after the last `&` — what comes before it is an ancestor, and an ancestor may be the root.
 */
export function rootInABlock(block: Block, findings: Finding[]): void {
  for (const item of rulesIn(block)) {
    const prelude = item.prelude.trim();
    if (item.at === undefined || prelude.startsWith("@") || !selectorsOf(prelude).some(rootUnderTheElement)) continue;

    findings.push({
      rule: "root-in-a-block",
      at: item.at,
      length: item.prelude.length,
      message:
        `\`${prelude}\` inside a block means the root under this element, and the root is nobody's ` +
        "descendant, so this rule applies nowhere. Set a theme's values in your own stylesheet, and " +
        "this project's tokens in `ramonda.css.ts`.",
    });
  }
}

/** Whether one selector of a list puts the root BELOW the element — see {@link rootInABlock}. */
function rootUnderTheElement(selector: string): boolean {
  // A quoted value and an attribute's brackets hold no compound: `[data-x="a :root"]` names no root.
  // Nor does a function's argument: `:not(:root)`, `:is(.a, :root)`.
  let flat = selector
    .trim()
    .replace(/"[^"]*"|'[^']*'/g, '""')
    .replace(/\[[^\]]*\]/g, "[]");
  for (let before = ""; before !== flat; ) {
    before = flat;
    flat = flat.replace(/\([^()]*\)/g, "()");
  }
  const amp = flat.lastIndexOf("&");
  const tail = amp === -1 ? flat : flat.slice(amp + 1);
  const compounds = tail.split(/[\s>+~]+/).filter((one) => one !== "");
  // A compound glued to `&` is the element itself — `&:root` is a block on `<html>`.
  if (amp !== -1 && !/^[\s>+~]/.test(tail)) compounds.shift();
  return compounds.some((one) => /^(?::root|html)(?![\w-])/i.test(one));
}

/**
 * Every pseudo-class and pseudo-element CSS has, lowered, without the `()` a functional one
 * carries.
 *
 * **Plus the four CSS2 pseudo-elements written with ONE colon**, which `SELECTORS` holds only in
 * their modern spelling. `:before`, `:after`, `:first-line` and `:first-letter` are valid CSS —
 * every browser still accepts them — and reporting one as a name CSS does not have would be
 * refusing real CSS, the one failure this package may not have.
 *
 * They are not silent, they belong to a different rule: `non-canonical-spelling` says to write
 * `&::before`, which is the more useful sentence. One fault, one report.
 */
const PSEUDO_NAMES = new Set([
  ...Object.keys(SELECTORS).map((one) => one.replace(/\(\)$/, "").toLowerCase()),
  ":before",
  ":after",
  ":first-line",
  ":first-letter",
]);

/** A letter, a digit or a `-`: what a pseudo's NAME is made of, after its colons. */
function isPseudoNameCharacter(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || code === 45;
}

/**
 * **A PSEUDO-CLASS THAT DOES NOT EXIST, and it drops the whole rule.**
 *
 * `SELECTORS` holds 129 of them with their groups and their MDN links; `normalise.ts` reads it to
 * canonicalise a prelude, `plugin.ts` to hover one, and this to report one. Measured in Chromium,
 * inserting a rule with two declarations and reading `cssRules` back: a pseudo-class the browser
 * does not know keeps **zero rules**. Not one dropped declaration — every declaration beside it,
 * gone, with the element left on whatever it inherited. The same cost as `unknown-at-rule`.
 *
 * ## Why the TABLE is the oracle here, and not the browser
 *
 * The other generated tables in this package ask the engines, because `mdn-data` was measured short
 * three times. This one must not. Measured, again in Chromium: **33 of the 129 names it refuses** —
 * `:left`, `:right` and `:first` are paged-media, `::-ms-*` and `::-moz-*` belong to other engines,
 * `:buffering`, `:playing` and `:seeking` are media ones it has not shipped. Every one is a real
 * selector somewhere, and a rule that asked this browser would refuse valid CSS, which is the one
 * failure this package may not have.
 *
 * ## What it deliberately does not read
 *
 * The ARGUMENT of a functional one. `:nth-child(2n+1)`, `:not(.a)` and `:has(> img)` each have a
 * grammar of their own, and getting one of those wrong is a different fault from misspelling the
 * name. Only the name is checked.
 *
 * A VENDOR pseudo is a browser's own, so the prefix is checked and the name after it is not —
 * exactly as for a property and for an at-rule.
 */
function unknownSelector(rule: NestedRule, findings: Finding[]): void {
  if (rule.prelude.startsWith("@")) return;

  const text = rule.prelude;

  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) !== 58 /* : */) continue;

    const start = index;
    let at = index + 1;
    if (text.charCodeAt(at) === 58) at++;

    const nameStart = at;
    while (at < text.length && isPseudoNameCharacter(text.charCodeAt(at))) at++;

    // A lone `:` — in an attribute selector's value, say. Nothing to name.
    if (at === nameStart) {
      index = at - 1;
      continue;
    }

    const name = text.slice(start, at).toLowerCase();
    const prefix = /^::?(-[a-z]+-)/.exec(name)?.[1];

    if (!PSEUDO_NAMES.has(name) && !(prefix !== undefined && PREFIXES.includes(prefix))) {
      const meant = nearest(name, [...PSEUDO_NAMES]);
      findings.push({
        rule: "unknown-selector",
        at: (rule.at ?? 0) + start,
        length: name.length,
        message:
          `\`${name}\` is not a pseudo-class or pseudo-element CSS has, so a browser drops the whole ` +
          `rule — every declaration inside it, not just one. ` +
          (meant === undefined ? "Check the name." : `Did you mean \`${meant}\`?`),
      });
    }

    // Step over a functional one's argument, counting depth, so `:has(:hover)` reads the name and
    // not what is inside it — see the note above about why the argument is not this rule's business.
    if (text.charCodeAt(at) === 40 /* ( */) {
      let depth = 0;
      while (at < text.length) {
        const code = text.charCodeAt(at);
        if (code === 40) depth++;
        else if (code === 41 /* ) */ && --depth === 0) {
          at++;
          break;
        }
        at++;
      }
    }

    index = at - 1;
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
export function atRuleOutOfPlace(rule: NestedRule, findings: Finding[]): void {
  if (!rule.prelude.startsWith("@")) {
    unknownSelector(rule, findings);
    return;
  }

  const name = `@${rule.prelude.slice(1).split(/[\s(]/, 1)[0].toLowerCase()}`;
  if (!ELSEWHERE.has(name)) {
    unknownAtRule(rule, name, findings);
    return;
  }

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

/** Every at-rule name CSS has, lowered. The same table `normalise.ts` reads to canonicalise one. */
const AT_RULE_NAMES = new Set(Object.keys(AT_RULE_LINKS).map((one) => one.toLowerCase()));

/**
 * **AN AT-RULE NAME THAT DOES NOT EXIST, and it drops the whole rule.**
 *
 * `AT_RULE_LINKS` holds every at-rule name CSS has, and `normalise.ts` and `plugin.ts` both read
 * it. `unknown-media-feature` checks the FEATURE inside a `@media`; this checks the word: `@medai
 * (min-width: 40rem) { … }`.
 *
 * Measured in Chromium, inserting the rule and reading `cssRules` back: a name the browser does not
 * know keeps ZERO rules. Every declaration inside it is dropped and the element keeps its inherited
 * value — the same cost as a wrong pseudo-class and for the same reason. It is the RULE that is
 * thrown away, not one declaration.
 *
 * A name with no near miss is still reported, unlike `unknown-property`: there the types have
 * already said the name does not exist, and here nothing else in this package says a word.
 *
 * A VENDOR at-rule is a browser's own — `@-moz-document` was real — so the prefix is checked and
 * the name after it is not, exactly as for a property.
 */
function unknownAtRule(rule: NestedRule, name: string, findings: Finding[]): void {
  if (AT_RULE_NAMES.has(name)) return;
  if (name.startsWith("@-")) {
    const prefix = /^@(-[a-z]+-)/.exec(name)?.[1];
    if (prefix !== undefined && PREFIXES.includes(prefix)) return;
  }

  const meant = nearest(name, [...AT_RULE_NAMES]);
  findings.push({
    rule: "unknown-at-rule",
    at: rule.at ?? 0,
    length: name.length,
    message:
      `\`${name}\` is not an at-rule CSS has, so a browser drops the whole rule — every declaration ` +
      `inside it, not just one. ` +
      (meant === undefined ? "Check the name." : `Did you mean \`${meant}\`?`),
  });
}

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
export function unknownFrame(rule: NestedRule, findings: Finding[]): void {
  // A GUARD is not a frame and is not spelled like one. `composition-in-a-named-block` owns it, and
  // saying `when $(on) is not a keyframe` beside that names the wrong thing as the fault.
  if (branchOf(rule.prelude) !== undefined) return;

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
