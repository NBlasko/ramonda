/**
 * Async work a server render must wait for before serializing.
 *
 * `@mount` is where an app fetches — that is what the lifecycle is for, and it
 * runs on the server precisely so the data is in the HTML. But `renderToString`
 * used to await only microtasks (`flushTaskQueue`), so anything taking a real
 * round trip — an `import()`, a `fetch` — was still in flight when the markup was
 * serialized. Measured: an `AsyncLoad` whose lazy resolved on a macrotask
 * produced the loading fallback in the HTML, not the content.
 *
 * ## The collector, and why it is not a module-level array
 *
 * A module-level list would be shared by every concurrent request, so one render
 * would wait on — or serialize — another's work. Instead each render gets its own
 * `ServerWork` object, and every component records the one it belongs to.
 *
 * How a component finds it is exactly how it finds its `env` (see renderEnv.ts),
 * and for the same reasons:
 *
 * 1. A component **inherits** the collector from its parent.
 * 2. Only a ROOT mount reads the module-level `current`, and a root mount is
 *    fully synchronous — `renderToString` sets it, mounts, and clears it before
 *    its first `await`. No other render can run inside that window.
 *
 * That second point is what makes this safe for several top-level components in
 * one render, and for components created *later*, during the drain: they inherit
 * from a parent that already has the collector, long after the flag is clear.
 */
export interface ServerWork {
  pending: Promise<unknown>[];
  /**
   * Set once the render that owns this collector has finished — serialized, or
   * given up.
   *
   * Without it, work already in flight when the render ended kept going, and
   * every promise that landed wrote state and scheduled another render into a
   * tree nobody would ever serialize. Measured on the waterfall case, which
   * throws after 10 rounds: **48 mounts started and 74 renders happened after
   * the throw**, and they only stopped because the process did. On a server that
   * is one runaway tree per failed request — CPU, memory and outbound calls,
   * unbounded.
   */
  done: boolean;
  /**
   * Set when something in the tree asked, during this server render, to redirect
   * the request elsewhere — a route guard sending an unauthenticated visitor to
   * `/login`, say. `renderToString` turns a set value into a thrown `ServerRedirect`
   * instead of returning markup, so the Node layer can answer with a 302 and the
   * browser actually navigates (rather than being handed a page for the wrong URL,
   * which would then snap back on hydration). First writer wins — see
   * `captureServerRedirect`. `undefined` means "render the page normally".
   */
  redirect?: string;
}

let current: ServerWork | undefined;

export function getServerWorkCollector(): ServerWork | undefined {
  return current;
}

export function setServerWorkCollector(collector: ServerWork | undefined): void {
  current = collector;
}

export function createServerWork(): ServerWork {
  return { pending: [], done: false };
}

/**
 * Closes the collector. Everything still in flight is abandoned rather than
 * awaited: its result cannot reach the HTML, which has already been produced.
 */
export function finishServerWork(collector: ServerWork | undefined): void {
  if (collector) collector.done = true;
}

/** Records a promise on the collector this component belongs to, if any. */
export function addServerWork(collector: ServerWork | undefined, work: Promise<unknown>): void {
  if (!collector || collector.done) return;
  collector.pending.push(work);
}

/**
 * Everything registered since the last call, and empties the list.
 *
 * Draining rather than reading, because the loop awaits a batch and then looks
 * again: work started BY that batch has to be a new round, not a re-await of
 * promises that already settled.
 */
export function takeServerWork(collector: ServerWork | undefined): Promise<unknown>[] {
  if (!collector || collector.pending.length === 0) return [];
  return collector.pending.splice(0, collector.pending.length);
}

/** A value that can be awaited — anything with a `then`. */
export function isThenable(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as Promise<unknown>).then === "function";
}
