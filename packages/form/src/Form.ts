import { create, destroy, Hook, type RenderEnv, state } from "@ramonda/core";
import { type FieldHost, FieldTree } from "./fieldTree";
import { keyPrefix, type Path, parsePath, pathKey, readAt, ROOT, writeAt } from "./path";
import type { FieldNode, FormProps, InferIn, InferOut, StandardSchemaV1, ValidateOn } from "./types";
import { type Issues, NO_ISSUES, validate, withIssue } from "./validate";

const NO_MESSAGES: readonly string[] = [];

/**
 * A form: the values, the errors, and the fields as a typed tree.
 *
 * ```tsx
 * class Signup extends Component {
 *   private form = this.use(Form, {
 *     schema: signupSchema,
 *     defaultValues: { email: "", password: "" },
 *     onSubmit: this.save,
 *   });
 *
 *   save(values: SignupValues) {
 *     return api.signup(values);
 *   }
 *
 *   render() {
 *     const email = this.form.fields.email.$;
 *     return (
 *       <form onSubmit={this.form.submit}>
 *         <input {...email.bind} />
 *         {email.error && <span>{email.error}</span>}
 *         <button disabled={this.form.isSubmitting}>Sign up</button>
 *       </form>
 *     );
 *   }
 * }
 * ```
 *
 * ## Naming the schema type
 *
 * Nothing has to be written at the call site when `onSubmit` is a bound method, when its
 * parameter is annotated, or when it takes none: `S` follows from the `schema` prop. Only
 * an INLINE handler with an UNANNOTATED parameter needs the pin —
 * `this.use(Form<typeof signupSchema>, …)` — because the props type is inferred from the
 * literal, so a context-sensitive property in that same literal has no target to be typed
 * against. It is exactly the rule `Query` documents.
 *
 * ## What re-renders
 *
 * One `@state` counter, bumped on every change, so a keystroke re-renders the component
 * that owns the form. That is the framework's model — a hook's state belongs to its owner —
 * and it is what `Mutation` does with its own `version`. A form big enough for that to
 * matter is split the way any other page is: a fieldset in its own component re-renders
 * alone.
 *
 * ## Why the values are not `@state`
 *
 * `@state` means "serialize me into the hydration blob", and form values are whatever the
 * schema's input side is — a `Date`, a `File`, a class instance — so declaring them would
 * put a warning in front of anyone whose form holds one. They are a plain field, read
 * during the render the counter scheduled, exactly as `Mutation` holds `lastData`.
 */
export class Form<S extends StandardSchemaV1> extends Hook<FormProps<S>> implements FieldHost {
  /**
   * Bumped on every change, and read first by every getter below.
   *
   * A counter rather than the values themselves: two edits can leave a form in an equal
   * state, and a signal that compares equal wakes nothing while what is on screen has moved
   * on. The same trap `Mutation.version` documents.
   */
  @state private version = 0;

  private held: InferIn<S> | undefined;
  private issues: Issues = NO_ISSUES;
  /** Blurred. The standard meaning, and NOT the same question as "has been edited". */
  private touchedKeys = new Set<string>();
  /**
   * Edited by the user, which is the other half of "has this field been interacted with".
   *
   * Kept as a set rather than derived by comparing against the defaults, because `errorsAt`
   * asks this on every field read and a comparison would walk the subtree each time.
   */
  private changedKeys = new Set<string>();
  /** Ids per array field, spliced alongside the data. See `rowIds`. */
  private ids = new Map<string, string[]>();
  /**
   * The next number to mint, PER ARRAY.
   *
   * One counter for the whole form was the first shape and it made an id depend on the order in
   * which the arrays were first read: a form with `tags` and `contacts` handed out `r0` then
   * `r2`, because reading `contacts` in between had taken `r1`. Harmless while both sides read
   * in the same order, and a hydration mismatch the moment they do not — the server would send
   * one set of `list()` keys and the client would build another, and every row would be thrown
   * away and rebuilt. Per array, the sequence depends on nothing outside that array.
   */
  private counters = new Map<string, number>();
  /**
   * Whether the schema has ever been run.
   *
   * `isValid` is gated on it, because "no messages recorded" and "nothing failed" are different
   * claims and a form that has not looked must not make the second one. It showed up on the
   * server: an untouched signup page reported `valid: true` while every required field was
   * empty.
   */
  private validated = false;
  private submits = 0;
  private submitting = false;
  /** Identifies the validation in flight, so an earlier one cannot land over a later one. */
  private runId = 0;
  private disposed = false;

  private readonly tree = new FieldTree(this);

  /**
   * Validates once, before the first render, so `isValid` means something on a page nobody has
   * touched.
   *
   * Without it an untouched form claims to be valid, because no messages have been recorded —
   * and `<button disabled={!form.isValid}>` on a form whose defaults are already fine would
   * then start out disabled with no way to enable it. The server render is where that showed
   * up: an empty signup page reported `valid: true`.
   *
   * **The schema is called with the default values**, which is the one cost worth knowing about:
   * a schema carrying an async rule — a uniqueness lookup, say — performs it once at creation.
   *
   * On the SERVER an async answer is dropped rather than awaited. Nothing would wait for it,
   * and it would resolve into a hook whose tree has already been serialised and discarded, so
   * landing it would schedule a render on a page that has been sent. Such a form reports
   * `isValid: false` in the markup, which is the honest answer to "we have not heard back".
   */
  @create
  prime(env: RenderEnv = "client"): void {
    const runId = ++this.runId;
    const outcome = validate(this.props.schema, this.current);

    if (!isPromise(outcome)) {
      this.issues = outcome.issues;
      this.validated = true;
      return;
    }

    if (env === "server") return;
    void outcome.then((resolved) => this.land(runId, resolved.issues));
  }

  @destroy
  dispose(): void {
    this.disposed = true;
  }

  /* ---------------------------------------------------------------- *
   * Reading
   * ---------------------------------------------------------------- */

  /** The typed field tree. Navigate with property access; the API is behind `$`. */
  get fields(): FieldNode<InferIn<S>> {
    return this.tree.root as FieldNode<InferIn<S>>;
  }

  /** What the form holds right now — the INPUT side of the schema. */
  get values(): InferIn<S> {
    void this.version;
    return this.current;
  }

  /** Messages with no field of their own: a schema failure at the root. */
  get formErrors(): readonly string[] {
    return this.errorsAt(ROOT);
  }

  /**
   * Whether the last validation found nothing.
   *
   * Reports the messages the form has COMPUTED, not the ones it is showing — a form whose
   * errors are all still hidden because nothing has been touched is not valid.
   */
  get isValid(): boolean {
    void this.version;
    return this.validated && this.issues.size === 0;
  }

  get isDirty(): boolean {
    return this.dirtyAt(ROOT);
  }

  get isSubmitting(): boolean {
    void this.version;
    return this.submitting;
  }

  get submitCount(): number {
    void this.version;
    return this.submits;
  }

  /* ---------------------------------------------------------------- *
   * FieldHost — what the tree calls back into.
   * ---------------------------------------------------------------- */

  read(path: Path): unknown {
    void this.version;
    return readAt(this.current, path);
  }

  write(path: Path, next: unknown): void {
    this.held = writeAt(this.current, path, next);
    // Edited, not touched: `touched` means blurred, and conflating the two left a field in
    // `validateOn: "blur"` already marked before the blur, so the blur validated nothing.
    this.changedKeys.add(pathKey(path));
    this.bump();

    if (this.shouldValidateOnChange(path)) this.revalidate();
  }

  /**
   * The messages to SHOW for a field.
   *
   * Held back until the field has been touched or a submit has been attempted, because a
   * form that is red before it has been filled in is telling the user off for not having
   * typed yet. `isValid` reports the underlying answer, which is the one a submit uses.
   */
  errorsAt(path: Path): readonly string[] {
    void this.version;
    const key = pathKey(path);
    const interactedWith = this.touchedKeys.has(key) || this.changedKeys.has(key);
    if (this.submits === 0 && !interactedWith) return NO_MESSAGES;
    return this.issues.get(key) ?? NO_MESSAGES;
  }

  touchedAt(path: Path): boolean {
    void this.version;
    return this.touchedKeys.has(pathKey(path));
  }

  dirtyAt(path: Path): boolean {
    void this.version;
    return !equal(readAt(this.current, path), readAt(this.props.defaultValues, path));
  }

  touch(path: Path): void {
    const key = pathKey(path);
    if (this.touchedKeys.has(key)) return;

    this.touchedKeys.add(key);
    this.bump();
    if (this.trigger === "blur") this.revalidate();
  }

  resetAt(path: Path): void {
    this.held = writeAt(this.current, path, readAt(this.props.defaultValues, path));
    this.forgetUnder(path);
    this.bump();
    this.revalidate();
  }

  /**
   * The identities of an array's rows, one per item, in order.
   *
   * Generated from a per-form counter rather than from the data, because a WeakMap cannot
   * key a primitive and `["a", "b", "a"]` has no identity of its own to borrow. The counter
   * is deterministic and starts at zero for every form, so a server render and its
   * hydration produce the same ids and the reconciler sees no change.
   */
  rowIds(path: Path): readonly string[] {
    const key = pathKey(path);
    const value = readAt(this.current, path);
    const length = Array.isArray(value) ? value.length : 0;

    let ids = this.ids.get(key);
    if (ids === undefined) {
      ids = [];
      this.ids.set(key, ids);
    }

    // Grown from underneath — `set` replaced the whole array rather than going through
    // `splice`. Top it up rather than renumbering, so the rows that were already there keep
    // the identities they had.
    while (ids.length < length) ids.push(this.mintId(key));
    if (ids.length > length) ids.length = length;

    return ids;
  }

  splice(path: Path, start: number, remove: number, insert: readonly unknown[]): void {
    const value = readAt(this.current, path);
    const items = Array.isArray(value) ? [...value] : [];
    const at = Math.max(0, Math.min(start, items.length));

    // The ids are read BEFORE the values move. `rowIds` trims itself to the current length,
    // so reading afterwards would hand back a list already cut to the NEW size — and then
    // splicing that would drop one row too many and mint a replacement for a row that never
    // went anywhere.
    const ids = [...this.rowIds(path)];

    items.splice(at, remove, ...insert);
    this.held = writeAt(this.current, path, items);

    // The ids move the same way, in one operation, so the two can never disagree.
    const key = pathKey(path);
    ids.splice(at, remove, ...insert.map(() => this.mintId(key)));
    this.ids.set(key, ids);

    // Everything recorded against a removed or shifted row is about a row that is no longer
    // there. Dropping it is the honest answer: the messages come back from the next
    // validation, addressed to whatever now sits at those indexes.
    this.forgetUnder(path, { keepSelf: true });
    this.bump();
    this.revalidate();
  }

  /**
   * Reorders a row, carrying its identity with it.
   *
   * Deliberately NOT two `splice` calls. `splice` mints an id for anything inserted, so a remove
   * followed by an insert gives the row a new identity — the reconciler sees a different row, drops
   * its element and builds another, and the caret, the selection and any scroll inside it go with it.
   * The value and the id move together here, in one operation, so they cannot disagree.
   *
   * Out of range is a no-op rather than an error, matching `splice`, which clamps. A move that
   * changes nothing does not re-render either: `list()` would rebuild every row's key for an
   * operation that did not happen.
   */
  move(path: Path, from: number, to: number): void {
    const value = readAt(this.current, path);
    const items = Array.isArray(value) ? [...value] : [];
    if (from < 0 || from >= items.length) return;

    const at = Math.max(0, Math.min(to, items.length - 1));
    if (at === from) return;

    // Read before the values move, for the reason `splice` records: `rowIds` trims to the current
    // length, so reading afterwards hands back a list already cut to the new size.
    const ids = [...this.rowIds(path)];

    items.splice(at, 0, ...items.splice(from, 1));
    ids.splice(at, 0, ...ids.splice(from, 1));

    this.held = writeAt(this.current, path, items);
    this.ids.set(pathKey(path), ids);

    // Messages are keyed by index and the indexes have changed, so what is recorded is now about
    // the wrong rows. The next validation re-addresses them.
    this.forgetUnder(path, { keepSelf: true });
    this.bump();
    this.revalidate();
  }

  /* ---------------------------------------------------------------- *
   * Writing from the outside
   * ---------------------------------------------------------------- */

  /**
   * Validates, then calls `onSubmit` if nothing failed. Never rejects — a failed submit is
   * a state to render, the same stance `Mutation.mutate` takes.
   *
   * Bound, like every method on a hook, so `<form onSubmit={this.form.submit}>` keeps one
   * identity across renders (RMD020).
   */
  submit(event?: Event): void {
    event?.preventDefault();
    // Captured HERE, synchronously, because `currentTarget` is null once dispatch is over and an
    // async schema answers long after that. Measured: holding the event and reading it late still
    // works, because `scopeOf` falls back to `target` — so this is about getting the RIGHT element
    // rather than a working one. `currentTarget` is where the handler was attached, `target` is
    // where the event started, and they differ whenever the handler sits on an ancestor.
    this.submittedFrom = scopeOf(event);
    void this.run();
  }

  /**
   * The element a submit came from, for focusing the first field that failed.
   *
   * Only set by a submit carrying an EVENT. A programmatic `form.submit()` moves no focus, which is
   * the right boundary rather than an omission: the app called it, so the app decides where the
   * reader should be looking.
   */
  private submittedFrom: HTMLElement | undefined;

  /**
   * Puts the caret in the first field that failed, in the order the reader sees them.
   *
   * Without it, a submit on an invalid form does nothing visible when the messages are below the
   * fold — the reader presses the button again, and again. For someone using a screen reader there
   * is no signal at all, which makes this accessibility rather than polish. Every serious form
   * library does it, and React Hook Form has it on by default.
   *
   * **DOM order, not schema order.** The issues arrive in whatever order the validator walked, and
   * that is not what is on screen. Walking the form's own controls answers with the first one the
   * reader would reach.
   *
   * **Scoped to the form the submit came from**, so a page with two forms cannot steal focus into
   * the other one. `closest("form")` because the handler may be on a button rather than the form.
   *
   * A disabled control is skipped — `focus()` on one silently does nothing, and the reader would be
   * left with a form that still looks inert. Anything else is left to `focus()`, including the
   * scrolling it already does; adding `scrollIntoView` would fight the browser's own behaviour.
   */
  private focusFirstInvalid(): void {
    const scope = this.submittedFrom;
    if (scope === undefined) return;

    for (const control of scope.querySelectorAll<HTMLElement>("[name]")) {
      const name = control.getAttribute("name");
      if (!name || (control as { disabled?: boolean }).disabled) continue;
      if (!this.issues.has(pathKey(parsePath(name)))) continue;

      control.focus();
      return;
    }
  }

  /** Back to `defaultValues`, or to the values given. Clears errors, `touched` and row ids. */
  reset(values?: InferIn<S>): void {
    this.held = values ?? this.props.defaultValues;
    this.issues = NO_ISSUES;
    this.validated = false;
    this.touchedKeys = new Set();
    this.changedKeys = new Set();
    this.ids = new Map();
    this.counters = new Map();
    this.submits = 0;
    this.submitting = false;
    // A validation already in flight must not land on the form that replaced it.
    this.runId++;
    this.prime();
    this.bump();
  }

  /**
   * Puts a message on a field from the server's answer — `setError("email", "already
   * registered")`.
   *
   * Marks the field touched, or the message would be computed and then hidden by the rule
   * in `errorsAt`. Cleared by the next validation, because a server's objection is about
   * the value that was sent and the user has since changed it.
   */
  setError(path: string, message: string): void {
    const parsed = parsePath(path);
    this.issues = withIssue(this.issues, parsed, message);
    this.touchedKeys.add(pathKey(parsed));
    this.bump();
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  private get current(): InferIn<S> {
    // Lazily, rather than in a field initializer: reading a prop subscribes to it, and the
    // subscription belongs to the render that asked, not to construction.
    if (this.held === undefined) this.held = this.props.defaultValues;
    return this.held;
  }

  private bump(): void {
    if (this.disposed) return;
    this.version++;
  }

  private mintId(key: string): string {
    const next = this.counters.get(key) ?? 0;
    this.counters.set(key, next + 1);
    return `r${next}`;
  }

  /**
   * When a field first validates. `"change"` by default, which is safe to be the default
   * only because `errorsAt` holds a message back until the field has been touched — so
   * live feedback starts with the first keystroke in a field and never before it.
   */
  private get trigger(): ValidateOn {
    return this.props.validateOn ?? "change";
  }

  private shouldValidateOnChange(path: Path): boolean {
    if (this.trigger === "change") return true;
    // Once a field is showing a message, every keystroke has to re-answer it — otherwise the
    // message the user is reading is about the value they have already fixed.
    return this.submits > 0 || this.issues.has(pathKey(path));
  }

  /**
   * Re-runs the schema over the whole form.
   *
   * The whole form rather than one field, and that is what makes a cross-field rule work:
   * bguard writes "the passwords match" on `confirm` as a `custom` that reads `password`
   * through `ctx.ref`, so editing PASSWORD has to re-answer CONFIRM. Validating only the
   * field that changed cannot see that.
   *
   * There is no option to narrow it, and `FormProps` records the measurements that settled
   * that: a 301-field schema revalidates in 155 µs, a hundredth of a frame.
   */
  private revalidate(): Promise<void> {
    const runId = ++this.runId;
    const outcome = validate(this.props.schema, this.current);

    if (!isPromise(outcome)) {
      this.land(runId, outcome.issues);
      return Promise.resolve();
    }

    return outcome.then((resolved) => {
      this.land(runId, resolved.issues);
    });
  }

  private land(runId: number, issues: Issues): void {
    // A later validation owns the answer now. Recording this one would show the verdict on
    // values the form has already moved past.
    if (this.runId !== runId || this.disposed) return;

    this.issues = issues;
    this.validated = true;
    this.bump();
  }

  /**
   * The submit, kept SYNCHRONOUS whenever it can be.
   *
   * Standard Schema returns a promise only for a schema that needs one, so a form over an
   * ordinary schema validates, reports and calls `onSubmit` inside the click — no frame
   * where the button is disabled for nothing, and a test does not have to know how many
   * microtasks to flush. The promise path is the same code, deferred.
   */
  private run(): void {
    if (this.submitting) return;

    this.submits++;
    this.submitting = true;
    // Every field, so nothing stays hidden by the rule in `errorsAt` after a submit.
    this.touchAll();

    const runId = ++this.runId;
    const outcome = validate(this.props.schema, this.current);

    if (!isPromise(outcome)) {
      this.finish(runId, outcome.issues, outcome.value);
      return;
    }

    this.bump();
    void outcome.then((resolved) => this.finish(runId, resolved.issues, resolved.value));
  }

  private finish(runId: number, issues: Issues, value: unknown): void {
    // A later validation, a reset, or an unmount: this answer is about a form that has
    // moved on, and `submitting` belongs to whatever superseded it.
    if (this.runId !== runId || this.disposed) return;

    this.issues = issues;
    this.validated = true;
    if (issues.size > 0) {
      // Before `settle`, which re-renders: the controls already carry their `name`, and only the
      // messages beside them are about to change, so there is nothing to wait for.
      this.focusFirstInvalid();
      this.settle();
      return;
    }

    let handed: void | Promise<void>;
    try {
      handed = this.props.onSubmit(value as InferOut<S>);
    } catch (error) {
      this.report(error);
      this.settle();
      return;
    }

    if (!isPromise(handed)) {
      this.settle();
      return;
    }

    this.bump();
    void handed.then(
      () => this.settle(),
      (error) => {
        this.report(error);
        this.settle();
      },
    );
  }

  private settle(): void {
    if (this.disposed) return;
    this.submitting = false;
    this.bump();
  }

  /**
   * An `onSubmit` that failed is the app's to handle, not the form's to swallow — but it
   * must not become an unhandled rejection either, because `submit` is called from a DOM
   * event where nobody is waiting on the promise.
   */
  private report(error: unknown): void {
    if (__DEV__) {
      console.error("[RMF003] `onSubmit` threw. Handle the failure inside it.", error);
    }
  }

  /** Marks every path the values reach, so a submit reveals messages on fields nobody visited. */
  private touchAll(): void {
    walk(this.current, ROOT, (path) => this.touchedKeys.add(pathKey(path)));
  }

  /** Drops the messages and the touch marks at or under a path. */
  private forgetUnder(path: Path, options?: { keepSelf: boolean }): void {
    const next = new Map(this.issues);
    for (const key of next.keys()) {
      if (covers(key, path, options?.keepSelf === true)) next.delete(key);
    }
    this.issues = next;

    for (const set of [this.touchedKeys, this.changedKeys]) {
      for (const key of [...set]) {
        if (covers(key, path, options?.keepSelf === true)) set.delete(key);
      }
    }
  }
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>)?.then === "function";
}

/**
 * Whether a stored key sits at or under a path.
 *
 * Compares the KEY form on both sides rather than parsing the stored key back into
 * segments, because `pathKey` is built to be unambiguous and its string form is not.
 */
function covers(key: string, path: Path, keepSelf: boolean): boolean {
  if (path.length === 0) return !(keepSelf && key === "");
  if (key === pathKey(path)) return !keepSelf;
  return key.startsWith(keyPrefix(path));
}

/** Every path the value reaches, leaves and branches alike. */
function walk(value: unknown, path: Path, visit: (path: Path) => void): void {
  visit(path);
  if (value === null || typeof value !== "object" || value instanceof Date) return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, [...path, index], visit));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    walk(child, [...path, key], visit);
  }
}

/**
 * Equal by content, for "has this field moved away from its default".
 *
 * Bounded by structure rather than by a depth counter: it recurses through arrays and plain
 * objects and compares everything else with `Object.is`, so a `Date` or a `File` is one
 * comparison rather than a walk of its internals.
 */
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => equal(item, b[index]));
  }

  if (isPlain(a) && isPlain(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => key in b && equal(a[key], b[key]));
  }

  return false;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The element to look for invalid controls in, from a submit event.
 *
 * `closest("form")` because the handler is usually on the `<form>` but may be on a button inside
 * one. When neither is true — a submit wired to something outside a form — the element itself is
 * the scope, which is still narrower than the document.
 */
function scopeOf(event: Event | undefined): HTMLElement | undefined {
  const target = (event?.currentTarget ?? event?.target) as HTMLElement | null | undefined;
  if (!target || typeof target.closest !== "function") return undefined;

  return target.closest("form") ?? target;
}
