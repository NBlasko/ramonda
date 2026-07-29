import type { ComponentChild, EnhancedChildNode } from "./types/vdom";
import { mountNode, unmountChildrenNodes } from "./core/DiffAndMerge";
import { flushPostCommit } from "./core/commit";
import { ramondaLog } from "./debug/logger";
import { initDevtoolsBridge, setInspectRoot, notifyComponentUpdate } from "./debug/devtoolsBridge";
import { installTimerGuard } from "./debug/timerGuard";
import { installPurityGuard } from "./debug/purityGuard";
export { Component } from "./base/Component";
export { Hook } from "./base/Hook";
export { createContext, type ContextOptions } from "./base/Context";
export { AsyncLoad } from "./base/AsyncLoad";
export { ErrorBoundary } from "./base/ErrorBoundary";
// Needed to type a `fallback` written as a bound method rather than an inline arrow.
export type { ErrorBoundaryFallbackProps } from "./base/ErrorBoundary";
export { Ref, createRef } from "./base/Ref";
export type { RefCallback, RefTarget } from "./base/Ref";
export type { AsyncLoadProps, AsyncLoadFailure, Lazy } from "./base/AsyncLoad";
export { list } from "./base/list";
export { stable } from "./base/stable";
export type { ListOptions } from "./types/list";
export { Head } from "./base/Head";
export type { HeadOptions, MetaTag, LinkTag } from "./base/Head";

// Server rendering and hydration. Exported now that there is a server that uses
// them (apps/playground-ssr); until then the tests reached them by path.
export { renderToString, renderPage } from "./hydration/ssr";
export type { RenderedPage } from "./hydration/ssr";
// A route guard (or any tree code) can ask a server render to redirect instead of
// producing a page. `renderToString` throws `ServerRedirect`; catch it at the
// server boundary and answer with a 302. `captureServerRedirect` is the low-level
// hook the router uses to record one. See hydration/serverRedirect.ts.
export { ServerRedirect, captureServerRedirect } from "./hydration/serverRedirect";
export { renderDocument } from "./hydration/document";
export type { DocumentOptions } from "./hydration/document";
export { hydrateRoot } from "./hydration/hydrate";

export * from "./base/decorators";
// A development-time switch, and a no-op in a production build — see config.ts.
export { configureDev, type DevFlags } from "./config";
// The vocabulary for building vnodes by hand. `h` is callable directly — a route
// table generated from a content directory, a registry of components — and these
// are the types that call needs. Type-only: nothing is added to the runtime API.
export type {
  VNode,
  RamondaNode,
  ComponentChild,
  ComponentClassKind,
  // The side a lifecycle is running on. `@create`/`@mount`/`@destroy` receive it
  // as their argument, so a shared method can branch (e.g. skip a fetch on the
  // server) without a `typeof window` check — unreliable anyway, since SSR runs
  // under a DOM shim where `window` exists.
  RenderEnv,
} from "./types/vdom";
export { h } from "./vdom/h";
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
  if (typeof document !== "undefined") {
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
     * that is needed. The specifier is a variable so the type-checker does not make
     * `@ramonda/devtools` a requirement for every package that reads core's source, and
     * `.catch()` is not optional — devtools is genuinely optional, and an unhandled rejection
     * would be worse than a missing panel.
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

  try {
    mountNode(rootComponent, undefined, element);
    // The tree is in the document now, which is what @mount is waiting for.
    flushPostCommit();
    if (__DEV__) {
      // Nudge the devtools to do an initial pull (no-op unless it's watching).
      notifyComponentUpdate();
    }
  } catch (e) {
    if (__DEV__) {
      ramondaLog("error", "App crashed", e);
    }
    throw e;
  }
}

/**
 * Tears down everything `bootstrap` mounted into `element`, running @destroy and
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
