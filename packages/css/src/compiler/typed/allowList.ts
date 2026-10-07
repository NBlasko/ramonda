/**
 * What is wrong with an allow-list itself: a state typed as a tuple, an `interface` that no block can
 * match, and a value in it that is not CSS.
 *
 * A typed rule — see `index.ts` for what separates these from the rules in `rules/`.
 */
import { AT_RULE_LINKS, NOT_IN_A_RULE, PROPERTIES } from "../keywords.generated";
import { type TypedFinding } from "./index";
import { branded } from "./shared";
import { checkBlock } from "../rules";
import { findBlocks } from "../scan";
import { readBlock } from "../read";
import ts from "typescript";

/**
 * A state in an allow-list written as a one-element TUPLE — `[{ … }]` where `{ … }[]` was meant.
 *
 * ## What the fault is
 *
 * A nested rule compiles to one object literal PER DECLARATION, in an array:
 *
 *     @@( &:hover { color: blue; padding: 4px; } )   ->   {"&:hover":[{color},{padding}]}
 *
 * That shape is deliberate — TypeScript reports one excess property per object literal, so a
 * literal each is what makes every fault in a block come back at once instead of one per run.
 *
 * **A one-element tuple types element 0 and nothing else.** The first declaration inside the state
 * is checked against the allow-list and every declaration under it is accepted whatever it sets, so
 * a slot that reads as if it constrains a state constrains only its first line. Measured on this
 * repository's own playground, the same `float: left` inside a `&:hover` a `Chip` does not allow:
 *
 *     first declaration in the state    TS2353
 *     second                            silent
 *
 * `{ … }[]` gives every element the contextual type and reports all of them. It needs no change
 * anywhere else: the emitter already writes an array, and `CssBlockShape` already says
 * `CssBlockShape[]`.
 *
 * ## Why it needs a rule rather than a line in the documentation
 *
 * Because there is nothing else to meet. The tuple type-checks, the build passes, the slot half
 * works, and the half that does not is invisible from the call site — the caller writes a property
 * the component never offered and is told nothing. A page can say `{ … }[]`; this is what says it
 * to somebody who did not read the page.
 *
 * ## What it does NOT report, and why the bar is where it is
 *
 * A tuple of MORE than one element is left alone: every element then has a contextual type, so the
 * slot holds. It is an odd thing to write and it is not wrong.
 *
 * And a tuple is only this fault under a key that is really CSS — see `opensAState`, which is where
 * the weight is carried. The element is asked a second, weaker question (every member is a CSS
 * property, a custom one, or a state), and it is weak on purpose to state: measured, all 34 ordinary
 * field names tried are also CSS property names, so the element alone cannot tell an allow-list from
 * a point or a document type.
 *
 * Asking the checker for assignability to `CssBlockShape` was measured too, and is useless here: an
 * ordinary type with unrelated members IS assignable to it, because excess properties are only
 * checked on a fresh literal.
 *
 * ## The shape it cannot see
 *
 * A state whose type is written somewhere else — `"&:hover"?: Hover`, with `type Hover = [{ … }]`.
 * The type is resolved through the checker, so the tuple IS found; what is reported then is the
 * state, which is where the author acts, rather than the alias.
 */
export function stateIsATuple(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  report: (node: ts.Node, what: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  const properties = new Set(PROPERTIES);

  /**
   * A key that opens a nested rule in a block shape — a selector, or an at-rule that may nest.
   *
   * **The key is where the tightening has to happen.** Asking only whether the name begins with `&`
   * or `@` leaves the ELEMENT to tell a block shape from anything else, and it cannot: of 34
   * ordinary field names checked — `x`, `y`, `content`, `order`, `filter`, `all`, `width`, `color`
   * — **all 34 are CSS properties**, so `{ x?: number; y?: number }` passes any test made of the
   * property list, and a JSON-LD `"@type"` and a `"&ref"` of somebody's own would both be reported.
   *
   * So the key is asked whether it is CSS. `&` has to continue as a selector does — CSS cannot
   * concatenate an identifier onto the parent, so `&ref` is not a selector at all — and `@` has to
   * name an at-rule that may sit inside a rule, which is the list `NOT_IN_A_RULE` is the complement
   * of.
   */
  const NESTS = new Set(Object.keys(AT_RULE_LINKS).map((one) => one.toLowerCase()));
  for (const one of NOT_IN_A_RULE) NESTS.delete(one.toLowerCase());
  /** What may follow `&`: a pseudo, a class, an attribute, an id, a combinator, or a descendant. */
  const AFTER_AMPERSAND = new Set([":", ".", "[", "#", ">", "+", "~", "&", "*", ",", " ", "\t"]);

  const opensAState = (name: string): boolean => {
    if (name.startsWith("&")) return name.length === 1 || AFTER_AMPERSAND.has(name[1]);
    if (!name.startsWith("@")) return false;
    const [word] = name.split(/[\s(]/, 1);
    return NESTS.has(word.toLowerCase());
  };

  /**
   * Whether this is the shape of a BLOCK rather than of any object that happens to sit in a tuple.
   *
   * Every member has to be something a declaration can set: a CSS property, a custom property, or a
   * state of its own. An empty type says nothing either way and is not enough to report on.
   */
  const isABlockShape = (type: ts.Type): boolean => {
    const members = type.getProperties();
    if (members.length === 0) return false;
    return members.every((each) => {
      const name = each.getName();
      return properties.has(name) || name.startsWith("--") || opensAState(name);
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertySignature(node) && node.type !== undefined) {
      const name = ts.isStringLiteral(node.name) || ts.isIdentifier(node.name) ? node.name.text : undefined;
      if (name !== undefined && opensAState(name)) {
        const type = checker.getTypeAtLocation(node.type);
        const elements = checker.isTupleType(type) ? checker.getTypeArguments(type as ts.TypeReference) : undefined;

        if (elements?.length === 1 && isABlockShape(elements[0])) {
          report(node.type, {
            rule: "state-is-a-tuple",
            message:
              `\`${name}\` is a LIST of declarations, and this is a one-element tuple — write ` +
              `\`{ … }[]\` rather than \`[{ … }]\`.\n\n        A tuple gives the FIRST declaration ` +
              `inside the state a type and accepts whatever the rest set, so this slot stops ` +
              `constraining the state after its first line.`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(file, visit);
}

/**
 * An `interface` handed to `CssBlock` — a refusal whose message sends the author to the wrong
 * place.
 *
 * ## What the fault is
 *
 * `CssBlock<A>` constrains `A` to `CssBlockShape`, which is built out of index signatures — one for
 * `&`-keys, one for `@`-keys, one for custom properties. **TypeScript gives an interface no
 * implicit index signature**, so an interface satisfies none of them however it is written.
 * Measured, with the correct array spelling and with no state at all, both refused; the identical
 * `type` beside them is clean.
 *
 * ## Why a rule, when the compiler already reports it
 *
 * Because what the compiler says is about a thing the author did not write:
 *
 *     TS2344: Type 'CardStyle' does not satisfy the constraint 'CssBlockShape'.
 *             Type 'CardStyle' is not assignable to type '{ [nested: `&${string}`]: CssBlockShape[] }'
 *
 * It names an index signature, it names `CssBlockShape`, and it never says `interface` — so the one
 * word that would fix it is the one word missing. An author reads that and goes looking INSIDE the
 * interface, where there is nothing to find.
 *
 * **So this replaces the compiler's word rather than joining it.** Every other typed rule answers a
 * question TypeScript cannot ask, and `inOrder` lets both speak at one character for exactly that
 * reason. This one says the same thing better, so `check.ts` drops the `TS2344` where this fires.
 * The rule is reported on the same node the compiler used, which is what makes that drop a position
 * match rather than a guess.
 *
 * ## What it does not report
 *
 * An interface anywhere else. Interfaces are ordinary; only one handed to `CssBlock` is this fault.
 */
export function allowListIsAnInterface(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  report: (node: ts.Node, what: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  /**
   * Whether this name was declared with `interface`, asked of the DECLARATION rather than the type.
   *
   * A type alias of an object literal and an interface are the same type to almost every question a
   * checker can be asked — the difference here is a rule about declarations, so that is what is
   * read. A merged interface has several declarations and any one of them answers.
   */
  const isAnInterface = (type: ts.Type): boolean =>
    (type.getSymbol()?.getDeclarations() ?? []).some(ts.isInterfaceDeclaration);

  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node) && node.typeArguments?.length === 1) {
      const [argument] = node.typeArguments;
      /**
       * The OUTER type is what says this is a block, and it is still a block here: a type argument
       * failing its constraint does not stop the reference being instantiated, so the brand is
       * readable exactly as it is everywhere else in this file.
       */
      if (
        branded(checker.getTypeAtLocation(node)) !== undefined &&
        isAnInterface(checker.getTypeAtLocation(argument))
      ) {
        report(argument, {
          rule: "allow-list-is-an-interface",
          message:
            `\`${argument.getText(file)}\` is an interface, and an allow-list has to be a \`type\`.\n\n` +
            `        TypeScript gives an interface no index signature of its own, so it can never ` +
            `match a block's shape — whatever is written inside it. Writing \`type ` +
            `${argument.getText(file)} = { … }\` instead changes nothing else.`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(file, visit);
}

/** The rules that judge a VALUE — what an allow-list's literal is asked, and nothing structural. */
export const VALUE_RULES = new Set([
  "unknown-value",
  "unknown-unit",
  "too-many-values",
  "word-out-of-its-longhand",
  "value-differs-across-engines",
]);

/**
 * The compiler's own verdict on one declaration, as the findings of the value rules — asked by
 * compiling it, so an allow-list's value is refused exactly when it would be refused in a block.
 */
export function valueFaults(property: string, value: string): string[] {
  const key = `${property}\u0000${value}`;
  const known = FAULTS.get(key);
  if (known !== undefined) return known;
  const found = compiledFaults(property, value);
  FAULTS.set(key, found);
  return found;
}

/**
 * Each pair's verdict, once per process: an allow-list type is referenced wherever the slot is, and
 * every reference asked again compiled the same declaration again. It is a pure function of the
 * pair, so there is nothing to invalidate.
 */
export const FAULTS = new Map<string, string[]>();

export function compiledFaults(property: string, value: string): string[] {
  /**
   * A literal the probe cannot hold as ONE value is not judged: a `;`, a brace or an unbalanced
   * parenthesis would end the declaration early or open a hole, and the verdict would be about some
   * other text. Nor is a failure to read or check it a verdict — saying "not CSS" for a compiler
   * fault would send the author after a value that may be right.
   */
  if (/[;{}]/.test(value) || value.split("(").length !== value.split(")").length) return [];
  const source = `const x = @@( ${property}: ${value}; );`;
  const [site] = findBlocks(source);
  if (site === undefined) return [];
  try {
    const read = readBlock(source, site.open, "allow-list.tsx", { tolerant: true });
    return checkBlock(read.block, {})
      .filter((one) => VALUE_RULES.has(one.rule))
      .map((one) => one.rule);
  } catch {
    return [];
  }
}

/**
 * §11 — an allow-list value that is not CSS.
 *
 * A component narrowing its slot to `"font-weight"?: "notexisting"` refused every caller, and said
 * nothing itself: the TYPE is well-formed, and the value only fails when somebody tries to send it.
 * Only the component's author can fix it, so it is reported at the value, where they wrote it.
 *
 * Only LITERAL types are asked — a string or a number. `AnyToken<"color">`, `Token<…>` and `string` have
 * nothing to judge; measured in this repository, 5 of 12 allow-list entries are literals. A nested
 * state (`"&:hover"?: { … }[]`) is read the same way. Each declaration is reported once, however
 * many slots name its type.
 */
export function allowListNotCss(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  report: (node: ts.Node, what: Omit<TypedFinding, "file" | "at" | "length">) => void,
): void {
  const said = new Set<ts.Node>();

  const judge = (shape: ts.Type, fallback: ts.Node): void => {
    for (const member of shape.getProperties()) {
      const name = member.getName();
      if (name.startsWith("--") || name.startsWith("@")) continue;
      const type = checker.getNonNullableType(checker.getTypeOfSymbol(member));
      if (name.startsWith("&")) {
        const element = checker.isArrayType(type) ? checker.getTypeArguments(type as ts.TypeReference)[0] : undefined;
        if (element !== undefined) judge(element, fallback);
        continue;
      }
      const declaration = member.getDeclarations()?.[0];
      const where = declaration !== undefined && declaration.getSourceFile() === file ? declaration : fallback;
      for (const one of type.isUnion() ? type.types : [type]) {
        if (!one.isStringLiteral() && !one.isNumberLiteral()) continue;
        const value = String(one.value);
        if (valueFaults(name, value).length === 0) continue;
        // Once per declaration: two bad values in one union are one line to fix.
        if (said.has(where)) continue;
        said.add(where);
        report(where, {
          rule: "allow-list-not-css",
          message:
            `\`${value}\` is not a value \`${name}\` takes in CSS, so every caller sending it is refused. ` +
            `Take it out of the allow-list, or write the value you meant.`,
        });
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node) && node.typeArguments?.length === 1) {
      const [argument] = node.typeArguments;
      if (branded(checker.getTypeAtLocation(node)) !== undefined) judge(checker.getTypeAtLocation(argument), argument);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
}
