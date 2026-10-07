/** Rules for a block's logic: a runtime value, a `match` and its arms, a spread. */

import { childrenOf, runtimeValuesIn, type Block as AnyBlock, type BlockItem as AnyItem } from "../ast";
import { propertyName } from "../normalise";
import { ESCAPE, MATCH, SPREAD, branchOf, holeIn } from "../read";
import { holeOutOfPlace } from "../errors";
import { type Block, type BlockItem } from "./shared";
import { type Finding } from "./index";

/**
 * A RUNTIME value in a declaration — `color: $(this.brand)`. **Refused, everywhere.**
 *
 * ## Why
 *
 * A hole is a per-element cost. Measured, the same colour written two ways: `color: red` emits
 * `r-c-red { color:red; }` and the element carries a class, while `color: $(this.brand)` emits
 * `color:var(--r-…-0)` and every instance carries an inline custom property. A list of ten thousand
 * rows is ten thousand style attributes.
 *
 * And it cannot be shared. A hole belongs to the declaration it stands in, so two declarations
 * wanting one value get two custom properties:
 *
 *     padding-left: $(this.v); padding-right: $(this.v);         TWO variables
 *     padding-left: var($(pad)); padding-right: var($(pad));     ONE, however many read it
 *
 * ## What to write instead
 *
 * Two doors, and between them they cover what a hole is reached for:
 *
 * - **`match`**, for variation that can be ENUMERATED — which is most of it. Every arm is its own
 *   rule and its own class, so nothing is built while the page renders.
 * - **`@@property`**, for a value that genuinely comes from data. One declared name, read by as
 *   many declarations as want it, set once on the element.
 *
 * ## What is NOT a hole, though it is written with `$( )`
 *
 * `$( )` is still how an expression gets in; what is refused is a value in a declaration.
 * `when $(this.on) { … }` and `...$(on ? hot : cold)` choose between whole rules and write nothing
 * on the element. `match $(this.variant)` chooses between classes. `var($(angle))` and `$(angle):
 * 45deg` name a `@@property` site, which is text by the time the CSS is written.
 *
 * ## A declared variable is not a hole either — but the `$( )` decides, not the name
 *
 * Measured: `color: $color.brand` written bare parses as a `VariablePart` and becomes a `var()` in
 * the stylesheet, while `color: $($color.brand)` — the same variable, inside `$( )` — parses as a
 * `HolePart` and would set a custom property per element. So the second is reported and the bare
 * spelling is the fix. `var(--brand)` written out is ordinary text and is never asked about.
 */
export function holeNotAllowed(block: Block, findings: Finding[]): void {
  for (const { declaration, part } of runtimeValuesIn(block)) {
    const property = propertyName(declaration.property);

    findings.push({
      rule: "hole-not-allowed",
      at: part.at ?? declaration.at ?? 0,
      length: part.length ?? declaration.property.length,
      message:
        `A style block takes no runtime value, and \`${property}\` is given one.\n\n` +
        `        If the value is one of a few, write them out with \`match\`:\n` +
        `        \`${property}: match $(…) { a => …; _ => …; }\` — every arm is its own class.\n` +
        `        If it really comes from data, declare it with \`@@property( … )\` and set it on\n` +
        `        the element. To pick between whole rules, \`when $(…) { … }\` still does.`,
    });
  }
}

/**
 * What a `match` may hold, and the three things it may not.
 *
 * ## A hole in an ARM
 *
 * The whole reason a match can become classes is that every arm was decided when the block
 * compiled. A hole is the render's own value, so an arm holding one would have to become a custom
 * property — and then the match would cost exactly what it exists to avoid. The SUBJECT is a hole
 * and is untouched: it chooses between the arms and never reaches the element.
 *
 * ## A key written twice
 *
 * The arms are tried in order and the first that answers wins, so a repeat can never be reached.
 * A `_` written above another arm is the same fault: it answers for everything, so everything below
 * it is dead. Reported at the arm that can never run, which is the one to delete or move.
 *
 * ## No arms at all
 *
 * `match $(v) { }` reads, and sets nothing whatever the subject is. That is a declaration written
 * and then taken back, which is worth a word rather than a silent nothing — unlike `when $(c) { }`,
 * which mirrors an empty at-rule CSS itself allows.
 */
/**
 * The keys of a block-level match: none at all, one written twice, and one below `_` — the same
 * three faults a value match's keys can have, in the same words.
 */
export function blockMatchArms(items: readonly AnyItem[], findings: Finding[]): void {
  for (const item of items) {
    if (item.kind === "declaration") continue;
    if (item.kind === "rule") {
      blockMatchArms(item.items, findings);
      continue;
    }
    if (item.arms.length === 0) {
      findings.push({
        rule: "match-with-no-arms",
        at: item.at ?? 0,
        length: MATCH.length,
        message:
          "a `match` with no arms sets nothing, whatever its subject is.\n\n        Write an arm, or take it out.",
      });
    }
    armKeys(item.arms, item.at, findings);
    for (const arm of item.arms) blockMatchArms(arm.items, findings);
  }
}

/** Two arms with one key, and an arm below `_`: the second can never answer. */
function armKeys(
  arms: readonly { readonly key: string; readonly otherwise: boolean; readonly at?: number }[],
  at: number | undefined,
  findings: Finding[],
): void {
  const seen = new Set<string>();
  let answered = false;
  for (const arm of arms) {
    const repeated = seen.has(arm.key);
    if (repeated || answered) {
      findings.push({
        rule: "match-arm-repeated",
        at: arm.at ?? at ?? 0,
        length: arm.key.length,
        message: repeated
          ? `\`${arm.key}\` is matched twice, and the arm above answers first — so this one ` +
            "never runs.\n\n        Take it out, or give it the key it was meant to have."
          : `\`_\` above this answers for everything, so \`${arm.key}\` never runs.` +
            "\n\n        Write `_` last, where it is the fallback rather than the answer.",
      });
    }
    seen.add(arm.key);
    if (arm.otherwise) answered = true;
  }
}

export function matchArms(block: AnyBlock, findings: Finding[]): void {
  const walkItems = (items: readonly AnyItem[]): void => {
    for (const item of items) {
      if (item.kind !== "declaration") {
        walkItems(childrenOf(item));
        continue;
      }
      for (const part of item.value) {
        /**
         * A CHOICE's branches are values decided when the block compiles, exactly as a match's arms
         * are, so a runtime value in one is the same fault, said in the same words.
         */
        if (part.kind === "choice") {
          const branches = [...part.branches.map((one) => one.value), part.otherwise];
          for (const inside of branches.flat()) {
            if (inside.kind !== "hole") continue;
            findings.push({
              rule: "hole-in-a-match-arm",
              at: inside.at ?? part.at ?? 0,
              length: inside.length ?? 1,
              message:
                "a branch of a choice is a value decided when the block compiles, so it cannot hold one " +
                "the render computes.\n\n        Write the value out — every branch becomes a class, " +
                "and the condition picks one.",
            });
          }
          continue;
        }
        if (part.kind !== "match") continue;

        if (part.arms.length === 0) {
          findings.push({
            rule: "match-with-no-arms",
            at: part.at ?? item.at ?? 0,
            length: MATCH.length,
            message:
              "a `match` with no arms sets nothing, whatever its subject is.\n\n        Write an " +
              "arm, or take the declaration out.",
          });
          continue;
        }

        for (const arm of part.arms) {
          for (const inside of arm.value) {
            if (inside.kind !== "hole") continue;
            findings.push({
              rule: "hole-in-a-match-arm",
              at: inside.at ?? arm.at ?? 0,
              length: inside.length ?? 1,
              message:
                "an arm is a value decided when the block compiles, so it cannot hold one the " +
                "render computes.\n\n        Write the value out, or match on it instead — " +
                "`match $(…) { … }` is how a value that varies becomes\n        one of several " +
                "that do not.",
            });
          }
        }
        armKeys(part.arms, part.at, findings);
      }
    }
  };
  walkItems(block.items);
}

/**
 * A SPREAD inside a selector or a conditional at-rule, which cannot mean anything.
 *
 * A spread merges a whole block, and a block's map carries the context each of its declarations was
 * written in. Inside `&:hover` it would have to re-scope every key it holds — `background` becoming
 * `:hover|background` — which a merge cannot do at runtime. A GUARD is fine: `when` changes no key,
 * it only decides whether the whole map lands.
 *
 * A rule rather than a refusal inside `transform` alone, so the editor and `ramonda-check` say it
 * too. The transform refuses because this reports, which is what makes the two answers one answer.
 */
export function spreadOutOfPlace(block: Block, findings: Finding[]): void {
  const walkItems = (items: readonly BlockItem[], scoped: boolean): void => {
    for (const item of items) {
      if (item.kind === "rule") {
        // A guard is not a scope: `when` decides whether the map lands, and changes no key in it.
        const guard = branchOf(item.prelude) !== undefined;
        walkItems(item.items, scoped || !guard);
        continue;
      }
      if (!scoped || holeIn(item.property, SPREAD) === undefined) continue;

      findings.push({
        rule: "spread-out-of-place",
        at: item.at ?? 0,
        length: item.property.length,
        message:
          "a spread merges a whole block, and a block carries the context its own declarations " +
          "were written in — so it cannot go inside a selector or a `@media`. Write it at the " +
          "top level of the block, or inside `when $( … ) { … }`, which changes no declaration.",
      });
    }
  };
  walkItems(block.items, false);
}

/**
 * A hole where a custom property cannot go: a property name, a selector, a whole declaration.
 *
 * The build refuses these outright — a custom property holds a VALUE, so there is no correct
 * compilation — and this exists to say it FIRST, in an editor, while it is being typed rather than
 * at the end of a build. It is reachable only from a forgiving parse, which is what an editor uses.
 */
export function holeInHead(
  text: string,
  at: number | undefined,
  what: "a declaration" | "a property name" | "a selector" | "a frame",
  findings: Finding[],
): void {
  const found = text.indexOf(ESCAPE);
  if (found === -1 || at === undefined) return;

  // The `$(`, which is where the author has to move something. The expression's own length is not the
  // fault and underlining it would say the expression is wrong.
  findings.push({ rule: "hole-out-of-place", at: at + found, length: 1, message: holeOutOfPlace(what) });
}
