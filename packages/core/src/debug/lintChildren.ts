import { diagnose } from "./diagnostics";
import type { MaybeComponent } from "../types/vdom";
import { IS_LIST } from "../helpers/constants";

/**
 * Checks a child list for key mistakes reconciliation cannot recover from.
 * DEV-only, runs once per render of the parent element.
 *
 * Only duplicates are reported. Mixing keyed and non-keyed children is legal —
 * `<ul><li>Header</li>{items.map((i) => <li key={i} />)}</ul>` is fine — so
 * flagging it would be noise.
 */
export function lintChildKeys(vnodeChildren: unknown[], owner: MaybeComponent): void {
  scanKeys(vnodeChildren, owner);
}

/**
 * Keys are scoped to the group they sit in, so each group is scanned on its own.
 * A key repeated across two different groups is not a collision — the diff never
 * matches across a group boundary — and reporting it would be noise about
 * something that cannot go wrong.
 */
function scanKeys(vnodeChildren: unknown[], owner: MaybeComponent): void {
  let seen: Set<string> | undefined;

  for (const rawChild of vnodeChildren) {
    if (rawChild == null || typeof rawChild !== "object") continue;

    const list = rawChild as { [IS_LIST]?: true; vnodes?: unknown[] };
    if (list[IS_LIST] && list.vnodes) {
      scanKeys(list.vnodes, owner);
      continue;
    }

    const key = (rawChild as { attributes?: { key?: unknown } }).attributes?.key;
    if (key == null) continue;

    const asString = String(key);
    if (!seen) seen = new Set();

    if (seen.has(asString)) {
      const where = owner ? `<${owner.constructor.name} />` : "the root";
      diagnose(
        "RMD002",
        `${owner?.constructor.name ?? "root"}:${asString}`,
        `${where} rendered two children with key "${asString}".`,
      );
      continue;
    }

    seen.add(asString);
  }
}
