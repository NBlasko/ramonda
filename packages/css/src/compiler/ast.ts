/**
 * A parsed block, which is what normalisation works on rather than the author's text.
 *
 * The distinction is the reason `color : red` and `color:red` share a class. Normalising TEXT can
 * only collapse whitespace it cannot interpret — the space before a `:` in a declaration is
 * meaningless and the space before a `:` in `& :first-child` is a combinator, and nothing that
 * reads characters can tell them apart. Once the block is parsed, the whitespace the author wrote
 * around the colon is not in the structure to begin with.
 *
 * Everything from the class name to the stylesheet is defined in terms of this.
 */

/** One block: an ordered list of items. Order is meaning and is never sorted. */
export interface Block {
  readonly items: readonly BlockItem[];
}

export type BlockItem = Declaration | NestedRule | BlockMatch;

/** `border-left: 4px solid $(this.accent)`. */
export interface Declaration {
  readonly kind: "declaration";
  /**
   * Where the property name starts in the author's file, and where its value does.
   *
   * Provenance, not content: normalisation never reads either, so two blocks written in different
   * files still hash the same. They exist for the virtual file, which has to send a diagnostic about
   * a key or a value back to the character the author typed.
   *
   * Optional because a block built by hand has no source to point at — the parser always sets them.
   */
  readonly at?: number;
  readonly valueAt?: number;
  /**
   * Where the declaration finished in the author's file.
   *
   * Earns three things at once: the length of the value's own text, the boundary an editor's caret
   * has to be inside to belong to this declaration, and the point after which a caret belongs to
   * nothing yet — which is where a virtual file for an editor puts an empty slot.
   */
  readonly end?: number;
  /**
   * The property, as written. Case is folded for a normal property because CSS reads it that way,
   * and kept for a custom property (`--Accent`) because CSS does not.
   */
  readonly property: string;
  /**
   * Whether the author wrote the `;`. CSS lets the last one in a block go without.
   *
   * Recorded because this package does not: a declaration with no `;` swallows whatever is written
   * under it next, so a line that is legal today changes the meaning of the line above it tomorrow.
   * See the `missing-semicolon` rule.
   */
  readonly terminated?: true;
  /** The value, split wherever a hole interrupts it. */
  readonly value: readonly ValuePart[];
}

/**
 * `&:hover { … }`, `& .title { … }`, `@media (min-width: 40rem) { … }`.
 *
 * The prelude is kept verbatim. A pseudo-class is case-insensitive and a class name is not, so
 * nothing here may fold case — `&.Card` and `&.card` are different selectors.
 */
export interface NestedRule {
  readonly kind: "rule";
  /** Where the prelude starts in the author's file. See {@link Declaration.at}. */
  readonly at?: number;
  /** Where the prelude ENDS — its `{`. See {@link Declaration.end}. */
  readonly preludeEnd?: number;
  readonly prelude: string;
  readonly items: readonly BlockItem[];
}

/**
 * `match $(this.tone) { hot => ( color: red; padding: 4px; ); _ => ( color: gray; ); }` — a match
 * whose arms are whole groups of declarations rather than one value.
 *
 * It compiles exactly as a {@link MatchPart} does: every declaration in every arm is its own class,
 * and the render picks one arm's classes by the subject. The two shapes are one feature at two
 * levels, so they share the subject's numbering and the `_` arm, and differ only in what an arm
 * holds. An arm holds declarations and nested rules; composition — a condition, a spread, another
 * match — is refused inside one, because an arm is a set of classes known at build time.
 */
export interface BlockMatch {
  readonly kind: "match";
  /** Where `match` begins, and where the closing brace of its arms ends. */
  readonly at?: number;
  readonly end?: number;
  /** The subject's hole, as {@link MatchPart.hole}. */
  readonly hole: number;
  readonly arms: readonly BlockArm[];
}

/** One arm of a {@link BlockMatch}: what the subject must be, and what applies then. */
export interface BlockArm {
  /** The key as written, unquoted — see {@link MatchArm.key}. */
  readonly key: string;
  readonly otherwise: boolean;
  /** Where the key begins, and how far the arm runs to its `;`. */
  readonly at?: number;
  readonly length?: number;
  readonly items: readonly BlockItem[];
}

export type ValuePart = TextPart | HolePart | VariablePart | MatchPart | ChoicePart;

/**
 * `$(this.error) ? 2px solid red : 1px solid #ccc` — a choice between values, by conditions.
 *
 * A {@link MatchPart} for the case with two answers, and compiled the same way: every branch is a
 * value known when the block compiles, so every branch is a class and the render only chooses. A
 * chain — `$(a) ? x : $(b) ? y : z` — is one part with several branches, each condition its own
 * hole, written once and in order. The final `: value` is mandatory and is {@link otherwise}.
 *
 * Like a match it is the WHOLE value or it is not a choice.
 */
export interface ChoicePart {
  readonly kind: "choice";
  readonly branches: readonly ChoiceBranch[];
  /** The value after the last `:`, which applies when no condition held. */
  readonly otherwise: readonly ValuePart[];
  readonly at?: number;
  readonly length?: number;
}

/** One `$(condition) ? value` of a {@link ChoicePart}. */
export interface ChoiceBranch {
  /** The condition's hole, in the reader's numbering — see {@link MatchPart.hole}. */
  readonly hole: number;
  readonly value: readonly ValuePart[];
  readonly at?: number;
  readonly length?: number;
}

/**
 * `match $(this.variant) { primary => red; _ => inherit; }` — one subject, several answers.
 *
 * ## Why it is not a hole
 *
 * A hole carries the render's own value onto the element, as a custom property. A match carries
 * nothing: every arm is known when the block compiles, so every arm is a CLASS, and the render only
 * chooses between them. That is the whole of why it exists — it takes variation that is enumerable
 * and turns it back into the thing a stylesheet can hold.
 *
 * ## Why the arms are `ValuePart[]` and not text
 *
 * An arm holds a whole value — `4px solid red`, or `$color.accent`, which must reach the virtual
 * file as a real expression the same way it does anywhere else. **A hole inside an arm is refused**,
 * because it would put the render's value back where a class is supposed to be; that is a rule
 * rather than a shape, so the parser reads one and the checker speaks about it.
 *
 * ## What it is NOT
 *
 * Pattern matching. The subject is one expression, the arms are literals, and there is no
 * destructuring, no guard and no custom matcher. The name is borrowed for how it reads.
 */
export interface MatchPart {
  readonly kind: "match";
  /**
   * The subject's hole, by the same index a condition's is recorded under.
   *
   * It is a hole in the READER's numbering because that is how an expression reaches the emit —
   * see `ReadBlock.holes`. It is not a hole in the sense the value-level rules mean, and nothing
   * downstream should treat it as one: it selects, it does not carry.
   */
  readonly hole: number;
  readonly arms: readonly MatchArm[];
  /** Where `match` begins in the author's file, and how far its closing brace is. */
  readonly at?: number;
  readonly length?: number;
}

/** One arm: what the subject must be, and what the declaration is then. */
export interface MatchArm {
  /**
   * The key as the author wrote it, unquoted — `primary`, `12`, `extra large`.
   *
   * A string rather than a parsed literal, because what it means is the SUBJECT's business: the
   * virtual file compares it against the subject's own type, which is where a key that cannot occur
   * is caught. The parser has no types and asks for none.
   */
  readonly key: string;
  /** `_`, which answers for everything the arms above did not. */
  readonly otherwise: boolean;
  readonly value: readonly ValuePart[];
  /** Where the key starts, for a diagnostic about this arm rather than about the match. */
  readonly at?: number;
  readonly length?: number;
}

/**
 * `$color.primary.main` — a variable the PROJECT declared, named by the path it was declared at.
 *
 * ## Why this is not resolved text
 *
 * A `$(…)` naming a `@@property` site becomes a {@link TextPart} with `resolved` set, because
 * nothing after the parse needs the author's spelling of it again. This is the opposite case: the
 * virtual file emits `$color.primary.main` as a REAL TypeScript expression, and that expression is
 * where completion, the kind check and rename all come from. Flattening it to text here would throw
 * away the one thing that makes the spelling worth having.
 *
 * ## What the parser does NOT do
 *
 * Resolve it. A path is a path until something holding the project's declarations says what it
 * names and what it falls back to — the parser has no config and asks for none, which is what keeps
 * it usable from the editor, the CLI and the bundler alike.
 */
export interface VariablePart {
  readonly kind: "variable";
  /**
   * The path as written, WITHOUT the leading `$.` — `color.primary.main`.
   *
   * May be empty. `$.` with nothing after it is the ordinary half-typed state in an editor, and a
   * part with an empty path is what gives the virtual file somewhere to put the caret; text there
   * would mean no completion after the dot.
   */
  readonly path: string;
  /** Where the `$` is in the author's file. See {@link Declaration.at}. */
  readonly at?: number;
  /** How far the path runs, so a squiggle covers `$color.primary.main` and not a character of it. */
  readonly length?: number;
  /**
   * Whether the author's last character is a DOT — `$.` or `$color.`, a path being typed.
   *
   * Carried because the virtual file has to emit that dot: without it `$color.` becomes
   * `__vars.color` and the language service sees a finished expression rather than a member access
   * in progress, so it offers nothing. Measured as an empty completion list exactly where the
   * variable groups belong.
   */
  readonly open?: true;
}

export interface TextPart {
  readonly kind: "text";
  /** Where this run of text starts in the author's file. See {@link Declaration.at}. */
  readonly at?: number;
  readonly text: string;
  /**
   * Text this COMPILER decided, not text the author wrote — a `$(…)` that named a `@@keyframes` or
   * `@@property` site and was resolved to that site's generated name.
   *
   * It is text for every purpose that matters: part of the hash, no custom property, and it stands
   * where a hole may not. But **nothing in it can be a fault.** A generated name cannot be a typo
   * of anything, and there is no position in the author's file to point a squiggle at — `at` is
   * where the `{{` was, and the text is a different length.
   *
   * The checker skips it for exactly that reason: the function step-over in `words()` works within
   * one part, so `rotate(var(`, the name and `))` are three parts, and without this `transform:
   * rotate(var($(angle)))` would be reported while the same text written by hand is silent.
   */
  readonly resolved?: true;
  /**
   * Where the expression a resolved reference was written as sits in the author's file — `spin` in
   * `$(spin)`. The text above is the site's generated NAME, so without this nothing the virtual
   * file holds would read the binding, and every linter called it unused. See `virtualFile`.
   */
  readonly reference?: { readonly at: number; readonly length: number };
}

/**
 * A carried expression, identified only by its position in the block.
 *
 * What the expression IS never reaches here, and that is the point: two blocks with identical CSS
 * and different expressions are one class and one rule, each element carrying its own value. The
 * expression's own bytes stay in the author's file, which is also what keeps the source map honest.
 */
export interface HolePart {
  readonly kind: "hole";
  /** 0-based, in source order within the block. */
  readonly index: number;
  /**
   * Where the `$(` is in the author's file, and how far the `)` is — for a squiggle over the hole
   * itself. See {@link Declaration.at}.
   *
   * The EXPRESSION still never reaches here, which is the point of the note above: this is a span,
   * the same thing {@link TextPart.at} is, and it is what lets a rule about a hole's POSITION point
   * at the hole rather than at the declaration holding it.
   */
  readonly at?: number;
  readonly length?: number;
}

/**
 * The items a group holds — a nested rule's, or every arm's of a block match, in the order written.
 *
 * For a walk that asks what a block SETS and not how it is chosen. One that compares declarations
 * with each other must treat each arm as its own group, because two arms never apply together.
 */
export function childrenOf(item: NestedRule | BlockMatch): readonly BlockItem[] {
  return item.kind === "rule" ? item.items : item.arms.flatMap((arm) => arm.items);
}

/**
 * Every RUNTIME value in a block — a hole standing in a declaration's value — with the declaration
 * holding it, for `hole-not-allowed`, which points at each one's POSITION.
 *
 * **`ReadBlock.holes` is not the same list:** composition is written with the same escape, so
 * `...$(base)` and `when $(on)` are in the reader's holes while neither puts anything on an
 * element. Only a hole in a VALUE does.
 */
export function runtimeValuesIn(block: Block): readonly { declaration: Declaration; part: HolePart }[] {
  const found: { declaration: Declaration; part: HolePart }[] = [];
  const inItems = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      if (item.kind !== "declaration") {
        inItems(childrenOf(item));
        continue;
      }
      for (const part of item.value) if (part.kind === "hole") found.push({ declaration: item, part });
    }
  };
  inItems(block.items);
  return found;
}

/**
 * A value's text when it is text and nothing else — no hole, no `$` token, no choice, no match — or
 * `undefined` when it holds any of those.
 *
 * Seven readers ask this; a value that holds anything but text is decided somewhere else, and each
 * of them stops there.
 */
export function textOnly(value: readonly ValuePart[]): string | undefined {
  let text = "";
  for (const part of value) {
    if (part.kind !== "text") return undefined;
    text += part.text;
  }
  return text;
}

/**
 * Every run of plain text a value holds, including inside each branch of a choice and each arm of a
 * match — the text a value may put on an element, wherever it sits.
 */
export function textPartsOf(value: readonly ValuePart[]): TextPart[] {
  return value.flatMap((part) =>
    part.kind === "text"
      ? [part]
      : part.kind === "choice"
        ? [...part.branches.flatMap((branch) => textPartsOf(branch.value)), ...textPartsOf(part.otherwise)]
        : part.kind === "match"
          ? part.arms.flatMap((arm) => textPartsOf(arm.value))
          : [],
  );
}
