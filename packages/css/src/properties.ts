import type { CssVar, KindOfSyntax } from "./runtime/token";
/**
 * `@ramonda/css/properties` — the type a block is checked against.
 *
 * Nothing imports this at runtime and nothing here has a value. It exists so the **virtual file**
 * can name one type: every block in a project becomes an object literal typed `CssBlockShape`, and
 * an object literal is what gets excess-property checking — which is how a CSS property name gets
 * TypeScript's own *did you mean*, in a syntax TypeScript cannot parse.
 *
 * Measured, exactly these diagnostics, on exactly this shape:
 *
 * | written | reported |
 * |---|---|
 * | `display: flexx` | `TS2820 … Did you mean '"flex"'?` |
 * | `dsiplay: flex` | `TS2561 … Did you mean to write 'display'?` |
 * | `padding: $(nekaFunc())` | `TS2322`, against `padding`'s own type |
 * | `&:hover { colr: … }` | `TS2561`, **inside the nested rule** |
 */

/**
 * Every CSS property, and what it accepts — generated from MDN's own data.
 *
 * 551 properties, **123 of them a closed keyword set**. The rest are `string | number`, and their
 * typos belong to the CSS checker, where the message is one we write. The split is measured, not
 * chosen: a template literal type does catch `padding: 10pxx`, and says so in a union that grows
 * combinatorially with every shorthand position.
 *
 * **`display` is not one of the 123**, and the design used to say it was. Its grammar allows
 * `inline flow-root`, so a union of its single keywords would reject valid CSS — and rejecting valid
 * CSS is the one failure a type map may not have. The line this holds is: a union only where the
 * grammar is genuinely closed.
 *
 * Regenerate with `node scripts/css/build-css-properties.mjs`; `pnpm check` runs it with `--check`.
 */
export type { CssGlobal, CssProperties, CssValue, Keyword, Narrowed } from "./properties.generated";
export type { StyleValue } from "./runtime/types";

import type { StyleValue } from "./runtime/types";

/**
 * What a NAMED site's body is typed by — `@@font-face( … )`, `@@property( … )`.
 *
 * Descriptors, not properties: `src` and `syntax` are a separate vocabulary that happens to share
 * the syntax of a declaration, and one typed against the properties would report every correct line.
 * A descriptor with no initial value is required, and is written so — which is how a `@font-face`
 * that would load nothing becomes a type error rather than a rule of ours.
 */
export type { CssFontFaceDescriptors, CssPropertyDescriptors } from "./properties.generated";
export type { CssVar } from "./runtime/token";

/**
 * What `@@property( … )` binds: the generated name, carrying the kind its `syntax` declared.
 *
 * The binding is a string at run time — it is the name — so it reads in a block and goes straight
 * in as a key where the value is set. The kind is what the name alone cannot carry, and it is what
 * lets `toStyle` refuse a length where an angle was declared.
 */
export type CssRegistered<D> = CssVar<KindOfSyntax<D extends { syntax: infer S } ? S : never>>;

import type { CssProperties, CssValue } from "./properties.generated";

/**
 * One declaration, as the virtual file writes it.
 *
 * Four kinds of key, and each index signature is written as a template literal so that a key
 * matching none of them is still an EXCESS property — which is the whole point. A plain
 * `[key: string]` would accept `dsiplay` and there would be nothing left to check.
 *
 * - a property, from {@link CssProperties};
 * - a nested rule, `&:hover` or `& .title`, holding declarations of its own;
 * - an at-rule, `@media (min-width: 40rem)`, the same;
 * - anything starting with `-`: a custom property the author declares (`--brand`), and every
 *   vendor-prefixed name (`-webkit-line-clamp`). A hundred prefixed names are in MDN's data and more
 *   are not; one signature accepts all of them, and costs nothing that matters, because a key NOT
 *   starting with `-` still has to be a real property.
 *
 * **A nested rule holds an ARRAY, and a block is an array, and that is not a detail.** TypeScript
 * reports one failure per object literal and stops — so a block written as a single literal with
 * three faults in it reports one of them, and the author fixes it, re-runs, and meets the next.
 * Measured, exactly that. One literal per declaration, gathered in an array, gets every fault
 * reported at once, each with its own position and its own suggestion.
 */

export type CssBlockShape = Partial<CssProperties> & {
  [nested: `&${string}`]: CssBlockShape[];
} & { [at: `@${string}`]: CssBlockShape[] } & { [dashed: `-${string}`]: CssValue };

/**
 * **A PROJECT writes its own copy of this shape, and there is no parameterised version to share.**
 *
 * There was one — `BlockShapeOf<P>` — so the shape around the properties could be stated once and
 * a generated module could name it. It is gone because it does not work, and the playground found
 * it on its first run:
 *
 *     generic, one level of nesting     accepted
 *     generic, TWO levels               TS2353: '"& .title"' does not exist in type
 *     self-referential, two levels      accepted
 *
 * A generic recursive type alias stops expanding at depth, and two levels of nesting is ordinary
 * CSS — `&:hover { & .title { … } }` is written in this repository's own playground. So `codegen.ts`
 * emits the shape concretely, referring to the project's own `CssBlockShape`, and the duplication is
 * the price of a type that works at the depth people write.
 */

/**
 * The body of `@@keyframes( … )`: frames, each holding declarations of its own.
 *
 * The key is any string because a frame is not a selector — `from`, `to`, `50%`, `0%, 100%` — and
 * there is no type that admits those and refuses a typo. Which words are frames is a question the
 * checker answers, where the message can say what a frame may be; the type's job here is the
 * declarations INSIDE, which are ordinary properties and are checked as ordinary properties.
 *
 * They hold {@link CssBlockShape} rather than the properties alone so that a custom property set in
 * a frame — `--angle: 45deg`, which is the whole point of animating a registered one — is allowed.
 */
export type CssKeyframesShape = { [frame: string]: CssBlockShape[] };

declare const ALLOWS: unique symbol;

/**
 * What a `@@( … )` compiles to, as an editor sees it.
 *
 * **The helper that stands for a block used to return `never`**, which is assignable everywhere and
 * so never got in the way — and read, on hover, as *this is nothing*. A binding holding a block is
 * exactly what an author points at to ask what a block IS, so the answer is what `className` takes,
 * under a name that says so.
 *
 * **It IS a string**: the classes an element carries, branded so that a plain `string` cannot stand
 * in for one and so that concatenating two loses the brand — the merge cannot be bypassed with `+`.
 * It extends {@link StyleValue} rather than restating the brand, which is also the whole of what the
 * framework has to agree with: both sides say `string`, so there is no shape left to drift and the
 * check that compared them is gone.
 *
 * ## `A` is what a PROP may constrain, and it is a phantom
 *
 * `CssBlock<{ color?: Token<"color"> }>` is a prop that takes a block setting a colour from the
 * theme and nothing else. The allow-list is a {@link CssBlockShape} used as a TYPE rather than a
 * vocabulary of its own, so a slot is written in the spelling a block is written in.
 *
 * **It reuses that name rather than introducing one**, and the reason is a measured regression: a
 * project's properties module is GENERATED, so a name this package invents is a name older
 * generated modules do not export — the constraint then fails to resolve, every block becomes
 * `any`, and sixteen tests went silent at once. `CssBlockShape` is already in every copy there is.
 *
 * The parameter defaults to every shape there is, so a bare `CssBlock` is what it always was and
 * every existing annotation keeps working — asserted in `check.test.ts`.
 *
 * It has to be READ somewhere or TypeScript would not infer it from a return position, which is
 * the whole mechanism: the helper in the virtual file takes the allow-list from the CONTEXT and
 * checks the author's literal against it, so a fault lands on the property or on the value rather
 * than on the call. `[ALLOWS]` is where it is read. Nothing carries it at run time and nothing is
 * there to carry.
 */
export type CssBlock<A extends CssBlockShape = CssBlockShape> = StyleValue & { readonly [ALLOWS]: A };

/**
 * A condition that can never be false is a group that can never be off.
 *
 * The message IS the type, so TypeScript prints it as the expected parameter and there is no
 * diagnostic of ours to write. Measured through a real `tsc` before it was promised: `boolean`, a
 * number, a string, a comparison and `T | undefined` are all silent — and so are **`any` and
 * `unknown`**, which is the row that would have made the whole check unusable, since a hole reading
 * untyped data is ordinary.
 */
export type CssCondition<T> = [T] extends [(...args: never[]) => unknown]
  ? "a function is always truthy — call it, or test a value"
  : [T] extends [Promise<unknown>]
    ? "a promise is always truthy — await it, or test a value"
    : [Extract<FALSY, T>] extends [never]
      ? "this is always truthy, so the group can never be off"
      : T;

/**
 * Every value JavaScript reads as false, as a type.
 *
 * A condition is worth writing when it can be false, so a type holding NONE of these can never turn
 * its group off. Asking it this way rather than asking whether the type is an OBJECT was a real gap:
 * `"yes"`, `"a" | "b"`, `1 | 2` and `` `x${string}` `` are all literals rather than objects, and every
 * one of them passed while never being false.
 *
 * It reads the right way round for the shapes that must stay allowed, too — `string` holds `""`,
 * `number` holds `0`, and `{ a: 1 } | undefined` holds `undefined`, so all three are conditions.
 *
 * **The direction matters and the first attempt had it backwards.** `Extract<T, FALSY>` asks whether
 * the TYPE fits into a falsy value, which `number` does not — so it refused `items.length`, the very
 * shape this is meant to allow. `Extract<FALSY, T>` asks the question that was meant: is any falsy
 * value one this type could hold.
 */
type FALSY = false | 0 | 0n | "" | null | undefined;

/**
 * What may be spread into a block: another block, and nothing else.
 *
 * A compiled block is a value this compiler produced, so a hand-written object is not one however
 * closely it reads. `never` is what a block is in the virtual file — the helper that stands for one
 * returns it — and `never` is assignable to everything, which is exactly why a real block passes.
 *
 * **A block that may not be there is spreadable, and refusing one was the type being stricter than
 * the thing it describes.** `sx?: CssBlock` is the ordinary shape for a style a caller MAY send, so
 * it is the shape a constrained prop has nearly every time — and `...$(cond && block)` is how a
 * group is written conditionally. Measured against the real `merge`: `undefined`, `null` and `false`
 * are each skipped and the neighbouring classes all arrive, which is what they have always done.
 * The refusal itself is unchanged, and asserted still to fire in `check.test.ts`.
 */
export type CssSpreadable<T> = [T] extends [CssBlock | false | null | undefined]
  ? T
  : "only a style block can be spread — this is not one, so write the declarations out";
