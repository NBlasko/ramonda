import type { ComponentChild, EnhancedChildNode } from "./types/vdom";
import { mountNode, unmountChildrenNodes } from "./core/DiffAndMerge";
import { flushPostCommit } from "./core/commit";
import { ramondaLog } from "./debug/logger";
import { initDevtoolsBridge, setInspectRoot, notifyComponentUpdate } from "./debug/devtoolsBridge";
import { installTimerGuard } from "./debug/timerGuard";
export { Component } from "./base/Component";
export { Hook } from "./base/Hook";
export { createContext, type ContextOptions } from "./base/Context";
export { AsyncLoad } from "./base/AsyncLoad";
export { ErrorBoundary } from "./base/ErrorBoundary";
export { Ref, createRef } from "./base/Ref";
export type { RefCallback, RefTarget } from "./base/Ref";
export type { AsyncLoadProps, AsyncLoadFailure, Lazy } from "./base/AsyncLoad";
export { list } from "./base/list";
export type { ListOptions } from "./types/list";
export { Head } from "./base/Head";
export type { HeadOptions, MetaTag, LinkTag } from "./base/Head";

// Server rendering and hydration. Exported now that there is a server that uses
// them (apps/playground-ssr); until then the tests reached them by path.
export { renderToString, renderPage } from "./hydration/ssr";
export type { RenderedPage } from "./hydration/ssr";
export { renderDocument } from "./hydration/document";
export type { DocumentOptions } from "./hydration/document";
export { hydrateRoot } from "./hydration/hydrate";

export * from "./base/decorators";
// The vocabulary for building vnodes by hand. `h` is callable directly — a route
// table generated from a content directory, a registry of components — and these
// are the types that call needs. Type-only: nothing is added to the runtime API.
export type {
  VNode,
  RamondaNode,
  ComponentChild,
  ComponentClassKind,
} from "./types/vdom";
export { h } from "./vdom/h";
export * from "./global";

if (__DEV__) {
  console.info("🌸 Ramonda Core: development mode is active.");
  initDevtoolsBridge();
  installTimerGuard();

  // Optional, DEV-only, loaded for its side effect (registering <ramonda-devtools>).
  // The specifier is held in a variable so the type-checker does not try to resolve
  // it — the same trick the docs' pagefind loader uses. core has no build-time
  // dependency on devtools (it is a devDependency the docs even stub out), and this
  // keeps `@ramonda/devtools` from becoming a resolution requirement for every
  // package that type-checks core's source.
  const devtoolsSpecifier = "@ramonda/devtools";
  import(/* @vite-ignore */ devtoolsSpecifier).then(() => {
    if (!document.querySelector("ramonda-devtools")) {
      const devTools = document.createElement("ramonda-devtools");
      document.body.appendChild(devTools);
    }

    window.addEventListener("keydown", (e) => {
      // Check for Alt + D (`code` is more stable than `key`).
      if (e.altKey && e.code === "KeyD") {
        console.log("🌸 Ramonda Core: Alt+D pressed, sending the signal...");
        window.dispatchEvent(new CustomEvent("ramonda:toggle-devtools"));
      }
    });
  });
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
