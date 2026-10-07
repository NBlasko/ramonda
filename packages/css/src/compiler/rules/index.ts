/** The CSS checker's entry points — `checkBlock` and the checks around a block — and the list of every rule. */

import { blocksInATemplate, type BlockSite } from "../scan";
import { LINE_COMMENT, closingHole, opensCode } from "../read";
import { type Config } from "../../config/config";
import { type Block as AnyBlock } from "../ast";
import { declaredByName } from "../declaredSet";
import { nearest } from "../nearest";
import { endOfString, missingSemicolon, unclosedCall } from "./text";
import { blockMatchArms, holeNotAllowed, matchArms, spreadOutOfPlace } from "./logic";
import { asGroups, type Block, type BlockItem, declarationsIn } from "./shared";
import { narrowerAfterAWholeShorthand, overrideOutOfOrder, walk } from "./cascade";
import { resetsDifferAcrossEngines, valueDiffersAcrossEngines } from "./engines";
import {
  holeAsAVariableName,
  setAgainstItsDeclaration,
  setByAnotherName,
  unknownCustomProperty,
  unknownVariable,
  variableByHand,
} from "./tokens";
import { layerInABlock, mediaFeatures, rootInABlock, stylesAnotherElement } from "./selectors";
import { spelling } from "./properties";
import {
  againstRegisteredSyntax,
  compositionInANamedBlock,
  holeInANamedBlock,
  initialValueAndSyntax,
  propertyDescriptorMissing,
} from "./namedSites";
import { tooManyValues, unitNotAllowed, urlNotFound } from "./values";
import {
  literalNotAllowed,
  shorthandNotAllowed,
  unitNotAllowedPerProperty,
  valueNotAllowed,
  wordOutOfItsLonghand,
} from "./projectLimits";
import { doesNothing } from "./doesNothing";

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

/**
 * Every rule this package can report, as a LIST — and the type is derived from it, not beside it.
 *
 * Written this way round because the config validates a rule id against this, and a union with a
 * hand-kept array next to it would be two lists that must agree: exactly the fault this repository
 * keeps finding. Here there is one list, and `RuleId` cannot name anything absent from it.
 */
/**
 * Rules that were renamed when tokens stopped being called "variables" — a config or a directive
 * naming the old id is told the new one, rather than that it is not a rule at all.
 */
export const RENAMED_RULES: Readonly<Record<string, string>> = {
  "literal-not-allowed": "hardcoded-not-allowed",
  "unknown-variable": "unknown-token",
  "variable-by-hand": "token-by-hand",
  "variable-set-against-its-declaration": "token-set-against-its-declaration",
  "variable-set-by-another-name": "custom-property-set-by-another-name",
  "hole-as-a-variable-name": "hole-as-a-custom-property-name",
};

export const RULE_IDS = [
  "unknown-property",
  "unknown-value",
  "repeated-declaration",
  "hole-out-of-place",
  "block-as-a-jsx-attribute",
  // A block inside a template literal's `${ … }`, where nothing can see it. See `checkTemplates`.
  "block-in-a-template",
  "run-on-declaration",
  "line-comment",
  "unknown-unit",
  "at-rule-out-of-place",
  "unknown-frame",
  "declaration-out-of-place",
  "rule-out-of-place",
  "override-out-of-order",
  "custom-property-set-by-another-name",
  "hole-as-a-custom-property-name",
  "initial-value-and-syntax",
  "property-descriptor-missing",
  "token-set-against-its-declaration",
  "unknown-custom-property",
  "url-not-found",
  "styles-another-element",
  "unknown-media-feature",
  "value-and-registered-syntax",
  "unit-not-allowed",
  "value-not-allowed",
  "shorthand-not-allowed",
  "word-out-of-its-longhand",
  "narrower-after-a-whole-shorthand",
  "resets-differ-across-engines",
  "value-differs-across-engines",
  "string-not-allowed",
  "property-not-a-name",
  "non-canonical-spelling",
  "layer-in-a-block",
  // `:root` or `html` as a descendant of the element, which nothing is. See `rootInABlock`.
  "root-in-a-block",
  "spread-out-of-place",
  "hole-in-a-named-block",
  "unknown-named-block",
  "composition-in-a-named-block",
  "ignore-without-a-reason",
  "unknown-prefix",
  "unknown-at-rule",
  "unknown-selector",
  "unknown-flag",
  "unclosed-call",
  "unknown-token",
  "token-by-hand",
  "block-refused",
  "too-many-values",
  "missing-semicolon",
  "hardcoded-not-allowed",
  "declaration-does-nothing",
  // The ones that need a `ts.Program`. They live in `typed/` — see its index for why they cannot
  // be in this file — but their ids belong here, because this is the list a config is checked
  // against and a rule a project cannot turn off is a rule with no escape hatch.
  "style-prop-never-used",
  "style-prop-overridden",
  // A `@@property` every block reads and nothing sets, so every element gets its initial value.
  "registered-never-set",
  // Two blocks joined into one string, where a merge was meant. See `joinedNotMerged`.
  "blocks-joined-not-merged",
  "allow-list-not-css",
  // A value cast to a block, which the type a block prop is cannot refuse. See `castToABlock`.
  "cast-to-a-block",
  // A state in an allow-list typed `[{ … }]`, which constrains its first declaration only. See
  // `stateIsATuple`.
  "state-is-a-tuple",
  // An allow-list written with `interface`, which can never match a block shape. See
  // `allowListIsAnInterface` — the one rule here that stands in for a compiler diagnostic.
  "allow-list-is-an-interface",
  "hole-not-allowed",
  // What a `match` may not hold. See `matchArms`.
  "hole-in-a-match-arm",
  "match-arm-repeated",
  "match-with-no-arms",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/**
 * A block written as a bare JSX attribute, which this does not compile.
 *
 * ## Why the spelling is not supported
 *
 * **A block is a TypeScript value, and a bare attribute is the one spelling that is not one.**
 * `css={@@( … )}` and `const panel = @@( … )` are expressions; `css=@@( … )` is a shape only JSX
 * has, and supporting it would mean this package extends JSX rather than TypeScript. Two tools
 * settle it:
 *
 * - **An editor stops consulting syntax injections the moment it enters a tag's attribute list.**
 *   Measured with a grammar that does nothing but match one word: it colours a FIRST attribute and
 *   is never asked about a second. So a bare block is coloured in one position and read as an
 *   error in every other, with nothing on screen to say why.
 * - **Prettier never offers a plugin the chance to print an attribute value**, so the formatter
 *   would have to hand back the braced spelling anyway.
 *
 * This rule is what a reader meets instead, and the fix it names is the whole change: put the block
 * in the braces JSX already has. It stops the build because a spelling this does not compile has to
 * be refused where it is written.
 */
export function checkSite(_source: string, site: BlockSite): Finding[] {
  if (!site.wrap) return [];

  return [
    {
      rule: "block-as-a-jsx-attribute",
      at: site.start,
      length: site.name.length,
      message:
        `a style block is a TypeScript value, not a JSX attribute — write ` +
        `\`${site.name}={@@( … )}\`, which is the same value in the braces JSX already has. ` +
        `The bare spelling could only be coloured as the first attribute on the tag's own line, and ` +
        `Prettier rewrote it anyway.`,
    },
  ];
}

/**
 * A block written inside a template literal's `${ … }`, which compiles to nothing at all.
 *
 * **Silent without this, and silent in the worst way.** A template literal is a quiet region to the
 * scan, so `` `lead ${@@( color: red; )}` `` finds no block: the file is handed on untouched, `@@(`
 * survives into the bundler, and what an author gets is a syntax error somewhere else entirely,
 * naming neither the block nor the line.
 *
 * A block is a string and goes on `className`, so joining one with a class of the author's own is
 * an ordinary thing to want, and a template is the first thing anybody reaches for.
 * `mergeClassNames` is the answer. Measured: attribute, assignment, call argument, object value,
 * array element, `return`, arrow body and ternary all find a block; a template substitution is the
 * only position that does not.
 */
export function checkTemplates(source: string): Finding[] {
  return blocksInATemplate(source).map((at: number) => ({
    rule: "block-in-a-template" as const,
    at,
    length: 3,
    message:
      `a style block inside a \`\${ … }\` compiles to nothing — a template literal is text, and ` +
      `nothing here can see a block in one.\n\n        Join it with \`mergeClassNames\` instead: ` +
      `\`className={mergeClassNames(@@( … ), "lead")}\`, which takes a block and a class name of ` +
      `your own and ` +
      `keeps one class per thing set.`,
  }));
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
    if (opensCode(source, index)) {
      // Code, stepped over whole: a `//` inside `$( … )` is TypeScript's comment, not CSS's fault.
      // Not `indexOf(")")` — see `closingHole`, which three scanners share for exactly this reason.
      //
      // A `{` that opens a nested RULE is deliberately NOT stepped over: a `//` inside one is the
      // same fault as a `//` anywhere else, and skipping the body would take it with it.
      const close = closingHole(source, index + 1);
      index = close === -1 ? end : close - 1;
      continue;
    }
    if (code === 40 /* ( */) parens++;
    else if (code === 41 /* ) */) parens = Math.max(0, parens - 1);
    else if (parens === 0 && code === 47 && source.charCodeAt(index + 1) === 47) {
      findings.push({
        rule: "line-comment",
        at: index,
        length: 2,
        message: LINE_COMMENT,
      });
      /**
       * **Every one of them**, not only the first.
       *
       * TypeScript refuses EVERY line comment, because the virtual file writes the comment and the
       * next property as one key, and `check.ts` drops that duplicate only where a rule of ours
       * already spoke. Reporting one per block left a file with three comments showing one good
       * message and two reading *"'\"// two\\n color\"' does not exist in type"*. Reporting each
       * one leaves the compiler nothing to say badly.
       *
       * The rest of the LINE is still skipped — a second `//` on the same line is inside the first
       * one's text and is not a second fault.
       */
      const newline = source.indexOf("\n", index);
      index = newline === -1 || newline >= end ? end : newline;
      continue;
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
/**
 * What the rules need to know about a block beyond the block itself.
 *
 * An OBJECT rather than more positional parameters, and the reason is this repository's recurring
 * fault: one rule with several consumers, one of which quietly passes less than the others. Four
 * positional arguments across three call sites was already the shape that goes wrong — a new one is
 * added in one place and forgotten in two, and nothing says so.
 */
export interface CheckOptions {
  /** The at-rule this block IS, when it is a named site — `property`, `keyframes`, `font-face`. */
  readonly at?: string;
  /**
   * Where the site's `@@` is in the author's file — for a fault about something MISSING, which has
   * no character of its own to stand on. See `propertyDescriptorMissing`.
   *
   * **Passed by the build only.** The editor and `ramonda-check` run the type check, whose
   * `CssPropertyDescriptors` already says a descriptor is missing; giving them this too would report
   * one fault twice. The build runs no type check, so there it is the only thing that says so.
   */
  readonly start?: number;
  /**
   * Whether a RELATIVE `url( … )` names a file that exists, beside the source file — and that file's
   * name, for the message. Handed in by whoever has the disk (`urlCheckFor`); absent, the rule is off.
   */
  readonly urlExists?: (relative: string) => boolean;
  readonly fileName?: string;
  /** Binding -> the generated name it resolves to. See {@link namedSites}. */
  readonly references?: ReadonlyMap<string, string>;
  /** Generated name -> the `syntax` its `@@property` declared. See {@link syntaxesIn}. */
  readonly syntaxes?: ReadonlyMap<string, string>;
  /** The project's own settings, which decide what is a fault HERE rather than in CSS. */
  readonly config?: Config;
}

export function checkBlock(written: AnyBlock, options: CheckOptions = {}): Finding[] {
  const { at, start, references, syntaxes, config } = options;
  const findings: Finding[] = [];
  blockMatchArms(written.items, findings);
  // Asked of the block as written: the arms below become groups, and their keys go with them.
  matchArms(written, findings);
  const block: Block = { items: asGroups(written.items) };
  walk(block.items, findings, at === undefined ? undefined : at.toLowerCase());
  overrideOutOfOrder(block, findings);
  narrowerAfterAWholeShorthand(block, findings);
  resetsDifferAcrossEngines(block, findings);
  valueDiffersAcrossEngines(block, findings);
  holeAsAVariableName(block, findings);
  mediaFeatures(block, findings);
  spelling(block, findings);
  layerInABlock(block, findings);
  rootInABlock(block, findings);
  spreadOutOfPlace(block, findings);
  if (at !== undefined) holeInANamedBlock(block, at, findings);
  if (at !== undefined) compositionInANamedBlock(block, at, findings);
  if (syntaxes !== undefined && syntaxes.size > 0) againstRegisteredSyntax(block, syntaxes, findings);
  if (config?.units !== undefined) unitNotAllowed(block, config.units, findings);
  /**
   * The per-property half, with anything the sweep above already named left out.
   *
   * `units` at the top of the config and `units` inside `properties` are different mechanisms with
   * one name, and setting both would report the same value twice. One value, one fault, one report;
   * two different units in one value are still two.
   */
  unitNotAllowedPerProperty(block, config?.properties, findings);
  valueNotAllowed(block, config?.properties, findings);
  shorthandNotAllowed(block, config?.properties, findings);
  // Not inside a named site. `@@keyframes`, `@@font-face` and `@@property` hold frames and
  // descriptors rather than an element's declarations, and `hole-in-a-named-block` already reports a
  // hole in one — in its own words, about its own shape. Two reports on one character is one too many.
  if (at === undefined) holeNotAllowed(block, findings);
  if (at?.toLowerCase() === "property" && start !== undefined) propertyDescriptorMissing(block, at, start, findings);
  if (at?.toLowerCase() === "property") initialValueAndSyntax(block, findings);
  if (references !== undefined && references.size > 0) setByAnotherName(block, references, findings);
  if (config !== undefined) unknownVariable(block, config, findings);
  if (config !== undefined) variableByHand(block, config, findings);
  if (config !== undefined) setAgainstItsDeclaration(block, config, findings);
  // An ordinary block only: a `@@keyframes` frame (`from`, `50%`) is not a selector, and a named
  // site styles no element of its own to keep to.
  if (config?.styleOtherElements === false && at === undefined) stylesAnotherElement(block, findings);
  if (options.urlExists !== undefined) urlNotFound(block, options.urlExists, options.fileName ?? "this file", findings);
  if (config?.unknownCustomProperties === false || config?.unknownCustomProperties === "same-block") {
    unknownCustomProperty(block, config, references, findings);
  }
  tooManyValues(block, config?.properties, findings);
  {
    // A declaration SETTING a token is where a colour is written — that is a theme — and its value
    // is the range's to judge (`token-set-against-its-declaration`). Without this, a ranged token
    // set to a value in its range was refused as a hardcoded colour: two rules saying opposite
    // things about one line. So `hardcoded` stands aside on it, whichever of its paths reported.
    const before = findings.length;
    literalNotAllowed(block, config?.properties, findings);
    const tokens = config === undefined ? undefined : declaredByName(config);
    if (tokens !== undefined && tokens.size > 0 && findings.length > before) {
      const spans: [number, number][] = [];
      const collect = (items: readonly BlockItem[]): void => {
        for (const item of items) {
          if (item.kind === "rule") collect(item.items);
          else if (tokens.has(item.property.trim()) && item.at !== undefined)
            spans.push([item.at, item.end ?? item.at]);
        }
      };
      collect(block.items);
      const settingAToken = (at: number) => spans.some(([from, to]) => at >= from && at <= to);
      const kept = findings
        .splice(before)
        .filter((one) => one.rule !== "hardcoded-not-allowed" || !settingAToken(one.at));
      findings.push(...kept);
    }
  }
  doesNothing(block, findings);
  // After every rule that reads a VALUE, because it stays quiet where one has already named the
  // same word — see its own note.
  wordOutOfItsLonghand(block, findings);
  // LAST, because it stays quiet wherever another rule has already spoken — see its own note.
  unclosedCall(block, findings);
  missingSemicolon(block, findings);
  const once = outermost(block, findings);

  const silenced = config?.rules;
  const kept = silenced === undefined ? once : once.filter((one) => silenced[one.rule] !== "off");
  return kept.sort((a, b) => a.at - b.at);
}

/**
 * The rules a project's CONFIG turns on, in the order the fixes they ask for NEST.
 *
 * A declaration is decided outside in — which property, then how many values, then where the value
 * comes from, then how it is spelt — and each later answer is a detail of the earlier one. So when
 * more than one of these fires on one declaration, the outermost unanswered question is the one to
 * ask, and the rest are about a declaration the author is still deciding the shape of.
 *
 * Reading them the other way round is the case that shows why this is an order and not a
 * preference: `letter-spacing: 2rem` under `units: { length: ["px"] }` and a `<length>` taken from
 * variables reports the unit AND the literal. Following the unit gives `2px`, which the same config
 * still refuses — a round trip ending where the other message would have started them.
 */
const NESTED: readonly RuleId[] = [
  "shorthand-not-allowed",
  "too-many-values",
  "hardcoded-not-allowed",
  // The closed LIST before the unit: the unit is a detail of a value that is not on the list, and
  // reading it first sends the author to `2px` — which the list still refuses. The same round trip
  // `hardcoded-not-allowed` is placed above `unit-not-allowed` to avoid.
  "value-not-allowed",
  "unit-not-allowed",
];

/**
 * One finding per declaration among {@link NESTED}, and every other finding untouched.
 *
 * **Per DECLARATION**, the same unit the editor and `check.ts` use to drop the compiler's repeats:
 * a line holds as many declarations as an author cares to write, and two faults on one line are two
 * faults. The positions do not line up either — `shorthand-not-allowed` sits on the property and
 * `hardcoded-not-allowed` on the value — so nothing narrower than the declaration could group them.
 *
 * Anything outside this list is left alone on purpose. These are the ones a project SWITCHED ON, so
 * they overlap by construction; CSS's own rules do not. Measured, `width: 2rem` under a closed list
 * and a units list gives both *`2rem` is not one of the values* and *`rem` is a unit this project
 * does not use*, for one word — which is why `value-not-allowed` is among them.
 */
function outermost(block: Block, findings: readonly Finding[]): Finding[] {
  if (findings.length < 2) return [...findings];

  const dropped = new Set<Finding>();
  for (const item of declarationsIn(block)) {
    if (item.at === undefined || item.end === undefined) continue;

    const here = findings.filter((one) => NESTED.includes(one.rule) && one.at >= item.at! && one.at <= item.end!);
    if (here.length < 2) continue;

    const keep = here.reduce((a, b) => (NESTED.indexOf(a.rule) <= NESTED.indexOf(b.rule) ? a : b));
    /**
     * Only a DIFFERENT rule is dropped. Two findings of the SAME one are two faults, not two words
     * about one — measured, `padding: 2rem 3em` names both units, and collapsing them would fix
     * one and re-report the other on the next save.
     */
    for (const one of here) if (one.rule !== keep.rule) dropped.add(one);
  }
  return findings.filter((one) => !dropped.has(one));
}

/**
 * The three forms a `@@name( … )` may take, and the one place they are written down.
 *
 * A second copy is how a misspelt name gets type-checked as an ORDINARY block: no surface means no
 * named check, and the ordinary one takes over. `SURFACES` reads this, and so does the rule below.
 */
/**
 * The rules that say what the TYPES also refuse, and the compiler codes they speak over.
 *
 * Both the checker and the editor drop the compiler's word where one of these has spoken; with only
 * part of the list, the editor shows two messages for one fault — a rule's sentence beside a raw
 * `Narrowed<…>`, which reads as a contradiction.
 *
 * One list, both consumers, so the next rule added here cannot reach one and not the other.
 *
 * `TS2353` is *does not exist in type*, which a REMOVED shorthand gets rather than *is not
 * assignable*; `TS2561` is the compiler's own *did you mean* for a bare property name.
 */
export const SPEAKS_OVER_TYPES: readonly RuleId[] = [
  "hardcoded-not-allowed",
  "unit-not-allowed",
  "value-not-allowed",
  "shorthand-not-allowed",
  "unknown-property",
  /**
   * A quoted value, where the type's own word is unreadable: measured, `z-index: "1"` gives
   * *Type '"\"1\""' is not assignable* — the author's quotes escaped inside the compiler's own
   * quotes. The rule says the quotes are part of a CSS string and a browser drops the declaration.
   */
  "string-not-allowed",
];

/** The compiler codes those rules replace. See {@link SPEAKS_OVER_TYPES}. */
export const REPLACED_CODES: readonly number[] = [2322, 2353, 2561];

export const NAMED_BLOCKS = ["keyframes", "font-face", "property"] as const;

/**
 * A `@@name( … )` whose name is not one this compiles.
 *
 * The type check alone does not catch it, and gets it worse than wrong: with no surface for it,
 * `@@keyfrmes( … )` is checked as an ordinary block, so `from { … }` is read as the selector `&
 * from` and the report talks about a nested rule. A wrong message is worse than none, because it
 * sends a person to the wrong line.
 */
export function checkNamedSite(site: BlockSite): Finding[] {
  if (site.at === undefined || (NAMED_BLOCKS as readonly string[]).includes(site.at)) return [];

  const meant = nearest(site.at, NAMED_BLOCKS as readonly string[]);
  return [
    {
      rule: "unknown-named-block",
      at: site.opening,
      length: site.open + 1 - site.opening,
      message:
        `\`@@${site.at}( … )\` is not something this compiles — the named forms are ` +
        `${NAMED_BLOCKS.map((one) => `\`@@${one}( … )\``).join(", ")}.` +
        (meant === undefined ? "" : ` Did you mean \`@@${meant}( … )\`?`),
    },
  ];
}
export { INERT_SUBJECTS } from "./doesNothing";

/* ── the near miss ─────────────────────────────────────────────────────────────────────────── */

/** Re-exported where it has always been imported from. See `./nearest`. */
export { nearest } from "../nearest";
