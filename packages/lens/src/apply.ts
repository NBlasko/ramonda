import { exoticName, isArray, isContainer, shallowClone } from "./clone";
import { formatPath, type Step } from "./steps";
import { warn } from "./warn";

/**
 * One walk down a recorded path, copying only what it must.
 *
 * The rule that makes structural sharing fall out for free: a level is copied
 * ONLY if the value below it came back different. `Object.is(prev, next)`
 * propagates all the way up, so a write that changes nothing returns the
 * original root with every reference intact, and a write that changes one leaf
 * mints exactly one new object per level between the root and that leaf.
 */
interface Walk {
  readonly steps: readonly Step[];
  /**
   * The index at which `terminal` takes over.
   *
   * `steps.length` for everything that replaces the focused value, and
   * `steps.length - 1` for `remove`, which cannot work on the value itself — it
   * needs the container holding it, and the hop that says which slot to drop.
   */
  readonly stopAt: number;
  readonly terminal: (node: unknown, lastStep: Step) => unknown;
}

const NOT_FOUND = -1;

/** Resolves a possibly-negative index against a length, or `NOT_FOUND`. */
function resolveIndex(index: number, length: number): number {
  const resolved = index < 0 ? length + index : index;
  return resolved >= 0 && resolved < length ? resolved : NOT_FOUND;
}

export function walk(node: unknown, w: Walk, i: number): unknown {
  if (i === w.stopAt) return w.terminal(node, w.steps[i]);

  const step = w.steps[i];

  if (!isContainer(node)) {
    if (__DEV__) {
      warn(
        `${formatPath(w.steps, i)} is ${node === undefined ? "undefined" : JSON.stringify(node)}, ` +
          `so ${formatPath(w.steps)} could not be reached. Nothing was changed.`,
      );
    }
    return node;
  }

  if (__DEV__) {
    const exotic = exoticName(node);
    if (exotic !== undefined) {
      warn(
        `${formatPath(w.steps, i)} is a ${exotic}. Its contents live in internal slots that a ` +
          `copy cannot reach, so paths cannot descend into one — read it out, rebuild it, and ` +
          `\`set\` the result. Nothing was changed.`,
      );
      return node;
    }
  }

  switch (step.kind) {
    case "key": {
      const container = node as Record<string, unknown>;
      // An ABSENT key is not refused here, deliberately. `draft?: boolean` is a
      // legitimate key that TypeScript accepts, and refusing it made
      // `.get("draft").set(true)` a silent no-op while `merge({draft: true})`
      // added the very same field — the API disagreeing with itself, and with
      // its own types.
      //
      // Descending into `undefined` is still caught: the recursion below lands
      // on the `!isContainer` branch, which reports that the path could not be
      // reached and changes nothing. So a typo mid-path is still loud; only the
      // LAST hop, where writing means "create it", now succeeds.
      const previous = container[step.key];
      const next = walk(previous, w, i + 1);
      if (Object.is(previous, next)) return node;

      const copy = shallowClone(container);
      copy[step.key] = next;
      return copy;
    }

    case "index": {
      if (!isArray(node)) {
        if (__DEV__) warn(`${formatPath(w.steps, i)} is not an array, so \`at\` cannot be used.`);
        return node;
      }
      const index = resolveIndex(step.index, node.length);
      if (index === NOT_FOUND) {
        if (__DEV__) {
          warn(
            `${formatPath(w.steps, i)} has ${node.length} element(s), so index ${step.index} is ` +
              `out of range. Nothing was changed.`,
          );
        }
        return node;
      }
      const previous = node[index];
      const next = walk(previous, w, i + 1);
      if (Object.is(previous, next)) return node;

      const copy = node.slice();
      copy[index] = next;
      return copy;
    }

    case "where": {
      if (!isArray(node)) {
        if (__DEV__) warn(`${formatPath(w.steps, i)} is not an array, so \`where\` cannot be used.`);
        return node;
      }
      // The array is copied at most ONCE regardless of how many elements match,
      // and not at all if every match came back identical.
      let copy: unknown[] | undefined;
      let matched = 0;

      for (let k = 0; k < node.length; k++) {
        const item = node[k];
        if (!step.predicate(item, k)) continue;
        matched++;

        const next = walk(item, w, i + 1);
        if (Object.is(item, next)) continue;
        if (copy === undefined) copy = node.slice();
        copy[k] = next;
      }

      if (__DEV__ && matched === 0) {
        warn(`${formatPath(w.steps, i)}.where(…) matched no element. Nothing was changed.`);
      }
      return copy ?? node;
    }
  }
}

/** Builds the walk for every operation that replaces the focused value. */
export function replace(root: unknown, steps: readonly Step[], transform: (value: unknown) => unknown): unknown {
  return walk(root, { steps, stopAt: steps.length, terminal: transform }, 0);
}

/**
 * Builds the walk for `remove`, which stops one hop early.
 *
 * Removal is the one operation that cannot be expressed as "replace the focused
 * value": dropping a key or an element changes the CONTAINER's shape, so the
 * last hop is consumed here instead of being followed.
 */
export function removeAt(root: unknown, steps: readonly Step[]): unknown {
  return walk(
    root,
    {
      steps,
      stopAt: steps.length - 1,
      terminal: (node, lastStep) => removeFrom(node, lastStep, steps),
    },
    0,
  );
}

function removeFrom(node: unknown, step: Step, steps: readonly Step[]): unknown {
  const where = formatPath(steps, steps.length - 1);

  if (!isContainer(node)) {
    if (__DEV__) warn(`${where} is not a container, so there is nothing to remove from.`);
    return node;
  }

  switch (step.kind) {
    case "key": {
      const container = node as Record<string, unknown>;
      if (!(step.key in container)) {
        if (__DEV__) warn(`${where} has no property "${step.key}", so nothing was removed.`);
        return node;
      }
      const copy = shallowClone(container);
      delete copy[step.key];
      return copy;
    }

    case "index": {
      if (!isArray(node)) {
        if (__DEV__) warn(`${where} is not an array, so \`at(…).remove()\` cannot be used.`);
        return node;
      }
      const index = resolveIndex(step.index, node.length);
      if (index === NOT_FOUND) {
        if (__DEV__) {
          warn(`${where} has ${node.length} element(s), so index ${step.index} cannot be removed.`);
        }
        return node;
      }
      return [...node.slice(0, index), ...node.slice(index + 1)];
    }

    case "where": {
      if (!isArray(node)) {
        if (__DEV__) warn(`${where} is not an array, so \`where(…).remove()\` cannot be used.`);
        return node;
      }
      const kept = node.filter((item, k) => !step.predicate(item, k));
      if (kept.length === node.length) {
        if (__DEV__) warn(`${where}.where(…) matched no element, so nothing was removed.`);
        return node;
      }
      return kept;
    }
  }
}

/**
 * Reads without copying anything.
 *
 * Kept separate from `walk` rather than folded into it: reading a path that does
 * not exist is a legitimate question with a legitimate answer (nothing), so this
 * side stays silent where a write would report a miss.
 */
export function collect(root: unknown, steps: readonly Step[]): unknown[] {
  let current: unknown[] = [root];

  for (const step of steps) {
    const next: unknown[] = [];

    for (const node of current) {
      if (!isContainer(node)) continue;

      switch (step.kind) {
        case "key": {
          const container = node as Record<string, unknown>;
          if (step.key in container) next.push(container[step.key]);
          break;
        }
        case "index": {
          if (!isArray(node)) break;
          const index = resolveIndex(step.index, node.length);
          if (index !== NOT_FOUND) next.push(node[index]);
          break;
        }
        case "where": {
          if (!isArray(node)) break;
          for (let k = 0; k < node.length; k++) {
            if (step.predicate(node[k], k)) next.push(node[k]);
          }
          break;
        }
      }
    }

    current = next;
    if (current.length === 0) break;
  }

  return current;
}

/** Resolves an insertion point, where `length` itself is valid (append). */
export function resolveInsertIndex(index: number, length: number): number {
  const resolved = index < 0 ? length + index : index;
  return resolved >= 0 && resolved <= length ? resolved : NOT_FOUND;
}

export { NOT_FOUND };
