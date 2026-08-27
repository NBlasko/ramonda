import { describe, test, expect } from "vitest";
import { reorderChildren } from "../core/DiffAndMerge";

/**
 * The move minimiser, fuzzed.
 *
 * `reorderChildren` is the sharp end of the children diff: it decides which nodes may stay where
 * they are and which have to be inserted, from a longest increasing subsequence over their current
 * positions. Everything about it is easy to get subtly wrong — an off-by-one in the LIS, the
 * mapping back through the freshly-built nodes it has to exclude, the anchor it walks backwards
 * from — and every one of those bugs looks the same from outside: rows in the wrong order, or a row
 * that keeps its DOM and loses its place.
 *
 * The suite around it tests the shapes somebody thought of. This tests four thousand nobody did.
 *
 * The LIS underneath was checked separately, against a brute-force reference over 200,000 random
 * inputs including duplicates: indices ascending, values strictly increasing, and the length always
 * equal to the true longest. It is not reachable from here to test directly, and it did not need
 * fixing — this is the layer that can.
 */

/** A parent holding `n` labelled children, in order. */
function parentOf(n: number) {
  const parent = document.createElement("div");
  const nodes: HTMLElement[] = [];
  for (let i = 0; i < n; i++) {
    const el = document.createElement("i");
    el.textContent = String(i);
    parent.appendChild(el);
    nodes.push(el);
  }
  return { parent, nodes };
}

const order = (parent: Element) =>
  Array.from(parent.childNodes)
    .map((n) => n.textContent)
    .join(",");

describe("reorderChildren fuzz", () => {
  test("the DOM ends in exactly the requested order", () => {
    let failures: string[] = [];

    for (let trial = 0; trial < 4000; trial++) {
      const existing = 1 + Math.floor(Math.random() * 7);
      const { parent, nodes } = parentOf(existing);
      const previousOrder = [...nodes];

      // A target order: some of the existing nodes (shuffled, possibly dropped) plus some fresh
      // ones that have never been in the parent.
      const kept = nodes.filter(() => Math.random() > 0.25);
      for (let i = kept.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [kept[i], kept[j]] = [kept[j], kept[i]];
      }
      const freshCount = Math.floor(Math.random() * 3);
      const target = [...kept];
      for (let f = 0; f < freshCount; f++) {
        const el = document.createElement("i");
        el.textContent = `n${f}`;
        target.splice(Math.floor(Math.random() * (target.length + 1)), 0, el);
      }
      if (target.length === 0) continue;

      // The children the render dropped are removed first, which is what the real caller does.
      for (const node of nodes) if (!target.includes(node)) node.remove();
      const stillThere = previousOrder.filter((n) => n.parentNode === parent);

      // Both spellings the function supports: with a recorded previous order, and without.
      const usePrevious = trial % 2 === 0;
      reorderChildren(parent, target, null, usePrevious ? stillThere : undefined);

      const want = target.map((n) => n.textContent).join(",");
      if (order(parent) !== want) {
        failures.push(`prev=${usePrevious} want [${want}] got [${order(parent)}]`);
      }
    }

    expect(failures.slice(0, 5)).toEqual([]);
  });

  test("it moves no more nodes than it has to", () => {
    // A pure rotation of five: four stay, one moves. Anything more is a wasted DOM write.
    const { parent, nodes } = parentOf(5);
    const target = [nodes[4], nodes[0], nodes[1], nodes[2], nodes[3]];

    let inserts = 0;
    const real = parent.insertBefore.bind(parent);
    parent.insertBefore = ((node: Node, ref: Node | null) => {
      inserts++;
      return real(node, ref);
    }) as typeof parent.insertBefore;

    reorderChildren(parent, target, null, [...nodes]);

    expect(order(parent)).toBe("4,0,1,2,3");
    expect(inserts).toBe(1);
  });
});
