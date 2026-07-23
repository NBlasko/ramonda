import { unmount as unmountTree } from "@ramonda/core";

/** One mounted tree, and everything needed to take it back down. */
interface MountedTree {
  container: HTMLElement;
  baseElement: HTMLElement;
  /** False when the caller supplied the container — then it is not ours to remove. */
  containerIsOurs: boolean;
}

const mounted = new Set<MountedTree>();

export function trackMountedTree(tree: MountedTree): void {
  mounted.add(tree);
}

/**
 * Tears one tree down. Idempotent — calling `unmount()` and then letting
 * `cleanup()` run does not unmount twice.
 */
export function unmountTracked(tree: MountedTree): void {
  if (!mounted.delete(tree)) return;

  // Unmount BEFORE removing the node. Removing it alone leaves every component
  // in it mounted, so `@destroy` never runs and their timers, listeners and
  // store subscriptions outlive the test — still armed, still able to report
  // into whatever runs next.
  unmountTree(tree.container);

  if (tree.containerIsOurs) tree.container.remove();
}

/**
 * Unmounts everything rendered by this module.
 *
 * Registered automatically after each test when the framework exposes a global
 * `afterEach` (vitest with `globals: true`, or jest). Call it by hand otherwise.
 *
 * **Skipping it is a bad trade, and the failure it causes does not look like a
 * leak.** A container left in the document keeps a LIVE component tree, so its
 * effects and window listeners stay attached. Worse, ids stop being unique
 * across containers, and jsdom resolves even a scoped `container.querySelector("#x")`
 * through a document-wide index — so a query returns a node from an EARLIER
 * test. Measured while building this: the affected tests pass one at a time and
 * fail together, pointing at the wrong file.
 */
export function cleanup(): void {
  for (const tree of [...mounted]) unmountTracked(tree);
}

/**
 * Opt out of automatic cleanup. Import `@ramonda/testing-library/dont-cleanup-after-each`
 * (or set `RAMONDA_TL_SKIP_AUTO_CLEANUP`) before the library is loaded.
 */
let autoCleanupDisabled = false;

export function disableAutoCleanup(): void {
  autoCleanupDisabled = true;
}

export function registerAutoCleanup(): void {
  if (autoCleanupDisabled) return;
  if (readEnvFlag("RAMONDA_TL_SKIP_AUTO_CLEANUP")) return;

  // Not imported from vitest or jest: this package must not pick a test runner
  // for its users. Whichever one is running has already put `afterEach` on the
  // global, and if none has, there is nothing sensible to hook and the user
  // calls `cleanup()` themselves.
  const hook = (globalThis as { afterEach?: (fn: () => void) => void }).afterEach;
  if (typeof hook !== "function") return;

  hook(cleanup);
}

function readEnvFlag(name: string): boolean {
  const proc = (globalThis as { process?: { env?: Record<string, string> } }).process;
  return Boolean(proc?.env?.[name]);
}
