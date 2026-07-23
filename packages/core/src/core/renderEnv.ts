export type RenderEnv = "client" | "server";

/**
 * Which side a **root mount** is happening on. Default "client";
 * `renderToString` flips it to "server" for the duration of its mount.
 *
 * This is a module-level variable, and on the server module scope is shared by
 * every concurrent request. Anything read across an `await` would therefore be a
 * race: one render finishing resets the flag under another that is still going.
 * That is exactly why nothing reads this across a yield.
 *
 * The contract — enforced by how it is used, not by types:
 *
 * 1. Only `createComponent` reads it, and only when the component has **no
 *    parent**, i.e. a root mount.
 * 2. A root mount is fully synchronous: `renderToString` sets the flag, calls
 *    `mountNode`, and restores it before its first `await`. JavaScript is
 *    single-threaded, so no other render can run inside that window.
 * 3. Every component records `env` on its own runtime, and children inherit it
 *    from their parent. So re-renders drained from the task queue — which happen
 *    long after the flag is back to "client" — still know their side, as do the
 *    components they create.
 *
 * The upshot: two concurrent `renderToString` calls cannot see each other's
 * flag, and no AsyncLocalStorage is needed. Break rule 2 (make a root mount
 * async) or rule 1 (read this from anywhere reachable after an await) and the
 * guarantee is gone.
 *
 * Locked down by `src/__tests__/hydration/ConcurrentRender.test.tsx`.
 */
let current: RenderEnv = "client";

export function getRenderEnv(): RenderEnv {
  return current;
}

export function setRenderEnv(env: RenderEnv): void {
  current = env;
}
