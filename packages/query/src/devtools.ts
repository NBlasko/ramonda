import type { QueryClient } from "./QueryClient";
import { panelRegistry } from "./devtoolsPanel";
import type { PanelPlugin, PanelRow, PanelSnapshot, RowField } from "./devtoolsPanel";

/**
 * The Query tab — a separate entry, imported only by an app that wants it.
 *
 * ## Why this is not in the package's main entry
 *
 * It was, and the cost was invisible: `context.ts` imported it, so the panel description and the
 * list of live clients were in the bundle of every application using queries. `__DEV__` stripped
 * them from production, but not from development — about 9 KB of source that most apps never look
 * at.
 *
 * Here, nothing imports it. An app asks for it:
 *
 * ```ts
 * if (import.meta.env.DEV) {
 *   void import("@ramonda/devtools");
 *   void import("@ramonda/query/devtools");
 * }
 * ```
 *
 * ## How it learns about clients, without the package knowing about it
 *
 * An EVENT. `QueryClientProvider` announces a client arriving and leaving with one guarded line
 * each, and that is the whole of what the main entry carries. This module listens.
 *
 * That is the same shape core already uses for `ramonda:tick` and `ramonda:dev-log`, and it is what
 * keeps the dependency pointing one way: the cache does not import a panel, does not hold a list
 * for one, and does not know whether anybody is listening. A listener that never loads means the
 * events go nowhere, which costs a dispatch.
 *
 * Importing this module registers the tab. There is nothing to call.
 */

/** The live clients, learned from the events and held HERE — never in the package. */
const clients: QueryClient[] = [];

/**
 * Ask what is already here, before listening for what arrives next.
 *
 * This module is imported dynamically, so it loads AFTER the app has hydrated — and a provider that
 * mounted during hydration announced itself to nobody. Without this the Query tab was empty on any
 * app whose provider sits at the root, which is every app.
 */
function askWhatIsAlreadyLive(): void {
  window.dispatchEvent(new CustomEvent("ramonda:query-client-request"));
}

window.addEventListener("ramonda:query-client", (event) => {
  const client = (event as CustomEvent<{ client: QueryClient }>).detail?.client;
  if (client && !clients.includes(client)) clients.push(client);
});

window.addEventListener("ramonda:query-client-gone", (event) => {
  const client = (event as CustomEvent<{ client: QueryClient }>).detail?.client;
  const at = client ? clients.indexOf(client) : -1;
  if (at !== -1) clients.splice(at, 1);
});

panelRegistry().register(queryPanel());

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

function snapshotValue(
  value: unknown,
  budget: { left: number; cut: boolean },
  depth: number,
  seen: Set<unknown>,
): unknown {
  if (budget.left-- <= 0) {
    budget.cut = true;
    return "[… budget]";
  }

  if (Array.isArray(value) || isPlainObject(value)) {
    if (seen.has(value)) {
      budget.cut = true;
      return "[circular]";
    }
    if (depth >= SNAPSHOT_DEPTH) {
      budget.cut = true;
      return Array.isArray(value) ? `[Array(${value.length}) — too deep]` : "[… too deep]";
    }

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
  if (typeof value === "function" || typeof value === "bigint" || typeof value === "symbol") {
    budget.cut = true;
    return typeof value === "function" ? "ƒ()" : String(value);
  }
  if (typeof value === "object" && value !== null) {
    budget.cut = true;
    try {
      return `${value.constructor?.name ?? "Object"}(${String(value)})`;
    } catch {
      return "[object]";
    }
  }
  return value;
}

/**
 * An entry's failure, as one line for the panel.
 *
 * It used to ask `instanceof Error` and fall back to `String`, because a rejection could be
 * anything. `asError` normalises at the catch now, so the only question left is whether there is one.
 */
function describeError(error: Error | undefined): string | undefined {
  return error?.message;
}

/** The bounded copy and whether it IS the whole value, in one pass. */
function describeData(data: unknown): { data: unknown; truncated: boolean } {
  const budget = { left: SNAPSHOT_BUDGET, cut: false };
  const copy = snapshotValue(data, budget, 0, new Set());
  return { data: copy, truncated: budget.cut };
}

/**
 * The Query tab: every live cache, described as rows.
 *
 * What used to be `QueryBridge` — a snapshot shape the panel knew how to draw — is this instead: a
 * description the panel renders without knowing anything about queries. The knowledge that moved
 * here is the part that was always ours. Which badge means fetching, that `observers: 0` is worth
 * calling out, that a bounded copy must not be editable — all of it is about a cache.
 */
function queryPanel(): PanelPlugin {
  return {
    version: 1,
    id: "query",
    label: "QUERY",

    snapshot(): PanelSnapshot {
      return {
        empty: "The cache is empty. It fills in when a query runs.",
        groups: clients.map((client, index) => {
          const entries = client.all();
          return {
            // The index is only worth showing when there IS more than one — an app usually has a
            // single provider, and a label for it would be noise.
            label:
              clients.length > 1
                ? `client ${index + 1} · ${entries.length} ${entries.length === 1 ? "query" : "queries"}`
                : undefined,
            rows: entries.map((entry) => row(index, entry)),
          };
        }),
      };
    },

    /**
     * Both actions take the KEY rather than the hash: a hash cannot be taken apart again, and an
     * exact key is a prefix of itself, so these hit this entry and nothing else. Looked up fresh —
     * a row the panel is showing may have been collected since it was drawn.
     */
    run(rowId, actionId) {
      const [clientIndex, hash] = splitRowId(rowId);
      const entry = find(clientIndex, hash);
      const client = clients[clientIndex];
      if (!entry || !client) return undefined;

      if (actionId === "invalidate") client.invalidate(entry.key);
      else client.remove(entry.key);
      return undefined;
    },
  };
}

function row(clientIndex: number, entry: ReturnType<QueryClient["all"]>[number]): PanelRow {
  const copy = describeData(entry.data);

  return {
    id: `${clientIndex}::${entry.hash}`,
    title: JSON.stringify(entry.key),
    code: true,
    status: entry.status === "error" ? "error" : entry.status === "success" ? "ok" : "busy",
    fields: fields(entry),
    error: describeError(entry.error),
    value: {
      data: copy.data,
      // What the panel shows when the value itself was too large to copy.
      preview: preview(entry.data),
      // `updatedAt` moves on every write, always — which a preview cannot promise, because a change
      // past its capped end (an eighth page appended to an infinite query) leaves the first line
      // identical.
      revision: entry.updatedAt,
      /**
       * Refused for a copy that hit a bound: writing back a value containing `"[… budget]"` where
       * the rest of a list used to be would put those markers into the cache. Reading a bounded
       * copy is fine; sending it back is not.
       */
      editable: !copy.truncated,
      writeNote: "a refetch will replace it",
      /**
       * Goes through `setData` rather than touching the entry, so everything that makes a write
       * coherent still happens: a fetch in flight is abandoned (it is older information than this),
       * structural sharing keeps the identity of what did not change, `updatedAt` moves, and every
       * observer is notified.
       *
       * This is the one place in the panel where editing a value shows up on the page immediately,
       * and that is not a coincidence: the cache IS what a query renders from.
       */
      write: (value: unknown) => {
        const live = find(clientIndex, entry.hash);
        if (!live) return "that entry is no longer in the cache";
        clients[clientIndex]!.setData(live.key, value);
        return undefined;
      },
    },
    /**
     * There is no "refetch", and that is the design rather than an omission: the FETCHER belongs to
     * the observer, not to the cache, so a query nobody is watching has no function to call.
     * `invalidate` is the honest equivalent — it marks the entry stale and asks whoever is watching
     * to refresh, which is exactly what a mutation does.
     */
    actions: [
      { id: "invalidate", label: "invalidate" },
      { id: "remove", label: "remove" },
    ],
  };
}

function fields(entry: ReturnType<QueryClient["all"]>[number]): RowField[] {
  const list: RowField[] = [
    {
      kind: "text",
      text:
        entry.failureCount > 0
          ? `${entry.status} · ${entry.failureCount} failure${entry.failureCount === 1 ? "" : "s"}`
          : entry.status,
    },
    // Live, because it is a clock: it differs on almost every poll while nothing about the cache
    // has moved, and rebuilding the list for it is what made the tab flicker.
    { kind: "live", id: "age", text: `updated ${age(entry.updatedAt)}` },
    {
      kind: "text",
      // `observers: 0` is the interesting one: the entry is alive but nobody is watching, so it is
      // waiting out its gcTime. That is the state people ask about.
      text:
        entry.observers.size === 0
          ? "0 observers · waiting for gc"
          : `${entry.observers.size} observer${entry.observers.size === 1 ? "" : "s"}`,
    },
  ];

  if (entry.fetchStatus === "fetching") list.push({ kind: "badge", text: "fetching…", tone: "warn" });
  if (entry.restored === true) list.push({ kind: "badge", text: "from server" });

  return list;
}

function age(updatedAt: number): string {
  return updatedAt === 0 ? "never" : `${Math.max(0, Math.round((Date.now() - updatedAt) / 1000))}s ago`;
}

/**
 * Split on the FIRST separator only: a hash is JSON and can contain anything the key did,
 * including the separator itself.
 */
function splitRowId(rowId: string): [number, string] {
  const at = rowId.indexOf("::");
  return [Number(rowId.slice(0, at)), rowId.slice(at + 2)];
}

/** The entry a row stands for, or `undefined` if it was collected in between. */
function find(clientIndex: number, hash: string) {
  return clients[clientIndex]?.all().find((entry) => entry.hash === hash);
}

/**
 * Registers a live client and hands back the function that unregisters it.
 *
 * Returning the cleanup rather than exposing an `unregister(client)` is the same shape
 * `createSubscriptionDecorator` uses, so a provider's `@destroyed` has one
 * thing to call and cannot unregister the wrong one.
 */
/**
 * The registered providers, keyed by instance.
 *
 * Here rather than as a field on the provider, and the reason is what a class member costs: a
 * declared field is emitted on every instance and a method cannot be tree-shaken, so both survived
 * into the PRODUCTION bundle of an app that will never open a panel. Measured on `@ramonda/form`,
 * where the same shape cost ~500 bytes of dead method plus a slot per form.
 *
 * A `WeakMap` also means an unregistered provider is collectable without anything to remember.
 */
const leaving = new WeakMap<object, () => void>();

/** Registers a provider's client and remembers how to unregister it. */
export function joinDevtools(provider: object, client: QueryClient): void {
  leaving.set(provider, registerDevtoolsClient(client));
}

/** Unregisters it. Safe for a provider that never joined — a server render, or a production build. */
export function leaveDevtools(provider: object): void {
  const leave = leaving.get(provider);
  if (!leave) return;
  leaving.delete(provider);
  leave();
}

export function registerDevtoolsClient(client: QueryClient): () => void {
  clients.push(client);
  install();

  return () => {
    const at = clients.indexOf(client);
    if (at !== -1) clients.splice(at, 1);
  };
}

/**
 * Registers the Query tab, once, the first time a provider mounts.
 *
 * Once rather than per client: the tab lists every live cache, so a second provider adds a group to
 * it rather than a second tab. Deregistering is deliberately not done when the last client goes —
 * the tab then says the cache is empty, which is the truth and is more useful than a tab that
 * appears and disappears as an app navigates.
 */
function install(): void {
  if (registered) return;
  registered = true;
  panelRegistry().register(queryPanel());
}

let registered = false;

// Last, so the listeners above are in place when the answers come back.
askWhatIsAlreadyLive();
