import { diagnose } from "./diagnostics";

/**
 * Flags a `@state` value that cannot survive the trip to the client — a function,
 * a symbol, or a bigint. `@state` is serialized into the hydration blob as JSON,
 * and JSON has no representation for any of these: a function and a symbol are
 * dropped silently, a bigint makes `JSON.stringify` throw. Either way the client
 * would hydrate with the field missing.
 *
 * DEV-only and deliberately O(1): a single `typeof`, cheap enough to sit on the
 * hot `@state` write path. It catches the common mistake — assigning a function
 * straight to state — at the moment it happens, on the client too, not only during
 * a server render.
 *
 * Deeper cases (a `Map`, a `Date`, a circular object) are left to the SSR
 * serializer's own check in `hydration/serialize.ts`, which runs once per render
 * rather than once per write and can afford a full `JSON.stringify`.
 */
export function reportNonSerializableState(value: unknown, key: string, owner: string): void {
  const t = typeof value;
  if (t === "function" || t === "symbol" || t === "bigint") {
    diagnose("RMD019", `${owner}:${key}`, `<${owner} /> set @state \`${key}\` to a ${t}.`);
  }
}
