import { STATE_KEYS, PERSIST_KEYS } from "../helpers/constants";
import { CHILD_HOOKS } from "../core/runtime";
import { diagnose } from "../debug/diagnostics";

/**
 * One node of serialized state: a component's (or hook's) own `@state` + `@persist`
 * values, plus its child hooks in `use()` order (recursively). This tree is
 * produced on the server and restored on the client (restore-only hydration).
 */
export interface SerializedNode {
  state: Record<string, unknown>;
  hooks?: SerializedNode[];
}

interface SerializableInstance {
  [STATE_KEYS]?: Set<string>;
  [PERSIST_KEYS]?: Set<string>;
  [CHILD_HOOKS]?: SerializableInstance[];
}

function componentName(instance: SerializableInstance): string {
  return (instance as { constructor?: { name?: string } }).constructor?.name ?? "Unknown";
}

function warnIfNotSerializable(name: string, key: string, value: unknown): void {
  if (typeof value === "function") {
    diagnose("RMD033", `${name}.${key}`, `<${name}> state "${key}" is a function.`, { component: name, key });
    return;
  }
  try {
    JSON.stringify(value);
  } catch (e) {
    diagnose("RMD033", `${name}.${key}`, `<${name}> state "${key}" is not JSON-serializable.`, {
      component: name,
      key,
      reason: e instanceof Error ? e.message : String(e),
    });
  }
}

function readState(instance: SerializableInstance): Record<string, unknown> {
  const values = instance as unknown as Record<string, unknown>;
  const name = __DEV__ ? componentName(instance) : "";
  const out: Record<string, unknown> = {};

  const collect = (keys: Set<string> | undefined) => {
    if (!keys) return;
    for (const key of keys) {
      const value = values[key];
      if (__DEV__) warnIfNotSerializable(name, key, value);
      out[key] = value;
    }
  };

  // @state auto-persists; @persist adds non-signal state.
  collect(instance[STATE_KEYS]);
  collect(instance[PERSIST_KEYS]);
  return out;
}

function serializeNode(instance: SerializableInstance): SerializedNode {
  const node: SerializedNode = { state: readState(instance) };

  const childHooks = instance[CHILD_HOOKS];
  if (childHooks && childHooks.length > 0) {
    node.hooks = childHooks.map(serializeNode);
  }

  return node;
}

/** Serializes a component's full state tree (its hooks, and their hooks). */
export function serializeComponentTree(component: object): SerializedNode {
  return serializeNode(component as SerializableInstance);
}

/** Same as `serializeComponentTree`, as a JSON string for embedding on the carrier. */
export function serializeComponentToJSON(component: object): string {
  return JSON.stringify(serializeComponentTree(component));
}
