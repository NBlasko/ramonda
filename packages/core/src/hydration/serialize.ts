import { STATE_KEYS, PERSIST_KEYS, INITIAL_PRIMITIVES } from "../helpers/constants";
import { CHILD_HOOKS } from "../core/runtime";
import { diagnose } from "../debug/diagnostics";
import { displayName } from "../helpers/utils";

/**
 * One node of serialized state: a component's (or hook's) own `@state` + `@persist`
 * values, plus its child hooks in `use()` order (recursively). This tree is
 * produced on the server and restored on the client (restore-only hydration).
 */
export interface SerializedNode {
  state: Record<string, unknown>;
  /**
   * Keys the server explicitly emptied — set to `undefined` after their initializer produced
   * something else.
   *
   * They cannot ride in `state`, and that is a property of JSON rather than a choice:
   * `JSON.stringify({ name: undefined })` is `{}`, so a field the server CLEARED and a field it
   * never touched arrive at the client identical. Measured — `@state name = "Ada"` set to
   * `undefined` serialized to `{"state":{}}`, and the browser's initializer then put "Ada" back.
   * A signed-out visitor got the signed-in name.
   *
   * `null` is not affected and is not listed here: JSON carries it, and conflating the two would
   * make an explicit `null` unrepresentable.
   *
   * Absent when there are none, so an ordinary page pays nothing for it.
   */
  cleared?: string[];
  hooks?: SerializedNode[];
}

interface SerializableInstance {
  [STATE_KEYS]?: Set<string>;
  [PERSIST_KEYS]?: Set<string>;
  [INITIAL_PRIMITIVES]?: Record<string, unknown>;
  [CHILD_HOOKS]?: SerializableInstance[];
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

/**
 * A field still holding the primitive its own initializer produced is left OUT of the blob.
 *
 * The client's initializer produces it again, so restoring it is a no-op and the bytes buy nothing.
 * Measured on a form of five rows before this: 942 of 1935 bytes were hydration state, and nearly
 * all of it was `{"version":0}` — the subscription counter every watched component carries, always
 * zero on the server. At 300 rows that is around 17 KB of markup saying nothing.
 *
 * **Primitives only**, decided by measurement rather than by thrift: an in-place mutation
 * (`this.rows.push(…)`) keeps the very object the initializer produced, and that mutated array
 * reaches the blob today — RMD005 reports it, and the page still works because the blob carries it.
 * An identity test on objects would call it untouched and hand the client an empty one. A primitive
 * has no in-place to mutate, so the question cannot arise.
 *
 * **What this does break, and it is already documented as a mistake:** a NON-deterministic
 * primitive initializer. `@state now = Date.now()` used to survive because the blob carried the
 * server's number; without it the browser's initializer runs and wins — measured, 101 on the server
 * became 103 after hydration. `/ssr/mismatches` already marks that spelling wrong and prescribes
 * computing in `@created({ env: "server" })` and carrying it with `@persist` — and that prescription
 * is untouched here, because a computed value is not the one the initializer produced.
 */
function unchangedFromInitial(instance: SerializableInstance, key: string, value: unknown): boolean {
  const initial = instance[INITIAL_PRIMITIVES];
  return initial !== undefined && key in initial && Object.is(initial[key], value);
}

function readState(instance: SerializableInstance): { state: Record<string, unknown>; cleared?: string[] } {
  const values = instance as unknown as Record<string, unknown>;
  const name = __DEV__ ? displayName(instance) : "";
  const out: Record<string, unknown> = {};
  let cleared: string[] | undefined;

  const collect = (keys: Set<string> | undefined) => {
    if (!keys) return;
    for (const key of keys) {
      const value = values[key];
      if (__DEV__) warnIfNotSerializable(name, key, value);
      if (unchangedFromInitial(instance, key, value)) continue;
      // `undefined` cannot travel in `state` — see `SerializedNode.cleared`. It reaches here only
      // when the initializer produced something ELSE, because a field whose initializer produced
      // `undefined` and still holds it was skipped on the line above.
      if (value === undefined) {
        (cleared ??= []).push(key);
        continue;
      }
      out[key] = value;
    }
  };

  // @state auto-persists; @persist adds non-signal state.
  collect(instance[STATE_KEYS]);
  collect(instance[PERSIST_KEYS]);
  return cleared === undefined ? { state: out } : { state: out, cleared };
}

/**
 * Whether a serialized tree carries anything a client could restore.
 *
 * With untouched primitives left out, a page of components that have not moved off their initial
 * values produces a tree of empty shells — `{"state":{},"hooks":[{"state":{}}]}` — which is around
 * 90 bytes of attribute per component saying nothing. Measured on a five-row form: dropping the
 * VALUES took the markup from 1935 to 1767 bytes, and dropping the empty shells with them takes it
 * to what a page with no hydration state should cost.
 *
 * The hook LIST is not evidence: it exists so state can be restored by position, so a list whose
 * every node is empty has no position worth finding. What is lost by not writing it is RMD035, the
 * development report that the client built a different number of hooks than the server — and only
 * for a tree where neither side had anything to restore, which is the case where that mismatch has
 * nothing to corrupt.
 */
function carriesNothing(node: SerializedNode): boolean {
  for (const _ in node.state) return false;
  if (node.cleared !== undefined) return false;
  return node.hooks === undefined || node.hooks.every(carriesNothing);
}

function serializeNode(instance: SerializableInstance): SerializedNode {
  const node: SerializedNode = readState(instance);

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

/**
 * The blob to stamp on a carrier, or `undefined` when there is nothing to stamp.
 *
 * Kept beside the serializer rather than in `ssr.ts` so the decision and the shape it inspects live
 * together — `carriesNothing` is about this module's format, and the renderer should not have to
 * know it.
 */
export function serializeComponentToBlob(component: object): string | undefined {
  const tree = serializeComponentTree(component);
  return carriesNothing(tree) ? undefined : JSON.stringify(tree);
}
