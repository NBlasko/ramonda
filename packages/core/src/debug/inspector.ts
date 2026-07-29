import { STATE_KEYS, PERSIST_KEYS, CONTEXT_READS } from "../helpers/constants";
import { CHILD_HOOKS, HOOK_RUNTIME, COMPONENT_RUNTIME } from "../core/runtime";

export interface InspectedNode {
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
    name: hook.constructor?.name ?? "Hook",
    kind: "hook" as const,
    state: readState(hook),
    options: readOptions(hook),
    reads: readContextReads(hook),
    hooks: readHooks(hook),
    children: [],
  }));
}

/**
 * Walks the live DOM subtree and builds an inspector tree of components, each
 * with its own @state/@persist AND its hooks + nested hooks. Pull-model: the
 * devtools (same window) calls this on demand; the core no longer pushes it.
 */
export function scanComponentTree(node: Node = document.body): InspectedNode[] {
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
        name,
        kind: "component",
        state: readState(instance),
        props: readProps(instance),
        hooks: readHooks(instance),
        children: scanComponentTree(enhanced),
        node: enhanced,
      });
    } else if (child.childNodes.length > 0) {
      tree.push(...scanComponentTree(child));
    }
  }

  return tree;
}
