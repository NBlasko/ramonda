import { STATE_KEYS, PERSIST_KEYS, CONTEXT_READS, CHILD_RECORD } from "../helpers/constants";
import { isRegion, isComponentRegion } from "../core/DiffAndMerge";
import type { EnhancedChildNode, RecordEntry } from "../types/vdom";
import { INSPECT } from "../base/inspect";
import { inspectPhase } from "./renderPhase";
import { definitionOf, type SourceLocation } from "./sourceLocation";
import { HOOK_META, type HookMeta } from "../types/HookTypes";
import { CHILD_HOOKS, HOOK_RUNTIME, COMPONENT_RUNTIME } from "../core/runtime";
import { computeStatsOf } from "./computeStats";

export interface InspectedNode {
  /**
   * A handle for THIS scan, so the panel can ask for a write without inventing its own way to name
   * a node.
   *
   * Deliberately not stable across scans: it is an index into the instances this walk saw, and a
   * panel holding an old one gets "gone" rather than a write into whatever now occupies that slot.
   * The alternative — the panel sending back the path it built for its own rows — would mean two
   * copies of the same traversal that have to agree forever.
   */
  id: number;
  name: string;
  kind: "component" | "hook";
  state: Record<string, unknown>;
  /** A component's current props (excluding `children`/`key`). */
  props?: Record<string, unknown>;
  /** A hook's current options (its `this.use(Hook, () => options)` inputs / provided value). */
  options?: Record<string, unknown>;
  /**
   * A context consumer's reads: the keys it is subscribed to with their values, and the keys it has
   * never read named as such. Only a consumer has this — see `CONTEXT_READS`.
   */
  reads?: Record<string, unknown>;
  /**
   * Per `@compute`: how many reads the cache answered, and how many ran the body.
   *
   * A measurement rather than a verdict. A compute that never hits may be perfectly reasonable —
   * its dependencies may genuinely move on every pass — but the gap between "cache this" and
   * "nothing was ever cached" is worth being able to see. Only members that have been read at all
   * appear. See `debug/computeStats.ts`.
   */
  computes?: Record<string, { hits: number; misses: number }>;
  /**
   * What the instance says it holds, from its own `[INSPECT]()`.
   *
   * For a hook whose state lives in plain fields behind a `@state` counter — which is what the
   * framework recommends for anything that must not be serialised — `state` is that counter and
   * nothing else. This is the instance's own answer. See `INSPECT`.
   */
  detail?: Record<string, unknown>;
  /** Child hooks (and their nested hooks), in use() order. */
  hooks: InspectedNode[];
  /** Nested child components (only for component nodes). */
  children: InspectedNode[];
  /** Live DOM node backing a component (used for highlight). Not serialized. */
  node?: Node;
  /** Where the class is defined, so the panel can open it in an editor. See `sourceLocation`. */
  source?: SourceLocation;
}

interface Inspectable {
  [INSPECT]?: () => Record<string, unknown>;
  [STATE_KEYS]?: Set<string>;
  [PERSIST_KEYS]?: Set<string>;
  [CHILD_HOOKS]?: Inspectable[];
  [HOOK_RUNTIME]?: { rawProps?: Record<string, unknown> };
  [CONTEXT_READS]?: () => Record<string, unknown>;
  [COMPONENT_RUNTIME]?: { rawProps?: Record<string, unknown> };
  constructor?: { name?: string };
}

// Framework-internal props that aren't useful to inspect.
// `ref` joins them for the same reason: it is the framework's, not the app's —
// it is pointed at the host element and never read again — so in the panel it
// was an opaque `{ current: … }` among a component's actual data.
const IGNORED_PROPS = new Set(["children", "key", "ref"]);

/**
 * The instances the LAST scan saw, by handle. Rebuilt by every scan, so it holds nothing longer than
 * the panel's current picture of the tree.
 */
let handles: object[] = [];

/** What a write can be told, in the panel's words. */
export type WriteResult = "ok" | "gone" | "not-state" | "unchanged";

/**
 * Writes one `@state` or `@persist` field, on behalf of the panel.
 *
 * ## Why only those two
 *
 * Props are read-only, and not by convention: assigning to one THROWS in every build (RMD004 for a
 * component, RMD015 for a hook), because they are owned by whoever rendered you. A panel that let
 * you type into them would either throw in your face or — worse, if we caught it — look like it had
 * worked while the next render put the old value back. So a props row is read-only in the panel too,
 * and says why.
 *
 * ## Why it replaces the whole value
 *
 * A signal holds a VALUE, not a proxy: mutating inside an object notifies nobody. So "edit
 * `user.name`" has to become "assign a new `user`", which is what the panel does — it hands back the
 * whole field. That is the same rule the framework asks of application code, and the panel is not
 * exempt from it.
 *
 * The write goes through the ordinary setter, so everything downstream is ordinary too: the signal
 * notifies, the component rebuilds, `@updated` runs, a diagnostic fires if the value is not
 * serializable. Nothing here is a special path into the runtime.
 */
export function writeInspectedState(id: number, key: string, value: unknown): WriteResult {
  const instance = handles[id] as Inspectable | undefined;
  if (!instance) return "gone";

  const stateKeys = instance[STATE_KEYS];
  const persistKeys = instance[PERSIST_KEYS];
  if (!stateKeys?.has(key) && !persistKeys?.has(key)) return "not-state";

  const target = instance as unknown as Record<string, unknown>;
  if (target[key] === value) return "unchanged";

  target[key] = value;
  return "ok";
}

/**
 * Reads an instance's live state: @state values (reactive) plus @persist values
 * (non-reactive). Reading happens outside any effect/tracker, so it registers no
 * dependency — inspecting never perturbs reactivity.
 */
function readState(instance: Inspectable): Record<string, unknown> {
  const values = instance as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const collect = (keys: Set<string> | undefined) => {
    if (!keys) return;
    for (const key of keys) out[key] = values[key];
  };

  collect(instance[STATE_KEYS]);
  collect(instance[PERSIST_KEYS]);
  return out;
}

/**
 * Reads a hook's current options — the values passed via `this.use(Hook, () =>
 * options)`, which for a context Provider IS the provided value. These live in
 * the hook runtime, not in @state, so they'd otherwise be invisible.
 */
function readOptions(instance: Inspectable): Record<string, unknown> | undefined {
  const raw = instance[HOOK_RUNTIME]?.rawProps;
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) out[key] = raw[key];
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * A context consumer's reads, asked OF the consumer.
 *
 * The inspector cannot work these out itself: a consumer's values are accessors that subscribe on
 * read, so walking them would change what the owning component re-renders on. The consumer knows
 * which keys it has already subscribed to, and only those are safe to read.
 */
/**
 * Asks the instance what it holds, if it has an answer.
 *
 * Wrapped, because this calls code the framework did not write, during a walk whose whole job is to
 * diagnose an app that may already be broken. A `[INSPECT]()` that throws — reading a field that is
 * undefined mid-construction, say — must cost that one row its detail and nothing more; letting it
 * escape would take down the scan and the panel with it, exactly when someone is trying to find out
 * why.
 */
function readDetail(instance: Inspectable): Record<string, unknown> | undefined {
  const describe = instance[INSPECT];
  if (typeof describe !== "function") return undefined;

  // Marked for the duration of the call, so a `@state` write inside it can be named (RMD030).
  // Restored in `finally` rather than after the call: a `[INSPECT]()` that throws must not leave
  // the phase set, or the next unrelated write anywhere in the app would be reported as this one's.
  const previous = inspectPhase.instance;
  inspectPhase.instance = instance;

  try {
    const detail = describe.call(instance);
    return detail !== null && typeof detail === "object" ? detail : undefined;
  } catch (error) {
    return { "[INSPECT] threw": String(error) };
  } finally {
    inspectPhase.instance = previous;
  }
}

function readContextReads(instance: Inspectable): Record<string, unknown> | undefined {
  const report = instance[CONTEXT_READS];
  if (typeof report !== "function") return undefined;
  const reads = report.call(instance);
  return Object.keys(reads).length > 0 ? reads : undefined;
}

/** Reads a component's current props (raw), minus framework internals. */
function readProps(instance: Inspectable): Record<string, unknown> | undefined {
  const raw = instance[COMPONENT_RUNTIME]?.rawProps;
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (IGNORED_PROPS.has(key)) continue;
    out[key] = raw[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * What to call a hook in the tree: its class, plus the `label` from its `use()` metadata —
 * `Form (Sign Up)`.
 *
 * Added to the name rather than replacing it. The class says WHAT the node is, which is the first
 * thing a reader needs and the one thing a label cannot recover; the label says WHICH one it is,
 * which the class cannot give — `this.constructor.name` is `Form` for every form on the page.
 *
 * Read from the metadata argument of `use()`, never from the props: a hook's props belong to whoever
 * wrote the hook, and a framework word reserved in there collides with a real one eventually. On a
 * form it collides at once, since a form is full of labels.
 */
function hookName(hook: Inspectable): string {
  const name = hook.constructor?.name ?? "Hook";
  const label = (hook as { [HOOK_META]?: HookMeta })[HOOK_META]?.label;
  if (typeof label !== "string") return name;

  const trimmed = label.trim();
  // A label that only repeats the class earns nothing but a pair of brackets.
  if (trimmed === "" || trimmed === name) return name;
  return `${name} (${trimmed})`;
}

/** Serializes an instance's child hooks (and their hooks) recursively. */
function readHooks(instance: Inspectable): InspectedNode[] {
  const childHooks = instance[CHILD_HOOKS];
  if (!childHooks || childHooks.length === 0) return [];

  return childHooks.map((hook) => ({
    id: handles.push(hook) - 1,
    name: hookName(hook),
    kind: "hook" as const,
    state: readState(hook),
    detail: readDetail(hook),
    options: readOptions(hook),
    reads: readContextReads(hook),
    computes: computeStatsOf(hook),
    source: definitionOf(hook.constructor),
    hooks: readHooks(hook),
    children: [],
  }));
}

/**
 * Walks the live DOM subtree and builds an inspector tree of components, each
 * with its own @state/@persist AND its hooks + nested hooks. Pull-model: the
 * devtools (same window) calls this on demand; the core no longer pushes it.
 */
export function scanComponentTree(node: Node = document.body, depth = 0): InspectedNode[] {
  // The root call clears the handles, so they always describe exactly what this scan returns.
  if (depth === 0) handles = [];

  /**
   * The CHILD RECORD is the tree, not the DOM.
   *
   * A component has no element of its own: it may own two nodes, or none, so there is nothing to
   * read a `_componentInstance` back-reference off. The record is what says a component is here and
   * which nodes are its own — and it is the only thing that can show a component that renders
   * nothing at all, which the DOM walk could never have found.
   *
   * A list region is walked THROUGH rather than shown. It is not a component and has no state of
   * its own to inspect; its rows are what the panel is looking for.
   */
  const record = (node as EnhancedChildNode)[CHILD_RECORD];
  if (record === undefined) {
    const tree: InspectedNode[] = [];
    for (const child of Array.from(node.childNodes)) {
      if (child.childNodes.length > 0) tree.push(...scanComponentTree(child, depth + 1));
    }
    return tree;
  }

  return scanEntries(record, depth);
}

function scanEntries(entries: RecordEntry[], depth: number): InspectedNode[] {
  const tree: InspectedNode[] = [];

  for (const entry of entries) {
    if (!isRegion(entry)) {
      // A plain element. Its own children may hold components, and it keeps a record of its own when
      // they do — so this is the same question one level down.
      if (entry.childNodes.length > 0) tree.push(...scanComponentTree(entry, depth + 1));
      continue;
    }

    if (!isComponentRegion(entry)) {
      tree.push(...scanEntries(entry.entries, depth + 1));
      continue;
    }

    const instance = entry.instance as unknown as Inspectable;
    const name = (entry.definition as { name?: string })?.name ?? instance.constructor?.name ?? "Unknown";

    tree.push({
      id: handles.push(instance) - 1,
      name,
      kind: "component",
      state: readState(instance),
      detail: readDetail(instance),
      props: readProps(instance),
      computes: computeStatsOf(instance),
      source: definitionOf(instance.constructor),
      hooks: readHooks(instance),
      children: scanEntries(entry.entries, depth + 1),
      /**
       * The first node this component owns, for the panel to highlight.
       *
       * `undefined` for a component that rendered nothing, and that is the honest answer: it is in
       * the tree, with its state and its hooks, and there is nothing on the page to point at.
       */
      node: entry.order[0] as Node | undefined,
    });
  }

  return tree;
}
