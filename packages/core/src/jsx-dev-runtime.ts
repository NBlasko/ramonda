import { jsx, jsxs } from "./jsx-runtime";
import { SOURCE, type Source } from "./debug/source";
import type { VNode } from "./types/vdom";

export { Fragment } from "./jsx-runtime";

type Props = Record<string, unknown> & { children?: unknown };

/**
 * The development entry point, which the compiler uses instead of `jsx`/`jsxs`.
 *
 * It is a separate module and a separate package subpath because that is what the runtime contract
 * says: `"jsx": "react-jsx"` imports from `<source>/jsx-runtime`, `"react-jsxdev"` — and every
 * bundler's dev mode — imports from `<source>/jsx-dev-runtime`. A build that only shipped the first
 * one fails at import time in development, which is where every developer lives.
 *
 * One function does the work of two: `isStaticChildren` is the compiler telling us whether it wrote
 * the children itself. That is exactly the `jsxs` / `jsx` distinction, and it is not cosmetic here —
 * static children are spread so each keeps its own index, while a single child that happens to be an
 * array stays one group with its own key space. See `jsx-runtime.ts`.
 *
 * `source` carries the file, line and column the tag was written at, and is kept on the vnode so
 * RMD020 can name the line a rebuilt value is on — see `debug/source.ts`. `self` is not read.
 */
export function jsxDEV(
  type: unknown,
  props: Props | null,
  key?: string | number,
  isStaticChildren?: boolean,
  source?: Source,
): VNode {
  const vnode = isStaticChildren === true ? jsxs(type, props, key) : jsx(type, props, key);
  if (__DEV__ && source !== undefined && vnode !== null && typeof vnode === "object") {
    (vnode as { [SOURCE]?: Source })[SOURCE] = source;
  }
  return vnode;
}
