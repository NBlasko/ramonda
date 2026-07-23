import { NOT_FOUND, collect, removeAt, replace, resolveInsertIndex } from "./apply";
import { isArray, isContainer, shallowClone } from "./clone";
import { NO_STEPS, type Predicate, type Step, formatPath } from "./steps";
import type { Focus } from "./types";
import { warn } from "./warn";

/**
 * Shared by every chain grown from one `focusOn` call, and by nothing else.
 *
 * Not module-level: a per-call object means two concurrent renders, or two
 * independent updates, can never see each other's flag. It exists only in DEV —
 * see `beginWrite` for what it catches.
 */
interface Origin {
  spent: boolean;
}

/**
 * A path being built. Every hop returns a NEW instance, so nothing here is ever
 * mutated and a prefix can safely be shared:
 *
 * ```ts
 * const posts = focusOn(state).get("posts");
 * const drafts = posts.where((p) => p.draft).values();  // fine
 * const one = posts.where((p) => p.id === 1).value();   // also fine
 * ```
 *
 * What is NOT safe is reusing a prefix for a SECOND write — see `beginWrite`.
 */
class Chain {
  constructor(
    private readonly root: unknown,
    private readonly steps: readonly Step[],
    private readonly origin: Origin | undefined,
  ) {}

  private hop(step: Step): Chain {
    return new Chain(this.root, [...this.steps, step], this.origin);
  }

  get(key: string | number): Chain {
    return this.hop({ kind: "key", key: String(key) });
  }

  at(index: number): Chain {
    return this.hop({ kind: "index", index });
  }

  where(predicate: Predicate): Chain {
    return this.hop({ kind: "where", predicate });
  }

  /**
   * Refuses a second write through the same `focusOn(…)` call.
   *
   * The chain itself is immutable, so reuse LOOKS harmless — and that is the
   * problem. `focusOn(root)` captures `root` once, so a second write is computed
   * from the ORIGINAL value and silently discards the first edit. The result is
   * a plausible-looking object missing one change, which is far harder to find
   * than a throw.
   *
   * Reads never mark or check the flag: `values()` twice off one prefix is a
   * normal thing to want, and it cannot lose anything.
   *
   * DEV only. In production the check is compiled out and the semantics are what
   * the code literally says — each write derived from the captured root.
   */
  private beginWrite(): void {
    if (!__DEV__) return;
    const origin = this.origin;
    if (origin === undefined) return;

    if (origin.spent) {
      throw new Error(
        "[Ramonda lens] This chain has already been written through. `focusOn(root)` captures " +
          "`root` once, so this second write would be computed from the ORIGINAL value and would " +
          "silently drop the first edit. Feed the result back in instead:\n" +
          "  const next = focusOn(state).get('a').set(1);\n" +
          "  const after = focusOn(next).get('b').set(2);",
      );
    }
    origin.spent = true;
  }

  set(value: unknown): unknown {
    this.beginWrite();
    return replace(this.root, this.steps, () => value);
  }

  update(updater: (value: unknown) => unknown): unknown {
    this.beginWrite();
    return replace(this.root, this.steps, updater);
  }

  merge(partial: object): unknown {
    this.beginWrite();
    return replace(this.root, this.steps, (node) => {
      if (!isContainer(node)) {
        if (__DEV__) {
          warn(`${formatPath(this.steps)} is not an object, so \`merge\` did nothing.`);
        }
        return node;
      }

      // An assignment that changes no value must not mint a new object — the
      // identity guarantee has to hold for `merge` exactly as it does for `set`,
      // or a merge of unchanged fields would invalidate the whole path above it.
      const entries = Object.entries(partial);
      const current = node as Record<string, unknown>;
      if (entries.every(([key, value]) => key in current && Object.is(current[key], value))) {
        return node;
      }

      const copy = shallowClone(current);
      for (const [key, value] of entries) copy[key] = value;
      return copy;
    });
  }

  push(...items: unknown[]): unknown {
    this.beginWrite();
    return replace(this.root, this.steps, (node) => {
      if (!isArray(node)) {
        if (__DEV__) warn(`${formatPath(this.steps)} is not an array, so \`push\` did nothing.`);
        return node;
      }
      if (items.length === 0) return node;
      return [...node, ...items];
    });
  }

  insert(index: number, ...items: unknown[]): unknown {
    this.beginWrite();
    return replace(this.root, this.steps, (node) => {
      if (!isArray(node)) {
        if (__DEV__) warn(`${formatPath(this.steps)} is not an array, so \`insert\` did nothing.`);
        return node;
      }
      if (items.length === 0) return node;

      const at = resolveInsertIndex(index, node.length);
      if (at === NOT_FOUND) {
        if (__DEV__) {
          warn(
            `${formatPath(this.steps)} has ${node.length} element(s), so ${index} is not a valid ` +
              `insertion point. Nothing was inserted.`,
          );
        }
        return node;
      }
      return [...node.slice(0, at), ...items, ...node.slice(at)];
    });
  }

  and(...branches: Array<(focus: unknown) => unknown>): unknown {
    this.beginWrite();
    if (branches.length === 0) return this.root;

    return replace(this.root, this.steps, (node) => {
      // Sequential, not parallel: a branch sees what the one before it produced.
      // Applying all of them to the ORIGINAL node and combining afterwards would
      // mean the last branch silently discards the others whenever two touch the
      // same value — a wrong result with nothing to notice it by.
      let value = node;

      for (const branch of branches) {
        // A fresh chain per branch, rooted at the forked value. That is what
        // makes a branch's terminal operation return the new value of THIS node
        // rather than of the whole tree, and it gives each branch its own
        // single-write budget.
        const next = branch(focusOn(value));

        if (__DEV__ && next === undefined && value !== undefined) {
          warn(
            `${formatPath(this.steps)}.and(…) — a branch returned undefined, so it was skipped. ` +
              `A branch has to RETURN its terminal operation: ` +
              `\`(post) => post.get("title").set("x")\`, not ` +
              `\`(post) => { post.get("title").set("x") }\` — what it returns is what replaces ` +
              `the focused value.`,
          );
          continue;
        }

        value = next;
      }

      return value;
    });
  }

  remove(): unknown {
    this.beginWrite();

    if (this.steps.length === 0) {
      if (__DEV__) {
        throw new Error(
          "[Ramonda lens] `focusOn(root).remove()` has nothing to remove from — the root has no " +
            "container. Focus the property or element you meant to drop first.",
        );
      }
      return this.root;
    }

    return removeAt(this.root, this.steps);
  }

  value(): unknown {
    const found = collect(this.root, this.steps);
    return found.length === 0 ? undefined : found[0];
  }

  values(): unknown[] {
    return collect(this.root, this.steps);
  }
}

/**
 * Starts a path into `root`.
 *
 * Nothing is read, copied or proxied until a terminal operation runs. The chain
 * only records where to go, which is what lets one walk service the whole path
 * and copy each level at most once.
 *
 * ```ts
 * const next = focusOn(state)
 *   .get("posts")
 *   .where((post) => post.id === 102)
 *   .get("tags")
 *   .where((tag) => tag === "draft")
 *   .set("published");
 * ```
 *
 * Everything off that path — `state.users`, `state.posts[0]`, the other tags —
 * comes out of it as the very same object it went in as.
 */
export function focusOn<T>(root: T): Focus<T, T> {
  const origin: Origin | undefined = __DEV__ ? { spent: false } : undefined;

  // The one bridge between the untyped walk and the typed surface. `Chain`
  // implements every method the public type names; the type parameters exist to
  // describe the path to the caller, and carry no runtime meaning at all.
  return new Chain(root, NO_STEPS, origin) as unknown as Focus<T, T>;
}
