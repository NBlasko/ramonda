import { COMPONENT_RUNTIME, type ComponentRuntime, GLOBAL_RUNTIME, type Runtime } from "./runtime";

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
 *    `mountRoot`, and restores it before its first `await`. JavaScript is
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

/**
 * The runtime of the COMPONENT a hook belongs to — the only honest place for a hook to ask about the
 * render it is part of.
 *
 * This is the companion to the contract above, and it sits beside it so the trap and the answer are
 * one file. A hook has no `env` of its own; it shares its owner's runtime. And it must not read the
 * flag above: that is restored before a server render's first `await`, so any pass drained later
 * would answer "client" whichever side it is really on. `typeof document` is no better — an SSR
 * process can have a jsdom one.
 *
 * INTERNAL. An app is told its side where the framework already hands it over: the `env` argument
 * every lifecycle method receives.
 *
 * It returns the runtime rather than one field, because the two callers want different fields:
 * `Portal` asks which side, a scheduled call asks which side AND whether the owner is gone.
 *
 * **There is nothing optional in it, and that took a type change to say.** `owner` was declared
 * optional and never was one, so every use carried two `?.` and an argument about what a missing
 * owner ought to mean — an argument about a value that cannot exist. See `Runtime.owner`.
 */
export function ownerRuntime(hook: { [GLOBAL_RUNTIME]: Runtime }): ComponentRuntime {
  return hook[GLOBAL_RUNTIME].owner[COMPONENT_RUNTIME];
}
