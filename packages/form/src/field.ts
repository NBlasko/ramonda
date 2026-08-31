import { created, destroyed, Hook, INSPECT, state, watchProp } from "@ramonda/core";

import { ASPECT, FIELD_TARGET, type FieldHandle, type Watcher } from "./fieldTree";
import type { Path } from "./path";
import type { Bind, FieldApi, FieldNode, Row } from "./types";

/** What a component hands to `Field`: any field node, whatever kind it is. Every one has a `$`. */
export interface FieldTarget<T> {
  readonly $: FieldApi<T>;
}

/**
 * The element type of an array field, `never` for anything else.
 *
 * What it buys is the row: `Field<Contact[]>` answers `rows` as `Row<Contact>[]`, so
 * `list(f.rows, Line)` type-checks against a component taking `Row<Contact>` — with
 * `Row<unknown>` it did not, and every call site needed a cast. And `append` takes a `Contact` rather
 * than anything at all. For a leaf field it collapses to `never`, which makes the array members
 * unusable there, which is correct.
 */
type ElementOf<T> = NonNullable<T> extends readonly (infer E)[] ? E : never;

/** The two methods a `Field` needs from the form. Declared here so nothing imports `Form`. */
interface Watchable {
  watch(path: Path, watcher: Watcher): FieldHandle;
  unwatch(path: Path, watcher: Watcher): void;
}

/**
 * One field, watched by the component that asks for it.
 *
 * ```tsx
 * class TextInput extends Component<{ of: FieldNode<string>; label: string }> {
 *   private f = this.use(Field<string>, () => ({ of: this.props.of }));
 *
 *   render(): RamondaNode {
 *     return (
 *       <label className={this.f.error ? "field invalid" : "field"}>
 *         {this.props.label}
 *         <input {...this.f.bind} />
 *         {this.f.error}
 *       </label>
 *     );
 *   }
 * }
 *
 * // one prop at the call site, typed by the schema
 * <TextInput of={form.fields.email} label="E-mail" />
 * ```
 *
 * ## Why this exists, which is not what it looks like
 *
 * It looks like an optimisation. It is a CORRECTNESS fix: a component handed a field and reading it
 * directly never re-renders at all, and nothing says so.
 *
 * - A hook's `@state` belongs to the component that used the hook, so the form's counter wakes the
 *   form's owner and nobody else. A child reading through the field tree is subscribed to nothing.
 * - And the child's props never change: a field node is ONE cached object for the life of the form,
 *   deliberately — a fresh one per access means a fresh `bind.oninput` per access, which RMD020
 *   reports and which really does re-attach the listener on every render. So the props diff has
 *   nothing to notice, and the child is skipped entirely.
 *
 * Measured: put a field in its own component, submit an invalid form, and the child shows no message
 * while the form holds `"required"`; write to the field and the input keeps the old value. The same
 * field read inline in the owner shows both. So a styled input, a shared field component and a row of
 * a list all need this hook — not for speed, but to work.
 *
 * ## And it is what makes a change surgical
 *
 * The subscription is per path, so a keystroke wakes the fields that changed and no others. Measured
 * over 300 rows through `list()`, one keystroke: every row rebuilt, 45 ms of it, because every row
 * read the form's one counter through the field tree and so depended on every change anywhere in the
 * form. The granularity was always in the list engine — one tracker per item — and one shared counter
 * flattened it.
 *
 * ## What it hears about
 *
 * Its own path, its ancestors and its descendants: an aggregate above it moves when a leaf below
 * does, and a leaf moves when a whole record lands above it. Messages wake only the fields whose
 * messages changed — so a cross-field rule stays correct, because the schema still re-answers the
 * whole form, without the whole form re-rendering.
 *
 * `isValid`, `isSubmitting` and `submitCount` belong to the form rather than to a field and are not
 * read here. A component that needs one of those reads the form.
 *
 * ## Naming `T`
 *
 * `FieldNode<T>` is a conditional type, so `T` cannot be recovered from it by inference — write
 * `Field<string>` at the `use`, the same instantiation-expression pin `Query<Todo>` and
 * `Form<typeof schema>` take.
 */
export class Field<T> extends Hook<{ of: FieldTarget<T> }> implements Watcher {
  /**
   * The subscription, and the whole mechanism in one line.
   *
   * `@state` on a hook belongs to the component that used it, so incrementing this wakes exactly that
   * component. `State` is internal to `@ramonda/core` on purpose — apps reach reactivity through
   * `@state`, `@compute` and context — so this package holds no signals: the form holds the list of
   * who to poke, and each watcher's own state does the waking.
   */
  @state private version = 0;

  /**
   * The handle to read through, from the form's QUIET tree.
   *
   * Not `props.of.$`, and that is the point: the handle behind a node reached through `form.fields`
   * subscribes its reader to the whole form on the first read, which would undo everything above.
   * Same class, same `bind`, same stable handler identities — a different host.
   */
  private handle: FieldHandle | undefined;
  private form: Watchable | undefined;
  private watched: Path | undefined;

  @created
  attach(): void {
    this.subscribe(this.props.of);
  }

  @destroyed
  detach(): void {
    this.unsubscribe();
  }

  /**
   * Re-targets when the node changes, which is what a row that moves does.
   *
   * `<Row of={form.fields.rows[i].v} />` hands over a different node once the row's index changes, so
   * a hook holding the first one would go on reporting the value at the old position. `@watchProp`
   * runs before the render, so the new subscription is in place for the pass that needs it.
   */
  @watchProp((props) => props.of)
  onTargetChanged([next]: [FieldTarget<T>]): void {
    this.unsubscribe();
    this.subscribe(next);
    // What is on screen belongs to a different path now.
    this.version++;
  }

  /**
   * What this component has actually READ, as a bitmask of aspects — see `ASPECT`.
   *
   * Filled in by the getters below and **never cleared**, which is what makes it sound. Reading a
   * member for the first time needs a render, and that render came from something already subscribed
   * or from the component's own state — so a member that is not in here cannot be affecting what is on
   * screen. `{f.touched && f.error}` is the case worth walking through: while `touched` is false,
   * `error` is never read and a message landing wakes nobody, which is right, because the output would
   * be the same. The blur that flips `touched` is a `marks` change, it wakes this, the render reads
   * `error`, and from then on messages wake it too.
   *
   * Clearing it per render would be more precise and would also be a bug: reads happen DURING the
   * render, and the subscription has to be in place before the next change, not after it.
   */
  private reads = 0;

  /**
   * Called by the form when something changed. Ignored unless this component reads that kind of thing.
   *
   * The case it exists for is a list: a component rendering `rows` shows `id`, `index` and `field`, and
   * none of them move when a value inside a row does. Without this it woke on every keystroke in every
   * row it held.
   */
  bump(aspects: number): void {
    if ((aspects & this.reads) === 0) return;
    this.version++;
  }

  private subscribe(node: FieldTarget<T>): void {
    const asked = node as unknown as Record<symbol, unknown>;
    const target = asked[FIELD_TARGET] as { host: Watchable; path: Path } | undefined;

    if (target === undefined) {
      // Only reachable from JavaScript, by passing something that is not a field node — the type
      // refuses it. Nothing is watched, and reads fall through to whatever was handed over, so such a
      // caller gets the behaviour they would have had without this hook rather than a crash.
      this.handle = node.$ as unknown as FieldHandle;
      return;
    }

    this.form = target.host;
    this.watched = target.path;
    this.handle = target.host.watch(target.path, this);
  }

  private unsubscribe(): void {
    if (this.form !== undefined && this.watched !== undefined) this.form.unwatch(this.watched, this);
    this.form = undefined;
    this.watched = undefined;
  }

  /**
   * The handle, plus the read that puts this component's subscription in place.
   *
   * Subscribes here too, not only from `@created`, so a component reading its field in a FIELD
   * INITIALIZER — which runs before the lifecycle queue — gets an answer rather than a crash about
   * something being undefined. Asking twice for one node costs nothing: the form's set holds this hook
   * once.
   */
  private get live(): FieldHandle {
    void this.version;
    if (this.handle === undefined) this.subscribe(this.props.of);
    return this.handle as FieldHandle;
  }

  /**
   * What the panel shows, so a watched field is not an anonymous counter.
   *
   * Read off `handle` rather than through `live`, because describing an instance must not change what
   * it does — and `live` is the read that subscribes.
   */
  [INSPECT](): Record<string, unknown> {
    return {
      field: this.handle?.name ?? "(not attached)",
      value: this.handle?.value,
      error: this.handle?.error,
      touched: this.handle?.touched,
      dirty: this.handle?.dirty,
    };
  }

  /* ---------------------------------------------------------------- *
   * The API a node's `$` answers, so a component written against
   * `FieldApi<T>` has no second shape to learn.
   * ---------------------------------------------------------------- */

  get value(): T {
    this.reads |= ASPECT.value;
    return this.live.value as T;
  }

  /**
   * `marks` as well as `messages`, because a message is HELD BACK until the field has been touched or
   * edited — see `errorsAt`. A blur changes what this answers without any message having moved.
   */
  get error(): string | undefined {
    this.reads |= ASPECT.messages | ASPECT.marks;
    return this.live.error;
  }

  get errors(): readonly string[] {
    this.reads |= ASPECT.messages | ASPECT.marks;
    return this.live.errors;
  }

  get touched(): boolean {
    this.reads |= ASPECT.marks;
    return this.live.touched;
  }

  get dirty(): boolean {
    this.reads |= ASPECT.value;
    return this.live.dirty;
  }

  /** The path as the schema sees it, e.g. `contacts[2].value`. */
  get path(): string {
    return this.live.path;
  }

  /** The `name` attribute, which is `path`. */
  get name(): string {
    return this.live.name;
  }

  /** The value and the messages both: `bind` carries `value` and `aria-invalid`. */
  get bind(): Bind<T> {
    this.reads |= ASPECT.value | ASPECT.messages | ASPECT.marks;
    return this.live.bind as unknown as Bind<T>;
  }

  set(next: T): void {
    this.live.set(next);
  }

  reset(): void {
    this.live.reset();
  }

  /* ---- array members, for a field holding a list ---- */

  /**
   * `shape` only, and this is the whole point of aspects.
   *
   * How many rows there are changes when one is added or removed, and not when a value inside one
   * moves — so a component rendering a list sleeps through a keystroke in any of its rows. Each row
   * watches its own field and wakes on its own.
   */
  get length(): number {
    this.reads |= ASPECT.shape;
    return this.live.length;
  }

  /** `shape` only, for the reason `length` gives: a row's `id`, `index` and `field` do not move. */
  get rows(): readonly Row<ElementOf<T>>[] {
    this.reads |= ASPECT.shape;
    return this.live.rows as readonly Row<ElementOf<T>>[];
  }

  append(item: ElementOf<T>): void {
    this.live.append(item);
  }

  insert(index: number, item: ElementOf<T>): void {
    this.live.insert(index, item);
  }

  remove(index: number): void {
    this.live.remove(index);
  }

  move(from: number, to: number): void {
    this.live.move(from, to);
  }

  /**
   * A child node, for reaching further in from a component watching an object or a row.
   *
   * Typed the same way `FieldApi.at` is, so a component watching a row can hand its own children on:
   * `<TextField of={this.f.at("value")} />`.
   */
  at<K extends keyof NonNullable<T> & string>(key: K): FieldNode<NonNullable<T>[K]> {
    return this.live.at(key) as FieldNode<NonNullable<T>[K]>;
  }
}
