import type { ComponentChild, EnhancedChildNode } from "./types/vdom";
import { mountNode, unmountChildrenNodes } from "./core/DiffAndMerge";
import { flushPostCommit } from "./core/commit";
import { ramondaLog } from "./debug/logger";
import { initDevtoolsBridge, setInspectRoot, notifyComponentUpdate } from "./debug/devtoolsBridge";
import { installTimerGuard } from "./debug/timerGuard";
import { installPurityGuard } from "./debug/purityGuard";
import { installClientRequestScope } from "./hydration/requestContext";
export { Component } from "./base/Component";
export { Hook } from "./base/Hook";
// What a `use()` says ABOUT a hook, in its third argument. Type-only: the shape is structural, so an
// inline `{ label: "Sign Up" }` needs nothing imported — this is for naming it, in a helper that
// builds one or a wrapper that passes it along.
export type { HookMeta } from "./types/HookTypes";
export { createContext, type ContextOptions } from "./base/Context";
export { AsyncLoad } from "./base/AsyncLoad";
export { ErrorBoundary } from "./base/ErrorBoundary";
// Needed to type a `fallback` written as a bound method rather than an inline arrow.
export type { ErrorBoundaryFallbackProps } from "./base/ErrorBoundary";
export { Ref, createRef } from "./base/Ref";
export type { RefCallback, RefTarget } from "./base/Ref";
export type { AsyncLoadProps, AsyncLoadFailure, Lazy } from "./base/AsyncLoad";
export { list } from "./base/list";
export type { Each, ItemRender } from "./base/list";
export { merge, SAME_ITEM } from "./base/merge";

export type { Identity } from "./base/merge";
export { Head } from "./base/Head";
export type { HeadOptions, MetaTag, LinkTag } from "./base/Head";
export { Portal } from "./base/Portal";
export type { PortalProps } from "./base/Portal";
export { portalTarget, PORTAL_TARGET_ATTR } from "./base/portalTarget";
export type { PortalTarget } from "./base/portalTarget";

// Server rendering and hydration. Exported now that there is a server that uses
// them (apps/playground-ssr); until then the tests reached them by path.
export { renderToString, renderPage, renderStatic } from "./hydration/ssr";
export type { RenderedPage, StaticRender, RenderToStringOptions, ServerRequestInit } from "./hydration/ssr";
// A route guard (or any tree code) can ask a server render to redirect instead of
// producing a page. `renderToString` throws `ServerRedirect`; catch it at the
// server boundary and answer with a 302. `captureServerRedirect` is the low-level
// hook the router uses to record one. See hydration/serverRedirect.ts.
export { ServerRedirect, captureServerRedirect } from "./hydration/serverRedirect";
// Per-request data + the guard that makes prerendering safe. `requestContext()` reads
// cookies/headers/seeded values; those reads THROW during a static build (poisoned), which
// is what proves a baked route holds no per-request data. `requestKey`/`seedRequest` declare
// and fill per-request slots on the server. See hydration/requestContext.ts.
export {
  requestContext,
  requestKey,
  seedRequest,
  RequestReadDuringBuild,
  type RequestContext,
  type RequestKey,
  type RequestKeyOptions,
  type RequestCookies,
  type RequestMode,
} from "./hydration/requestContext";
export { renderDocument } from "./hydration/document";
export type { DocumentOptions } from "./hydration/document";
export { hydrateRoot } from "./hydration/hydrate";

export * from "./base/decorators";
// A development-time switch, and a no-op in a production build — see config.ts.
export { configureDev, type DevFlags } from "./config";
/**
 * The one symbol this package publishes: a method an instance defines to tell the devtools panel
 * what it actually holds. See its declaration for why a `@state` counter is not enough.
 */
export { INSPECT } from "./base/inspect";
// The vocabulary for building vnodes by hand. `h` is callable directly — a route
// table generated from a content directory, a registry of components — and these
// are the types that call needs. Type-only: nothing is added to the runtime API.
export type {
  VNode,
  RamondaNode,
  ComponentChild,
  ComponentClassKind,
  // The side a lifecycle is running on. `@created`/`@mounted`/`@destroyed` receive it
  // as their argument, so a shared method can branch (e.g. skip a fetch on the
  // server) without a `typeof window` check — unreliable anyway, since SSR runs
  // under a DOM shim where `window` exists.
  RenderEnv,
} from "./types/vdom";
export { __h } from "./vdom/h";
export * from "./global";

if (__DEV__) {
  console.info("🌸 Ramonda Core: development mode is active.");
  initDevtoolsBridge();
  installTimerGuard();
  // Watches the CALL rather than the value, which is what makes it catch a
  // millisecond clock — the thing RMD020's double render cannot see. See purityGuard.
  installPurityGuard();

  // Optional, DEV-only, loaded for its side effect (registering <ramonda-devtools>).
  // The specifier is held in a variable so the type-checker does not try to resolve
  // it — the same trick the docs' pagefind loader uses. core has no build-time
  // dependency on devtools (it is a devDependency the docs even stub out), and this
  // keeps `@ramonda/devtools` from becoming a resolution requirement for every
  // package that type-checks core's source.
  //
  // Browser only: on the server there is no `document` to attach the panel to.
  // And `.catch` is not optional — devtools is genuinely optional, so a project
  // that never installed it (e.g. a scaffold with tests but no devtools add-on)
  // must not eat an unhandled "Cannot find package '@ramonda/devtools'" rejection.
  /**
   * `customElements`, not `document`.
   *
   * A server render can have a `document` — this repo's own SSR playground gives its Node
   * process a jsdom one — so `typeof document !== "undefined"` does not mean "browser". It never
   * mattered while every browser API here sat inside the dynamic import's `.then()`, which fails
   * on the server; moving the mount out of that callback put `customElements` on the top level
   * of this block, and the SSR playground died at import with `ReferenceError: customElements is
   * not defined`.
   *
   * The panel IS a custom element, so the registry is the capability that actually has to exist.
   * `NodeEnvironment.test.ts` imports this module with no DOM at all, which is the check that
   * would have caught it.
   */
  if (typeof customElements !== "undefined" && typeof window !== "undefined") {
    /**
     * The panel is mounted by whoever DEFINES it, not by whoever imports it.
     *
     * This used to live inside the dynamic import's `.then()`, and that was the bug behind
     * "the logs appear but no badge does". An app that imports `@ramonda/devtools` itself —
     * which it must, because the specifier below is a variable a bundler cannot resolve —
     * registered the custom element and nothing else: the append, and the Alt+D listener,
     * were both waiting on an import that fails in the browser. It looked right in Node,
     * where the bare specifier resolves, which is exactly how it survived being tested.
     *
     * `whenDefined` is the honest hook: it fires for either route — core's own import when
     * the specifier happens to resolve, or the app's explicit one.
     */
    void customElements.whenDefined("ramonda-devtools").then(() => {
      if (!document.querySelector("ramonda-devtools")) {
        document.body.appendChild(document.createElement("ramonda-devtools"));
      }
    });

    // Outside the import entirely: the shortcut costs nothing when no panel is listening, and
    // tying it to the import is what made it disappear along with the badge.
    window.addEventListener("keydown", (e) => {
      // Alt + D (`code` is more stable than `key`).
      if (e.altKey && e.code === "KeyD") {
        window.dispatchEvent(new CustomEvent("ramonda:toggle-devtools"));
      }
    });

    /**
     * Still attempted, for the app that installed devtools and did not import it: in an
     * environment where a bare specifier resolves at runtime (Node, an import map) this is all
     * that is needed. `.catch()` is not optional — devtools is genuinely optional, and an
     * unhandled rejection would be worse than a missing panel.
     *
     * ## Why the specifier is a VARIABLE, which is the question this keeps prompting
     *
     * Because a literal one cannot be here. Measured on an app that has not installed the panel,
     * which is most apps:
     *
     * ```
     *   vite build   →  "[vite]: Rollup failed to resolve import "@ramonda/devtools""  — the build FAILS
     *   esbuild      →  bundles, leaving `import("@ramonda/devtools")` in the output   — fails at runtime
     * ```
     *
     * So a literal import would break `vite build` for every app that does not use devtools, and
     * ship a specifier no browser can resolve for the ones that use esbuild. A variable plus
     * `@vite-ignore` is the only shape that neither breaks a build nor pretends to resolve.
     *
     * Which is also why the app writes one line of its own — `if (import.meta.env.DEV) void
     * import("@ramonda/devtools")` — and why that line cannot move into `bootstrap`: only the app
     * knows the package is there, and only the app's bundler can resolve it.
     */
    const devtoolsSpecifier = "@ramonda/devtools";
    import(/* @vite-ignore */ devtoolsSpecifier).catch(() => {
      // Not installed, or not resolvable from the browser. An app that imports it explicitly
      // has already covered this; either way the page is fine without a panel.
    });
  }
}

export function bootstrap(rootComponent: ComponentChild, element: HTMLElement) {
  if (__DEV__) {
    setInspectRoot(element);
  }

  // A client-only app has no request behind it, but code shared with a server-rendered one may
  // still call `requestContext()`. Install an empty browser scope so such a read reports (RMD025)
  // and returns nothing, rather than throwing and taking the page down.
  installClientRequestScope(undefined);

  try {
    mountNode(rootComponent, undefined, element);
    // The tree is in the document now, which is what @mounted is waiting for.
    flushPostCommit();
    if (__DEV__) {
      // Nudge the devtools to do an initial pull (no-op unless it's watching).
      notifyComponentUpdate();
    }
  } catch (e) {
    /**
     * Deliberately NOT a diagnostic code.
     *
     * Every `RMD` code names a mistake and carries a fix: a reader who searches one lands on a
     * page saying what to do instead. This is not that. It is the app's own error, on its way up —
     * rethrown on the next line, so whoever threw it still gets it, and a boundary or the console
     * still reports it with its real stack. A code here would promise advice that cannot exist,
     * for a fault this framework knows nothing about beyond having been in the call stack.
     *
     * It stays on the log channel so a panel that is already open shows the crash next to whatever
     * was reported just before it, which is usually the more useful half.
     */
    if (__DEV__) {
      ramondaLog("error", "App crashed", e);
    }
    throw e;
  }
}

/**
 * Tears down everything `bootstrap` mounted into `element`, running @destroyed and
 * every cleanup down the tree. The element itself is kept, so it mirrors
 * bootstrap: that one mounts into it, this one empties it.
 *
 * Removing the element from the DOM is NOT a substitute — the browser drops the
 * nodes but the components never learn they are gone, so timers keep ticking and
 * listeners stay attached.
 */
export function unmount(element: HTMLElement): void {
  unmountChildrenNodes(Array.from(element.childNodes) as unknown as EnhancedChildNode[]);
}
