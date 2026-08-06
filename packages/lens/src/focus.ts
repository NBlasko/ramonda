import { NOT_FOUND, collect, removeAt, replace, resolveInsertIndex } from "./apply";
import { isArray, isContainer, isUnsafeKey, shallowClone } from "./clone";
import { fatal, report } from "./diagnostics";
import { NO_STEPS, type Predicate, type Step, formatPath } from "./steps";
import type { Focus } from "./types";

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
      throw fatal("RML010", `${formatPath(this.steps)} — this chain has already been written through.`, {
        path: formatPath(this.steps),
      });
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

  /**
   * The entries of a `merge` that are allowed to be written.
   *
   * `merge(JSON.parse(body))` is the realistic way an unsafe key gets here: an
   * object literal cannot even carry an own `__proto__`, but a parsed one can,
   * and the assignment below would replace the copy's prototype rather than set
   * a property. See `isUnsafeKey`.
   */
  private safeEntries(partial: object): Array<[string, unknown]> {
    const entries = Object.entries(partial);
    if (!entries.some(([key]) => isUnsafeKey(key))) return entries;

    return entries.filter(([key]) => {
      if (!isUnsafeKey(key)) return true;
      if (__DEV__) {
        const path = formatPath(this.steps);
        report("RML009", `${path} — \`merge\` skipped "${key}".`, { path, key, operation: "merge" });
      }
      return false;
    });
  }

  merge(partial: object): unknown {
    this.beginWrite();
    return replace(this.root, this.steps, (node) => {
      // A missing object is NOT created here, which is the one place this API
      // refuses what `set` and `push` allow — see `writableArray`. `partial` is a
      // `Partial`, so creating from it would mint a half-built object typed as a
      // whole one, and the type error would surface wherever it was next read.
      if (!isContainer(node)) {
        if (__DEV__) {
          const path = formatPath(this.steps);
          report("RML006", `${path} is not an object, so \`merge\` did nothing.`, { path, operation: "merge" });
        }
        return node;
      }

      // An assignment that changes no value must not mint a new object — the
      // identity guarantee has to hold for `merge` exactly as it does for `set`,
      // or a merge of unchanged fields would invalidate the whole path above it.
      const entries = this.safeEntries(partial);
      const current = node as Record<string, unknown>;
      if (entries.every(([key, value]) => key in current && Object.is(current[key], value))) {
        return node;
      }

      const copy = shallowClone(current);
      for (const [key, value] of entries) copy[key] = value;
      return copy;
    });
  }

  /**
   * The array `push` and `insert` are about to write into, or `undefined` when
   * there is nothing writable there.
   *
   * A MISSING array counts as an empty one, and for exactly the reason `set`
   * creates a missing key: `tags?: string[]` is a type TypeScript accepts and it
   * offers `push` on it, so refusing at runtime made the API disagree with its
   * own types — `.get("tags").set(["a"])` created the array while
   * `.get("tags").push("a")` warned and did nothing. Both spellings now land.
   *
   * `null` counts too; it is the other way a type spells "no array yet". A value
   * that IS there and is not an array is a genuine mistake, so that one is still
   * reported and still changes nothing.
   *
   * `merge` deliberately does NOT create, and the line between them is what the
   * operation can supply: `push` hands over a complete `E[]`, while `merge` has
   * only a `Partial`, so creating from one would produce a half-built object
   * typed as a whole one.
   */
  private writableArray(node: unknown, operation: string): unknown[] | undefined {
    if (isArray(node)) return node;
    if (node === undefined || node === null) return [];

    if (__DEV__) {
      const path = formatPath(this.steps);
      report("RML006", `${path} is not an array, so \`${operation}\` did nothing.`, { path, operation });
    }
    return undefined;
  }

  push(...items: unknown[]): unknown {
    this.beginWrite();
    return replace(this.root, this.steps, (node) => {
      // Before the create, so pushing nothing onto a missing array stays a
      // no-op rather than minting an empty one.
      if (items.length === 0) return node;

      const array = this.writableArray(node, "push");
      if (array === undefined) return node;
      return [...array, ...items];
    });
  }

  insert(index: number, ...items: unknown[]): unknown {
    this.beginWrite();
    return replace(this.root, this.steps, (node) => {
      if (items.length === 0) return node;

      const array = this.writableArray(node, "insert");
      if (array === undefined) return node;

      const at = resolveInsertIndex(index, array.length);
      if (at === NOT_FOUND) {
        if (__DEV__) {
          const path = formatPath(this.steps);
          report(
            "RML004",
            `${path} has ${array.length} element(s), so ${index} is not a valid insertion point. ` +
              `Nothing was inserted.`,
            { path, operation: "insert", index, length: array.length },
          );
        }
        return node;
      }
      return [...array.slice(0, at), ...items, ...array.slice(at)];
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
          const path = formatPath(this.steps);
          report("RML008", `${path}.and(…) — a branch returned undefined, so it was skipped.`, {
            path,
            branch: branches.indexOf(branch),
          });
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
        throw fatal("RML011", "`focusOn(root).remove()` has nothing to remove from.", { path: "(root)" });
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
