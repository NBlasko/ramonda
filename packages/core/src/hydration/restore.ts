import { STATE_KEYS, PERSIST_KEYS } from "../helpers/constants";
import { CHILD_HOOKS } from "../core/runtime";
import { diagnose } from "../debug/diagnostics";
import { displayName } from "../helpers/utils";
import type { SerializedNode } from "./serialize";

interface RestorableInstance {
  [STATE_KEYS]?: Set<string>;
  [PERSIST_KEYS]?: Set<string>;
  [CHILD_HOOKS]?: RestorableInstance[];
}

function restoreState(instance: RestorableInstance, state: Record<string, unknown>): void {
  const target = instance as unknown as Record<string, unknown>;

  // Only restore keys this instance actually declares (@state / @persist), so a
  // stale or tampered blob can't inject arbitrary properties. Writing a @state
  // key goes through its setter; a @persist key is a plain assignment.
  const apply = (keys: Set<string> | undefined) => {
    if (!keys) return;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        target[key] = state[key];
      }
    }
  };

  apply(instance[STATE_KEYS]);
  apply(instance[PERSIST_KEYS]);
}

function restoreNode(instance: RestorableInstance, node: SerializedNode): void {
  restoreState(instance, node.state);

  const childHooks = instance[CHILD_HOOKS] ?? [];
  const serializedHooks = node.hooks ?? [];

  if (__DEV__ && childHooks.length !== serializedHooks.length) {
    diagnose(
      "RMD035",
      displayName(instance),
      `<${displayName(instance)}> built ${childHooks.length} hook(s) and the server serialized ${serializedHooks.length}.`,
      { component: displayName(instance), client: childHooks.length, server: serializedHooks.length },
    );
  }

  // Match by position — child hooks are tracked in deterministic use() order.
  const count = Math.min(childHooks.length, serializedHooks.length);
  for (let i = 0; i < count; i++) {
    restoreNode(childHooks[i], serializedHooks[i]);
  }
}

/**
 * Restores a serialized state tree onto a live component instance (and its
 * hooks, recursively). Restore-only hydration: call this before the client
 * runs its client-only lifecycle/render so state is in place first.
 */
export function restoreComponentTree(component: object, node: SerializedNode): void {
  restoreNode(component as RestorableInstance, node);
}

/** Same as `restoreComponentTree`, parsing the JSON string from the carrier. */
export function restoreComponentFromJSON(component: object, json: string): void {
  restoreComponentTree(component, JSON.parse(json) as SerializedNode);
}
