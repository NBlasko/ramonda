import type { QueryClient } from "./QueryClient";
import type { QueryKey } from "./types";

/**
 * DEV-only: makes the live caches readable by `@ramonda/devtools`.
 *
 * ## Why a pull model, and why a global function
 *
 * The devtools panel is a custom element outside the app's tree, loaded on demand. It
 * cannot see a `QueryClientProvider` instance, and the cache has no business knowing a
 * panel exists. Core already solved the same problem the same way — `__RAMONDA_INSPECT__`
 * is a function core installs in a development build and the panel calls when its tab is
 * open. This is that, for queries.
 *
 * Pull rather than push matters here: a cache changes on every fetch, every observer
 * arriving and leaving, every invalidate. Emitting an event for each would cost something
 * in every development build, whether or not anybody is looking. A function that is called
 * only while the panel's Query tab is open costs nothing the rest of the time.
 *
 * ## Why providers register instead of the client
 *
 * A client is per provider, and there can be several — a test mounts one per case, an app
 * could scope one to a route. Registering from the provider's lifecycle means the set is
 * exactly the live ones: a provider that unmounted takes its client out, so the panel
 * cannot hold a cache alive or list one that belongs to a torn-down tree.
 *
 * ## What the panel deliberately cannot do
 *
 * There is no "refetch" button, and that is a fact about the design rather than a missing
 * feature: the FETCHER belongs to the observer, not to the cache. A query nobody is watching
 * has no function to call. `invalidate` is the honest equivalent — it marks the entry stale
 * and asks whoever is watching to refresh, which is exactly what a mutation does.
 *
 * Every export here is behind `__DEV__` at its call site, so a production build strips the
 * registration and the global is never installed.
 */

interface QueryRow {
  key: QueryKey;
  hash: string;
  status: string;
  fetchStatus: string;
  observers: number;
  updatedAt: number;
  failureCount: number;
  restored: boolean;
  /** One capped line, which the panel uses as the change signal for its list. */
  dataPreview: string;
  /**
   * The cached value, bounded — what the panel renders as a collapsible tree.
   *
   * A preview was all the panel got at first, and it kept being the wrong answer: 120 characters
   * showed the key back to you, 2000 stopped in the middle of the second page of an infinite
   * query. The size that matters is not near any cap, so the panel gets the structure and decides
   * how much of it to draw.
   */
  data: unknown;
  error: string | undefined;
}

interface QuerySnapshot {
  clients: { index: number; queries: QueryRow[] }[];
}

interface QueryBridge {
  snapshot(): QuerySnapshot;
  invalidate(clientIndex: number, hash: string): void;
  remove(clientIndex: number, hash: string): void;
}

const clients: QueryClient[] = [];

/**
 * 120 showed `{"products":[{"id":1,"title":"Essence Mascara…` and stopped there, which tells
 * you nothing you did not already know from the key. The panel scrolls a long value now, so the
 * cap is only here to keep a megabyte of cached data off the wire on every poll.
 */
const MAX_PREVIEW = 2000;

function preview(value: unknown): string {
  if (value === undefined) return "—";
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return typeof value;
    return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}…` : text;
  } catch {
    // A cache can hold anything a fetcher returned, including something cyclic.
    return "[unserializable]";
  }
}

/**
 * A JSON-safe copy, bounded twice.
 *
 * The panel is a devtools panel, so it must not be able to hold the app's objects: what crosses
 * the bridge is a copy, and a cache can hold anything a fetcher returned — something enormous,
 * something cyclic, a class instance. A node budget bounds the width and a depth cap bounds the
 * recursion, and it takes both (the budget alone was tried in `structuralSharing`, where a cycle
 * blew the call stack long before 20 000 visits). Anything not walked is replaced by a string that
 * SAYS what it was, because a copy that quietly drops half the answer is worse than no copy.
 */
const SNAPSHOT_BUDGET = 20_000;
const SNAPSHOT_DEPTH = 12;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function snapshotValue(value: unknown, budget: { left: number }, depth: number, seen: Set<unknown>): unknown {
  if (budget.left-- <= 0) return "[… budget]";

  if (Array.isArray(value) || isPlainObject(value)) {
    if (seen.has(value)) return "[circular]";
    if (depth >= SNAPSHOT_DEPTH) return Array.isArray(value) ? `[Array(${value.length}) — too deep]` : "[… too deep]";

    seen.add(value);
    try {
      if (Array.isArray(value)) return value.map((item) => snapshotValue(item, budget, depth + 1, seen));
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) out[key] = snapshotValue(item, budget, depth + 1, seen);
      return out;
    } finally {
      seen.delete(value);
    }
  }

  // A Date, a Map, a class instance, a function: named rather than copied. Reproducing one
  // faithfully is guesswork, and guessing wrong in a panel is worse than saying what it is.
  if (typeof value === "function") return "ƒ()";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "object" && value !== null) {
    try {
      return `${value.constructor?.name ?? "Object"}(${String(value)})`;
    } catch {
      return "[object]";
    }
  }
  return value;
}

function describeError(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (error instanceof Error) return error.message;
  return String(error);
}

function bridge(): QueryBridge {
  return {
    snapshot() {
      return {
        clients: clients.map((client, index) => ({
          index,
          queries: client.all().map((entry) => ({
            key: entry.key,
            hash: entry.hash,
            status: entry.status,
            fetchStatus: entry.fetchStatus,
            observers: entry.observers.size,
            updatedAt: entry.updatedAt,
            failureCount: entry.failureCount,
            restored: entry.restored === true,
            dataPreview: preview(entry.data),
            data: snapshotValue(entry.data, { left: SNAPSHOT_BUDGET }, 0, new Set()),
            error: describeError(entry.error),
          })),
        })),
      };
    },

    // Both take the KEY rather than the hash: a hash cannot be taken apart again, and an
    // exact key is a prefix of itself, so `invalidate`/`remove` hit this entry and nothing
    // else. The entry is looked up fresh each time — a row the panel is showing may have
    // been collected since it was drawn.
    invalidate(clientIndex, hash) {
      const entry = find(clientIndex, hash);
      if (entry) clients[clientIndex]!.invalidate(entry.key);
    },

    remove(clientIndex, hash) {
      const entry = find(clientIndex, hash);
      if (entry) clients[clientIndex]!.remove(entry.key);
    },
  };
}

/** The entry a row stands for, or `undefined` if it was collected in between. */
function find(clientIndex: number, hash: string) {
  return clients[clientIndex]?.all().find((entry) => entry.hash === hash);
}

/**
 * Registers a live client and hands back the function that unregisters it.
 *
 * Returning the cleanup rather than exposing an `unregister(client)` is the same shape
 * `createSubscriptionDecorator` uses, so a provider's `@destroy` has one
 * thing to call and cannot unregister the wrong one.
 */
export function registerDevtoolsClient(client: QueryClient): () => void {
  clients.push(client);
  install();

  return () => {
    const at = clients.indexOf(client);
    if (at !== -1) clients.splice(at, 1);
  };
}

function install(): void {
  const host = globalThis as { __RAMONDA_QUERY__?: QueryBridge };
  if (host.__RAMONDA_QUERY__ !== undefined) return;
  host.__RAMONDA_QUERY__ = bridge();
}

export type { QueryBridge, QueryRow, QuerySnapshot };
