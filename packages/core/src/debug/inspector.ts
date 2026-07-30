import { STATE_KEYS, PERSIST_KEYS, CONTEXT_READS } from "../helpers/constants";
import { definitionOf, type SourceLocation } from "./sourceLocation";
import { CHILD_HOOKS, HOOK_RUNTIME, COMPONENT_RUNTIME } from "../core/runtime";

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
  [STATE_KEYS]?: Set<string>;
  [PERSIST_KEYS]?: Set<string>;
  [CHILD_HOOKS]?: Inspectable[];
  [HOOK_RUNTIME]?: { rawProps?: Record<string, unknown> };
  [CONTEXT_READS]?: () => Record<string, unknown>;
  [COMPONENT_RUNTIME]?: { rawProps?: Record<string, unknown> };
  constructor?: { name?: string };
}

// Framework-internal props that aren't useful to inspect.
const IGNORED_PROPS = new Set(["children", "key"]);

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

/** Serializes an instance's child hooks (and their hooks) recursively. */
function readHooks(instance: Inspectable): InspectedNode[] {
  const childHooks = instance[CHILD_HOOKS];
  if (!childHooks || childHooks.length === 0) return [];

  return childHooks.map((hook) => ({
    id: handles.push(hook) - 1,
    name: hook.constructor?.name ?? "Hook",
    kind: "hook" as const,
    state: readState(hook),
    options: readOptions(hook),
    reads: readContextReads(hook),
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
  const tree: InspectedNode[] = [];

  for (const child of Array.from(node.childNodes)) {
    const enhanced = child as Node & {
      _componentInstance?: Inspectable;
      _componentDefinition?: { name?: string } | string;
    };

    if (enhanced._componentInstance) {
      const instance = enhanced._componentInstance;
      const def = enhanced._componentDefinition;
      const name = (typeof def === "string" ? def : def?.name) ?? instance.constructor?.name ?? "Unknown";

      tree.push({
        id: handles.push(instance) - 1,
        name,
        kind: "component",
        state: readState(instance),
        props: readProps(instance),
        source: definitionOf(instance.constructor),
        hooks: readHooks(instance),
        children: scanComponentTree(enhanced, depth + 1),
        node: enhanced,
      });
    } else if (child.childNodes.length > 0) {
      tree.push(...scanComponentTree(child, depth + 1));
    }
  }

  return tree;
}
