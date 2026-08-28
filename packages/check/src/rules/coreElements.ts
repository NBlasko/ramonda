import type ts from "typescript";
import type { Resolver } from "./rule";

/**
 * The components `@ramonda/core` ships that ARE an element, and which one each is.
 *
 * `<select>` and `<textarea>` are refused by core's own types — each carries a refusal in
 * `global.ts` — because neither can be written correctly as a tag. A select's choice is decided by
 * the order its options reached it, and a textarea's value is its CHILD rather than an attribute,
 * so both were shapes an author could only get wrong. `Select` and `TextArea` settle them, and each
 * builds its element through the `__h` factory rather than as JSX.
 *
 * Which leaves the checker meeting a COMPONENT where the tag used to be. Measured before this
 * existed: `<Select aria-hidden="true" httpEquiv="refresh">` with no label at all was reported by
 * ONE rule, while the identical faults on an `<input>` beside it were reported by four. Every rule
 * that keys on a tag went quiet for the very elements an author now has no other way to write.
 *
 * ## Why this is a table and not a walk
 *
 * The obvious answer is to read the component's `render` and see what it builds — and it works
 * inside this repository and nowhere else. An application resolves `Select` to
 * `@ramonda/core`'s `.d.ts`, which is a declaration with **no body**: there is no render to read,
 * no `__h` call, nothing. A reader built that way would pass every fixture here and do nothing at
 * all for the people the rules are for.
 *
 * ## Why the table lives here and not in `@ramonda/dom-facts`
 *
 * Because only this package needs it. `dom-facts` is for a fact BOTH packages consult, and putting
 * one there that core never reads is how `htmlElements` got into a published API and had to be
 * taken back out. `scripts/check-core-elements.mjs` reads core's own source and pins this table in
 * both directions, which is the same answer `check-decorator-duplication.mjs` reached for the same
 * problem: neither table is a published export, and neither should become one to satisfy a check.
 */
const IS_AN_ELEMENT: ReadonlyMap<string, string> = new Map([
  ["Select", "select"],
  ["TextArea", "textarea"],
]);

/**
 * The element this JSX tag really is, when the tag names one of core's element components.
 *
 * Identity is `resolve.coreName`'s, not the written name: a component of an application's own
 * called `Select` is its own business, and core's under an alias or through a namespace is still
 * core's. That reader hangs on the resolver precisely so it reaches everywhere the resolver does —
 * which is why this needs no new parameter threaded through the element pipeline — and it is the
 * same question `duplicate-decorators` and `decorator-that-adds-nothing` ask, so a second answer to
 * it cannot appear here.
 */
export function coreElementTag(tagName: ts.JsxTagNameExpression, resolve: Resolver): string | undefined {
  const exported = resolve.coreName(tagName);
  return exported === undefined ? undefined : IS_AN_ELEMENT.get(exported);
}

/** Every component name in the table, for the script that pins it against core's source. */
export const CORE_ELEMENT_COMPONENTS: ReadonlyMap<string, string> = IS_AN_ELEMENT;
