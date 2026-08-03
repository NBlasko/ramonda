import { type Path, type PathSegment, pathKey, pathToString } from "./path";
import type { FieldNode, Row } from "./types";

/**
 * What a field needs from the form. Declared as an interface so the tree can be built and
 * tested without a hook, a runtime or a render.
 */
export interface FieldHost {
  read(path: Path): unknown;
  write(path: Path, next: unknown): void;
  errorsAt(path: Path): readonly string[];
  touchedAt(path: Path): boolean;
  dirtyAt(path: Path): boolean;
  touch(path: Path): void;
  resetAt(path: Path): void;
  rowIds(path: Path): readonly string[];
  splice(path: Path, start: number, remove: number, insert: readonly unknown[]): void;
}

/** Marks a node, so a diagnostic or an inspector can tell one from an ordinary object. */
export const IS_FIELD_NODE = Symbol.for("ramonda.form.node");

/**
 * String keys a node answers itself rather than treating as a child.
 *
 * `then` is the one that matters: a proxy that answers every name would answer `then` too,
 * and anything that reaches a promise position — `await node`, `return node` from an async
 * function, `Promise.resolve(node)` — would treat it as a thenable and hang or resolve to
 * the wrong thing, with nothing reported. The rest are here because a debugger, a test
 * runner or `console.log` reaches for them, and materialising a field because something
 * inspected the tree is a bug that only shows up under a debugger.
 */
const NOT_A_CHILD = new Set(["then", "catch", "finally", "constructor", "prototype", "toJSON", "$$typeof"]);

/**
 * The tree, as one identity cache keyed by path.
 *
 * **A node is created once and handed back forever after**, and that is not an
 * optimisation — it is what keeps the framework quiet. A fresh node per access means a
 * fresh `bind.onInput` per access, and RMD020 compares a vnode's attributes key by key
 * (`core/src/debug/renderStability.ts`): a handler whose identity changed is reported, and
 * really is removed and re-added on the element every render. With the cache, `onInput` is
 * one bound method per field for the life of the form.
 *
 * The same cache is what makes a node safe to compare. `list({ each: rows })` puts nodes
 * where RMD020's `valueEqual` will walk them, and two cached nodes for the same path are
 * `Object.is`-equal, so the walk stops before it ever triggers a `get` trap.
 */
export class FieldTree {
  private readonly nodes = new Map<string, object>();
  private readonly handles = new Map<string, FieldHandle>();

  constructor(private readonly host: FieldHost) {}

  /** The root node. Typed by the caller, which is the only place the value type is known. */
  get root(): unknown {
    return this.node([]);
  }

  node(path: Path): unknown {
    const key = pathKey(path);
    const existing = this.nodes.get(key);
    if (existing !== undefined) return existing;

    const created = new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property === "$") return this.handle(path);
          if (property === IS_FIELD_NODE) return true;
          // Every other symbol, and the string names something else reaches for.
          if (typeof property === "symbol" || NOT_A_CHILD.has(property)) return undefined;

          return this.node([...path, segment(property)]);
        },
        has: (_target, property) => property === "$" || property === IS_FIELD_NODE,
        // The target stays empty and this stays empty with it, so nothing enumerating a
        // node — a spread, a diagnostic, a devtools walk — can make it build children.
        ownKeys: () => [],
        set: () => {
          throw new TypeError(
            "[RMF001] A field cannot be assigned to. Use `.$.set(value)`, which records the change where the form can see it.",
          );
        },
      },
    );

    this.nodes.set(key, created);
    return created;
  }

  private handle(path: Path): FieldHandle {
    const key = pathKey(path);
    const existing = this.handles.get(key);
    if (existing !== undefined) return existing;

    const created = new FieldHandle(this.host, this, path);
    this.handles.set(key, created);
    return created;
  }
}

/** An index if the key reads as one, so `contacts[0]` is a number in the path and in the name. */
function segment(property: string): PathSegment {
  const index = Number(property);
  return Number.isInteger(index) && index >= 0 && String(index) === property ? index : property;
}

/**
 * The API behind `$`: one object per path, built once.
 *
 * The reads are getters rather than stored values, so a handle held across renders — which
 * is the point of `const email = form.fields.email.$` — always answers with what the form
 * holds now. The writes are bound in the constructor, so their identity never changes.
 */
export class FieldHandle {
  readonly path: string;
  /** The `name` attribute. The same string as `path`, named for how it reads at a call site. */
  readonly name: string;

  private readonly onInputBound: (event: Event) => void;
  private readonly onBlurBound: (event: Event) => void;

  constructor(
    private readonly host: FieldHost,
    private readonly tree: FieldTree,
    private readonly at_: Path,
  ) {
    this.path = pathToString(at_);
    this.name = this.path;
    this.onInputBound = (event: Event) =>
      this.host.write(this.at_, fromControl(event.target, this.host.read(this.at_)));
    this.onBlurBound = () => this.host.touch(this.at_);
  }

  get value(): unknown {
    return this.host.read(this.at_);
  }

  get error(): string | undefined {
    return this.host.errorsAt(this.at_)[0];
  }

  get errors(): readonly string[] {
    return this.host.errorsAt(this.at_);
  }

  get touched(): boolean {
    return this.host.touchedAt(this.at_);
  }

  get dirty(): boolean {
    return this.host.dirtyAt(this.at_);
  }

  set(next: unknown): void {
    this.host.write(this.at_, next);
  }

  reset(): void {
    this.host.resetAt(this.at_);
  }

  at(key: string): unknown {
    return this.tree.node([...this.at_, key]);
  }

  /**
   * The attributes for this value's kind of control.
   *
   * A fresh object each read, and that is fine: JSX flattens a spread into the vnode's
   * attributes, and RMD020 compares those key by key. `name` is a string, `value` is a
   * string or number, and the two handlers are the same bound methods every time — so
   * nothing in here ever differs between two renders of unchanged state.
   */
  get bind(): Record<string, unknown> {
    const value = this.host.read(this.at_);
    const invalid = this.host.errorsAt(this.at_).length > 0 ? true : undefined;

    const common = {
      name: this.name,
      onInput: this.onInputBound,
      onBlur: this.onBlurBound,
      "aria-invalid": invalid,
    };

    if (typeof value === "boolean") return { ...common, type: "checkbox", checked: value };
    if (typeof value === "number") return { ...common, type: "number", value };
    if (value instanceof Date) return { ...common, type: "date", value: toDateInput(value) };

    return { ...common, value: value === null || value === undefined ? "" : String(value) };
  }

  /* ---- array members. The types keep these off a leaf; these throw if reached anyway. ---- */

  get length(): number {
    return this.list().length;
  }

  /**
   * The rows, each carrying an identity that outlives its index.
   *
   * Rebuilt whenever the list or its ids change and handed back unchanged otherwise, because
   * `list()`'s `each` is what RMD020 compares — a fresh array every render would report, and
   * would cost every row its identity in the reconciler, which is the failure `id` exists to
   * prevent.
   */
  get rows(): readonly Row<unknown>[] {
    const items = this.list();
    const ids = this.host.rowIds(this.at_);

    if (this.rowsCache && this.rowsItems === items && this.rowsIds === ids) return this.rowsCache;

    const rows = items.map((_item, index) => ({
      id: ids[index] as string,
      index,
      field: this.tree.node([...this.at_, index]) as FieldNode<unknown>,
    }));

    this.rowsCache = rows;
    this.rowsItems = items;
    this.rowsIds = ids;
    return rows;
  }

  private rowsCache: readonly Row<unknown>[] | undefined;
  private rowsItems: readonly unknown[] | undefined;
  private rowsIds: readonly string[] | undefined;

  append(item: unknown): void {
    this.host.splice(this.at_, this.list().length, 0, [item]);
  }

  insert(index: number, item: unknown): void {
    this.host.splice(this.at_, index, 0, [item]);
  }

  remove(index: number): void {
    this.host.splice(this.at_, index, 1, []);
  }

  private list(): readonly unknown[] {
    const value = this.host.read(this.at_);
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null) return EMPTY;

    throw new TypeError(
      `[RMF002] \`${this.path || "the root"}\` holds a ${typeof value}, so it has no rows. The list members are for an array field.`,
    );
  }
}

/** One array for "no rows", so a render over an absent list does not build one (RMD020). */
const EMPTY: readonly never[] = [];

/**
 * What the control produced.
 *
 * Read from the element's `type` rather than guessed from the text, because `bind` is what
 * set that `type` in the first place — so the two cannot disagree. A number input hands
 * back a number, and an empty one hands back `""` rather than `NaN`, which is a value a
 * schema can report on ("expected a number") instead of one that quietly poisons arithmetic.
 */
function fromControl(target: EventTarget | null, current: unknown): unknown {
  const element = target as (HTMLInputElement & { type?: string }) | null;
  if (element === null) return current;

  if (element.type === "checkbox") return element.checked;
  if (element.type === "number") return element.value === "" ? "" : Number(element.value);
  if (element.type === "date" && current instanceof Date) {
    const parsed = new Date(element.value);
    return Number.isNaN(parsed.getTime()) ? element.value : parsed;
  }

  return element.value;
}

/** `yyyy-mm-dd`, which is the only thing `<input type="date">` accepts. */
function toDateInput(value: Date): string {
  return Number.isNaN(value.getTime()) ? "" : (value.toISOString().slice(0, 10) as string);
}
