import type { VNode } from "../types/vdom";
import { diffAndMerge } from "../core/DiffAndMerge";

export function generateElements(rootComponent: VNode) {
  return diffAndMerge(rootComponent, undefined, undefined);
}
