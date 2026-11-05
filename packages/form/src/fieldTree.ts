import { indexUnder, keyPrefix, type Path, type PathSegment, pathKey, pathToString } from "./path";
import type { FieldNode, Row } from "./types";
import { REFUSAL, refuse, report } from "./diagnostics";

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
  move(path: Path, from: number, to: number): void;
  watch(path: Path, watcher: Watcher): FieldHandle;
  unwatch(path: Path, watcher: Watcher): void;
}

/**
 * WHAT changed about a field, as a bitmask.
 *
 * A watcher hears only about the kinds of change it actually reads, and the case that makes it worth
 * having is a list: a component rendering `rows` shows `id`, `index` and `field`, none of which move
 * when the value inside a row does. Without this it woke on every keystroke in every row it contained,
 * and at three hundred rows that was the whole remaining cost of an edit.
 *
 * A number rather than a set of strings, because a wake happens per keystroke and passing a `Set`
 * would allocate one each time; the test is a single `&`.
 */
export const ASPECT = {
  /** A value at, under or over this path moved. */
  value: 1,
  /** A touch or edit mark changed, which is what decides whether a message is SHOWN. */
  marks: 2,
  /** The messages the schema files against this path. */
  messages: 4,
  /** An array changed LENGTH or order — what `rows` and `length` answer, and nothing else. */
  shape: 8,
} as const;

/** Everything at once, for a reset or a submit — a change that reaches the whole form. */
export const EVERY_ASPECT = ASPECT.value | ASPECT.marks | ASPECT.messages | ASPECT.shape;

/**
 * Something that wants to hear about one path.
 *
 * `Field` is the only implementation, and what it does with `bump` is increment a `@state` counter
 * that belongs to the component which used it — so the poke wakes exactly that component.
 */
export interface Watcher {
  bump(aspects: number): void;
}

/** Marks a node, so a diagnostic or an inspector can tell one from an ordinary object. */
export const IS_FIELD_NODE = Symbol.for("ramonda.form.node");

/**
 * What a node answers to `Field`: the form behind it, and where in it this node sits.
 *
 * A node is a proxy over a path and holds neither, so this is the one way across. Not
 * `Symbol.for` — this is internal to the package, and a registered symbol is reachable by name
 * from anywhere, which would make the form's host part of its public surface by accident.
 */
export const FIELD_TARGET = Symbol("ramonda.form.target");

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
 * fresh `oninput` per access, and RMD020 compares a vnode's attributes key by key
 * (`core/src/debug/renderStability.ts`): a handler whose identity changed is reported on every
 * render. With the cache, `oninput` is
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
          // The one way from a node back to the form it belongs to — see `Field`.
          if (property === FIELD_TARGET) return { host: this.host, path };
          // Every other symbol, and the string names something else reaches for.
          if (typeof property === "symbol" || NOT_A_CHILD.has(property)) return undefined;

          return this.node([...path, segment(property)]);
        },
        has: (_target, property) => property === "$" || property === IS_FIELD_NODE,
        // The target stays empty and this stays empty with it, so nothing enumerating a
        // node — a spread, a diagnostic, a devtools walk — can make it build children.
        ownKeys: () => [],
        set: () => {
          throw refuse("RMF001", REFUSAL.RMF001, { path: path.join(".") });
        },
      },
    );

    this.nodes.set(key, created);
    return created;
  }

  /**
   * Drops what an array no longer has: the cached node and handle for every row at or past `from`.
   *
   * A node is created once and kept forever, which is what keeps `oninput` one function per field
   * (see above) — but "forever" was also true of a row that had been removed. Measured on a form grown
   * to 5000 rows of two fields and then shrunk: **15002 nodes and 10001 handles** still held, one per
   * index the array had ever reached, and each handle carries two bound closures and a row cache.
   *
   * Safe to drop exactly because the rows are gone: a caller still holding the node for row 6000 of an
   * array with 3 rows is holding a row that does not exist, and the next one to appear at that index is
   * a different row and should get a different node. Nothing that survives the shrink loses its
   * identity — only indexes past the new length are touched.
   */
  forgetFrom(path: Path, from: number): void {
    const prefix = keyPrefix(path);

    for (const key of this.nodes.keys()) {
      const index = indexUnder(key, prefix);
      if (index !== undefined && index >= from) this.nodes.delete(key);
    }
    for (const key of this.handles.keys()) {
      const index = indexUnder(key, prefix);
      if (index !== undefined && index >= from) this.handles.delete(key);
    }
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

  /**
   * The control's `oninput`: what it produced, written into the form — read by the element's own
   * `type`, see `fromControl`. One bound function for the life of the field, so RMD020 has nothing to
   * report and the element keeps one listener.
   */
  readonly oninput: (event: Event) => void;
  /** The control's `onblur`: the field is touched, which is what decides whether its message shows. */
  readonly onblur: (event: Event) => void;

  constructor(
    private readonly host: FieldHost,
    private readonly tree: FieldTree,
    private readonly at_: Path,
  ) {
    this.path = pathToString(at_);
    this.name = this.path;
    this.oninput = (event: Event) => {
      const current = this.host.read(this.at_);
      if (__DEV__) this.checkTheControl(event.target, current);
      this.host.write(this.at_, fromControl(event.target, current));
    };
    this.onblur = () => this.host.touch(this.at_);
  }

  /**
   * A field edited through a control that hands back another kind: a number or a day through one that
   * hands back text (`type` left off), or text through one that hands back a number. Read on the value
   * the field holds, so a field still empty says nothing; `ramonda-check` reads the markup before any of
   * it runs, as `form-value-in-the-wrong-control`.
   */
  private checkTheControl(target: EventTarget | null, current: unknown): void {
    const type = (target as { type?: string } | null)?.type;
    if (type === undefined) return;
    // True or false, through a control that hands back text: a box is written `checked`, not `value`.
    if (typeof current === "boolean" && type !== "checkbox" && type !== "radio" && !type.startsWith("select")) {
      report(
        "RMF005",
        `\`${this.path}\` holds true or false, and its control (\`type="${type}"\`) hands back text: it belongs in \`<input type="checkbox" checked={…}>\`.`,
        { path: this.path, type, wants: "checkbox" },
      );
      return;
    }
    // Text, through a control that hands back something else: a number, or true or false.
    const notText =
      type === "number" || type === "range" ? "a number" : type === "checkbox" ? "true or false" : undefined;
    if (typeof current === "string" && current !== "" && notText !== undefined) {
      report(
        "RMF005",
        `\`${this.path}\` holds text, and its control (\`type="${type}"\`) hands back ${notText}: it belongs in a control that hands back text.`,
        { path: this.path, type, wants: "text" },
      );
      return;
    }
    const wants = typeof current === "number" ? "number" : current instanceof Date ? "date" : undefined;
    if (wants === undefined || type === wants) return;
    if (wants === "number" && type === "range") return;
    const handsBack =
      type === "checkbox"
        ? "true or false"
        : type === "number" || type === "range"
          ? "a number"
          : type === "date"
            ? "a day"
            : "text";
    // A select hands back the chosen option's `value`, and a radio its own `value`, and no `type` changes
    // that: a choice of numbers is a number once the schema takes it as one.
    const fix =
      type.startsWith("select") || type === "radio"
        ? `a choice of ${wants === "number" ? "numbers" : "days"} is taken as one by the schema — \`z.coerce.${wants === "number" ? "number" : "date"}()\` in Zod`
        : `it belongs in \`<input type="${wants}">\``;
    report(
      "RMF005",
      `\`${this.path}\` holds a ${wants === "number" ? "number" : "day"}, and its control (\`type="${type}"\`) hands back ${handsBack}: ${fix}.`,
      { path: this.path, type, wants },
    );
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
   * The value as the control shows it, for its `value` attribute: a date as `yyyy-mm-dd`, a number as
   * itself, and anything absent as `""` — so `value={field.inputValue}` is the same line for every
   * kind of text, number and date field. A checkbox takes `checked={field.value === true}`.
   */
  get inputValue(): string | number {
    const value = this.host.read(this.at_);
    if (value instanceof Date) return toDateInput(value);
    if (typeof value === "number") return value;
    return value === null || value === undefined ? "" : String(value);
  }

  /**
   * `true` while the field has a message, and no value otherwise: the control's `aria-invalid`. A valid
   * field carries no `aria-invalid` at all, as one written before any form library did — `false` would
   * be written as `aria-invalid="false"`, which a stylesheet reads as a verdict on a field not yet used.
   */
  get invalid(): true | undefined {
    return this.host.errorsAt(this.at_).length > 0 ? true : undefined;
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

    if (this.rowsCache !== undefined && this.rowsItems === items && sameIds(this.rowsIds, ids)) return this.rowsCache;

    const rows = items.map((_item, index) => {
      const id = ids[index] as string;
      const kept = this.rowById.get(id);
      // **One row object per row, for as long as the row is where it was.** `list({ as })` hands this
      // object to a component as its `item` prop, so a fresh one is a changed prop — and a fresh one
      // for every row is what made an edit in row 1 re-render all fifty. Nothing in it has changed
      // for the others: the id is theirs, the index is the same, and the field node is one cached
      // object per path already.
      //
      // A row whose INDEX moved does get a new object, and should: it is showing a different
      // position, and `list()`'s `render(item, index)` contract says so too.
      if (kept !== undefined && kept.index === index) return kept;

      const built: Row<unknown> = {
        id,
        index,
        field: this.tree.node([...this.at_, index]) as FieldNode<unknown>,
      };
      this.rowById.set(id, built);
      return built;
    });

    // Rows that are gone stop being remembered, or the map grows for the life of the form.
    if (this.rowById.size > rows.length) {
      const alive = new Set(rows.map((row) => row.id));
      for (const id of [...this.rowById.keys()]) {
        if (!alive.has(id)) this.rowById.delete(id);
      }
    }

    this.rowsCache = rows;
    this.rowsItems = items;
    // COPIED, because `rowIds` hands back the array it keeps and tops up in place — so holding the
    // reference would compare a list against itself and the cache would never notice a new row.
    this.rowsIds = [...ids];
    return rows;
  }

  private rowsCache: readonly Row<unknown>[] | undefined;
  private rowsItems: readonly unknown[] | undefined;
  private rowsIds: readonly string[] | undefined;
  private readonly rowById = new Map<string, Row<unknown>>();

  append(item: unknown): void {
    this.host.splice(this.at_, this.list().length, 0, [item]);
  }

  insert(index: number, item: unknown): void {
    this.host.splice(this.at_, index, 0, [item]);
  }

  remove(index: number): void {
    this.host.splice(this.at_, index, 1, []);
  }

  /**
   * Reorders a row, carrying its identity with it.
   *
   * Not `remove` then `insert`: that mints a NEW id for the row, so the reconciler treats it as a
   * different row, throws its element away and builds another — losing the caret, the selection and
   * anything else the browser was holding. Moving the value and the id in one operation is the whole
   * reason this is a method rather than something each app writes.
   */
  move(from: number, to: number): void {
    this.host.move(this.at_, from, to);
  }

  private list(): readonly unknown[] {
    const value = this.host.read(this.at_);
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null) return EMPTY;

    throw refuse("RMF002", REFUSAL.RMF002(this.path, typeof value), { path: this.path, held: typeof value });
  }
}

/** One array for "no rows", so a render over an absent list does not build one (RMD020). */
const EMPTY: readonly never[] = [];

/** Whether two id lists are the same, by content — see why `rows` copies them. */
function sameIds(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (a === undefined || a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

/**
 * What the control produced.
 *
 * Read from the element's own `type`: the control decides, as an empty field could be waiting for a
 * number or text alike. A number input and a slider hand back a number, and an emptied number input
 * `""` rather than `NaN`, which is a value a schema can report on ("expected a number") instead of one
 * that quietly poisons arithmetic. Any other control hands back its text. Which control a field may sit
 * in is `ramonda-check`'s to say, from the field's type: `form-value-in-the-wrong-control`.
 *
 * A date input serves two kinds of field — a `Date`, and a date written as text (`"2026-10-29"`, a JSON
 * Schema `format: "date"`) — and the value the field holds tells them apart: text, `""` included, is a
 * date written as text, and gets the control's text back; a `Date` or nothing gets a day, at local
 * midnight for a field that held none. So a `Date` field emptied holds nothing — `undefined`, whatever
 * the schema calls nothing, which a schema that takes no date accepts (`z.date().nullish()`) — rather
 * than `""`, and a date written as text starts at `""`, which is what keeps the two apart while either
 * is empty.
 */
function fromControl(target: EventTarget | null, current: unknown): unknown {
  const element = target as (HTMLInputElement & { type?: string }) | null;
  if (element === null) return current;

  if (element.type === "checkbox") return element.checked;
  if (element.type === "number") return element.value === "" ? "" : Number(element.value);
  // A slider has no empty position, so it never hands back `""`.
  if (element.type === "range") return Number(element.value);
  if (element.type === "date") {
    if (typeof current === "string") return element.value;
    // The time of day a held date carries is kept; a field that held none starts the day at midnight.
    // Emptied, or half-typed, it holds nothing.
    return fromDateInput(element.value, current instanceof Date ? current : new Date(Number.NaN));
  }

  return element.value;
}

/**
 * `yyyy-mm-dd` for the day the READER is in, which is not always the day UTC is in.
 *
 * `toISOString().slice(0, 10)` is the obvious way to write this and it is wrong for most of the
 * world: 01:00 on the 7th in Belgrade is 23:00 on the 6th in UTC, so the control showed the 6th and
 * picking that same shown day wrote the 6th back — the reader's date moved by being looked at, and
 * the wrong day was submitted. `<input type="date">` has no timezone; it shows a calendar day, and
 * the calendar day a local `Date` means is its local one.
 */
function toDateInput(value: Date): string {
  // A day before year 1 is none a date input shows: `00-5-01-01` would be no day to it either.
  if (Number.isNaN(value.getTime()) || value.getFullYear() < 1) return "";

  const pad = (part: number, width = 2) => String(part).padStart(width, "0");
  // The year in four digits, as a date input reads it: `2-05-10` is not a day to it, and it would empty
  // the field while the reader types the year through `0002`.
  return `${pad(value.getFullYear(), 4)}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/**
 * The day the reader picked, as a local `Date`, keeping the time the value already held.
 *
 * `new Date("2026-08-07")` parses as UTC midnight — the same drift as above, in reverse. Built from
 * the parts instead, which is unambiguously local.
 *
 * **The time comes across.** A date input cannot express one, so a value that carried 09:15 would
 * silently move to midnight, and an appointment would lose its hour to a change of day. `setFullYear`
 * takes all three parts at once, so there is no intermediate date to overflow through.
 *
 * `undefined` for anything that is not a day — an empty control, or a half-typed one — which the field
 * then holds: nothing, which a required `Date` reports on.
 */
function fromDateInput(text: string, current: Date): Date | undefined {
  // Four digits of year to six, as a date input takes them and a `Date` holds them (to 275760).
  const parts = /^(\d{4,6})-(\d{2})-(\d{2})$/.exec(text);
  if (parts === null) return undefined;

  const [year, month, day] = [Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])];
  // An invalid held value has no time worth carrying, so the picked day starts at local midnight — set
  // with `setFullYear`, as `new Date(2, …)` reads a year below 100 as 1902: the year a reader types one
  // digit at a time passes through `0002`.
  if (Number.isNaN(current.getTime())) {
    const midnight = new Date(0);
    midnight.setFullYear(year, month, day);
    midnight.setHours(0, 0, 0, 0);
    // A year past what a `Date` holds (275760) is no day.
    return Number.isNaN(midnight.getTime()) ? undefined : midnight;
  }

  const next = new Date(current.getTime());
  next.setFullYear(year, month, day);
  return Number.isNaN(next.getTime()) ? undefined : next;
}
