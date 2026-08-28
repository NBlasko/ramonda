import { __h } from "./vdom/h";
import type { ComponentChild, VNode } from "./types/vdom";
import { reportFunctionTag } from "./debug/jsxRules";

/**
 * The automatic JSX runtime.
 *
 * With `"jsx": "react-jsx"` and `jsxImportSource: "@ramonda/core"`, the compiler imports these
 * itself, per file. Nothing has to be configured with a factory name, nothing has to be injected
 * into every module, and there is no `global.d.ts` declaring an identifier that does not exist in
 * the source. The two names a reader used to have to hold — `h`, which the package exported, and
 * `__ramondaH`, which compiled JSX called — collapse to none.
 *
 * ## Why there are two entry points, and why the difference matters here more than elsewhere
 *
 * The compiler calls `jsxs` when it wrote the children itself — `<ul><li/><li/></ul>` — and `jsx`
 * when there is one child, including one that is an EXPRESSION: `<ul>{rows.map(…)}</ul>` is one
 * child that happens to be an array.
 *
 * For Ramonda that distinction is load-bearing rather than an optimisation. A child that is an
 * array becomes ONE child — its own region, with its own key space — because two `.map()`s side by
 * side must not share a key index (see `normalizeChildren`). So:
 *
 * - `jsxs` **spreads**: three static children are three children, at indices 0, 1 and 2, and the
 *   index is the identity the diff matches on.
 * - `jsx` **does not**: its single child is passed as one argument, so an array stays a group.
 *
 * Swapping the two would turn every pair of sibling expressions into a single region and let their
 * keys collide — the exact bug the grouping rule exists to prevent.
 *
 * ## `key` is an argument now, not a prop
 *
 * The classic factory read `key` off the attributes; the automatic runtime hands it separately, so
 * it is put back where the diff looks for it (`vnode.attributes.key`).
 */

type Props = Record<string, unknown> & { children?: unknown };

/** Attributes without `children`, with `key` folded back in. */
function attributesOf(props: Props | null, key: string | number | undefined): Record<string, unknown> {
  // The compiler builds a fresh object per element, so this copy is the only allocation added and
  // it is one shallow spread. `children` must not survive into it: it would be set on the element
  // as an attribute.
  const { children: _children, ...rest } = props ?? {};
  if (key !== undefined) rest["key"] = key;
  return rest;
}

/** One child, or none. An array child stays one child — that is the whole point of `jsx` vs `jsxs`. */
export function jsx(type: unknown, props: Props | null, key?: string | number): VNode {
  const attributes = attributesOf(props, key);
  // `in` rather than `!== undefined`: `<p>{undefined}</p>` HAS a child, and it holds a slot the
  // diff matches siblings by. `<p/>` has none.
  return props !== null && props !== undefined && "children" in props
    ? __h(type as never, attributes as never, props.children as ComponentChild)
    : __h(type as never, attributes as never);
}

/** Children the compiler wrote itself: spread, so each one keeps its own index. */
export function jsxs(type: unknown, props: Props | null, key?: string | number): VNode {
  const attributes = attributesOf(props, key);
  const children = (props?.children ?? []) as ComponentChild[];
  return __h(type as never, attributes as never, ...children);
}

/**
 * A fragment, which Ramonda does not have.
 *
 * The runtime contract requires the export, so it exists and says what is wrong.
 *
 * **The reason is no longer "one tag, one element".** A component returns as many elements as its
 * render says, and that is the ordinary case now — so a fragment is not refused for producing
 * several siblings. It is refused for having nothing else: no state, no lifecycle, no identity the
 * diff can hold. A component covers every case a fragment does and several it cannot, so the
 * fragment would be a second way to say a worse version of the same thing.
 *
 * **And this is the only defence.** The compiler does not typecheck a fragment's parameter —
 * measured, by giving this one a required argument and watching `<><span /></>` compile anyway — so
 * unlike a named function in tag position, `<>…</>` reaches the runtime from fully typed code. It
 * arrives at `__h` as a function tag, is reported as RMD011, throws here, and renders the inert
 * fallback in production.
 */
export function Fragment(): never {
  if (__DEV__) reportFunctionTag("Fragment");
  throw new Error(
    "Ramonda has no fragments: `<>…</>` has no state, no lifecycle and no identity the diff can " +
      "hold, and a component covers every case it would. Use one, or write `{[a, b]}` if you only " +
      "wanted the vnodes.",
  );
}
