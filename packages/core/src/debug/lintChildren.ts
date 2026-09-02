import { diagnose } from "./diagnostics";
import { displayName } from "../helpers/utils";
import type { MaybeComponent } from "../types/vdom";
import { isListNode, isVNode } from "../vdom/guards";

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
    // A built list is its own key space, so it is scanned as one. A descriptor
    // whose items have not been built yet has no `vnodes` and nothing to scan.
    if (isListNode(rawChild)) {
      if (rawChild.vnodes) scanKeys(rawChild.vnodes, owner);
      continue;
    }

    if (!isVNode(rawChild)) continue;

    const key = rawChild.attributes?.key;
    if (key == null) continue;

    const asString = String(key);
    if (!seen) seen = new Set();

    if (seen.has(asString)) {
      // Both absences get their own word: no owner is `the root`, an owner with no class name is
      // whatever `displayName` calls it. The key followed the same `??` and grouped every nameless
      // component under `root`.
      const where = owner ? `<${displayName(owner)} />` : "the root";
      diagnose(
        "RMD002",
        `${owner === undefined ? "root" : displayName(owner)}:${asString}`,
        `${where} rendered two children with key "${asString}".`,
      );
      continue;
    }

    seen.add(asString);
  }
}
