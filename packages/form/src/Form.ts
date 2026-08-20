import { created, destroyed, Hook, INSPECT, type RenderEnv, state, watchProp } from "@ramonda/core";

import { ASPECT, EVERY_ASPECT, type FieldHandle, type FieldHost, FieldTree, type Watcher } from "./fieldTree";
import { FACT, type FormFacts, FormProvider, type FormWatcher } from "./formState";
import { childKey, keyPrefix, type Path, parsePath, pathKey, readAt, ROOT, writeAt } from "./path";
import type { FieldNode, FormProps, InferIn, InferOut, StandardSchemaV1, ValidateOn } from "./types";
import { type Issues, NO_ISSUES, NO_MESSAGES, validate, withIssue } from "./validate";
import { report } from "./diagnostics";

/**
 * A form: the values, the errors, and the fields as a typed tree.
 *
 * ```tsx
 * class Signup extends Component {
 *   private form = this.use(Form, () => ({
 *     schema: signupSchema,
 *     defaultValues: { email: "", password: "" },
 *     onSubmit: this.save,
 *   }));
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
 * **The component that owns the form**, on every change, and it cannot opt out: `@state` on a hook
 * holds the owning component's `reBuild` from the moment the signal is built, whatever that component
 * goes on to read — the same thing `Mutation` does with its `version`. So a form written inline in one
 * component re-renders that component per keystroke, which is what anyone would expect and is fine for
 * a page-sized form. For a big one, keep that component THIN: hand the fields to components that watch
 * them, and the owner's render is a handful of vnodes whose props have not changed.
 *
 * **And, separately, whichever fields moved.** A component that watches ONE field asks for it with
 * `Field`, and then a keystroke reaches that component and no other. That is not only about speed: a
 * child handed a field node and reading it directly re-renders NEVER, because the node is one cached
 * object for the life of the form and so its props never change. See `Field`, which exists for that
 * reason first and the speed second.
 *
 * Measured over 300 rows through `list()`, one keystroke: **45 ms and every row rebuilt** before
 * per-path subscriptions; **1.9 ms and one row** with them; **0.6 ms** once the component holding the
 * list watches the array through `Field` too, because then it sleeps through a keystroke inside a row
 * and the three hundred list items are never diffed. The granularity was always in the list engine —
 * one tracker per item — and one shared counter flattened it.
 *
 * ## Why the values are not `@state`
 *
 * `@state` means "serialize me into the hydration blob", and form values are whatever the
 * schema's input side is — a `Date`, a `File`, a class instance — so declaring them would
 * put a warning in front of anyone whose form holds one. They are a plain field, read
 * during the render the counter scheduled, exactly as `Mutation` holds `lastData`.
 */
export class Form<S extends StandardSchemaV1> extends Hook<FormProps<S>> implements FieldHost, FormFacts {
  /**
   * Bumped on every change, and read first by every getter below.
   *
   * A counter rather than the values themselves: two edits can leave a form in an equal
   * state, and a signal that compares equal wakes nothing while what is on screen has moved
   * on. The same trap `Mutation.version` documents.
   */
  @state private version = 0;

  private held: InferIn<S> | undefined;
  /**
   * The defaults `held` was built from — what "the user has not touched this" is measured against.
   *
   * Not the same object as `props.defaultValues` once the defaults have MOVED, and that is the whole
   * point of holding it: after new defaults land, the prop is the new record and this is the one the
   * held values were compared against, so `onDefaultsChanged` can still tell an untouched field from
   * an edited one.
   */
  private seenDefaults: InferIn<S> | undefined;
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
   * The tree a `Field` reads through — the same class over a host whose reads are quiet.
   *
   * Built here rather than on demand because a `FieldHandle` must be one object per path for the
   * life of the form: its two event handlers are bound once, and RMD020 reports a handler whose
   * identity changed between renders (it really is removed and re-added on the element).
   */
  private readonly quietTree = new FieldTree(this.quietHost());

  /**
   * Publishes this form to every descendant, so a `FormState` needs no props.
   *
   * A provider mounted from INSIDE the hook, which puts the channel on the owning component's context —
   * the same thing `Router` does with its route state, and the only route available, because
   * `GLOBAL_RUNTIME` is internal to `@ramonda/core` and this package cannot reach `owner.context` by
   * hand. Two forms nested shadow correctly: contexts are prototype-chained per component.
   *
   * A field initializer rather than `@created`, so the channel is there before any child is built.
   * `protected` because that is the accurate visibility — a subclassed form should reach its own
   * provider — and because `private` on a hook's member still leaves it in the published API.
   */
  protected published = this.use(FormProvider, () => ({ form: this as FormFacts }));

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
  /**
   * `@created`, and the place the form joins the devtools tab.
   *
   * An EVENT rather than a registration, and this package holds no list: `@ramonda/form/devtools`
   * listens when an app has imported it, and nothing happens when it has not. Announcing rather
   * than registering is what keeps the form from importing the module that describes it — which
   * would put that module in the bundle of every application using forms.
   *
   * It is here rather than in `prime` because `prime` is not only the `@created` — a `reset()`
   * calls it again to revalidate, and announcing there listed the same form twice. Here rather
   * than in a field initializer so a form that never mounts never appears, and not on the SERVER
   * at all, where there is no panel and the listener would outlive one request.
   *
   * `this` travels as the detail. The listener builds what it needs from it, so nothing that shapes
   * a panel row lives on this class — a method or a field here would ship whatever the guard said.
   */
  @created
  join(env: RenderEnv = "client"): void {
    this.joined = true;
    if (__DEV__ && env === "client") {
      this.announce();
      // And again whenever the panel asks. `@ramonda/form/devtools` arrives through a dynamic
      // import, so a form already mounted when it loads announced itself to nobody — see
      // `QueryClientProvider.republish` for the same fault, which showed there first because its
      // provider mounts once, at the root, during hydration.
      window.addEventListener("ramonda:form-request", this.announce);
    }
    this.prime(env);
  }

  /**
   * Says this form is here — on mount, and again for a panel that started listening later.
   *
   * `private`, which is what it always meant. Methods are bound whether or not TypeScript can see them,
   * so it still works as the listener registered above, and a hook's method that is not `private` is
   * public API: an app could have called this and dispatched a form announcement of its own.
   *
   * `window` is reached without a guard because both callers are inside `if (__DEV__)` on the CLIENT
   * side, and core cannot be imported without a DOM in a development build.
   */
  private announce(): void {
    window.dispatchEvent(new CustomEvent("ramonda:form", { detail: { form: this, key: this, readable: readableKey } }));
  }

  prime(env: RenderEnv = "client"): void {
    const runId = ++this.runId;
    const outcome = validate(this.props.schema, this.current);

    if (!isPromise(outcome)) {
      this.issues = outcome.issues;
      this.validated = true;
      return;
    }

    if (env === "server") return;
    void outcome.then(
      (resolved) => this.land(runId, resolved.issues),
      (error) => this.failed(runId, error),
    );
  }

  /**
   * The same thing again, on the client only, for a page that arrived as MARKUP.
   *
   * `@created` defaults to `env: "shared"`, and a shared create is skipped during hydration — core does
   * that on purpose, because it already ran on the server, and the comment in `hydrate.ts` says so. The
   * model behind it is that whatever a create did is captured in the hydration blob. **This form's is
   * not**: the values, the messages and `validated` are plain fields rather than `@state`, deliberately,
   * because a form holds whatever the schema's input side is and `@state` means "serialise me".
   *
   * So on a hydrated page nothing had ever validated, and `isValid` was false however good the defaults
   * were. Measured: the server sent `<button disabled={false}>` for a form whose defaults pass, and
   * hydration turned the button OFF, with nothing able to turn it back on until the reader edited a
   * field — the exact failure `join` exists to prevent, arriving by the one path nobody had tested.
   *
   * The guard is `joined` rather than a count of anything: it says whether the create above ran ON THIS
   * SIDE. Under a client render it did, and this is a no-op; under hydration it did not, and this is the
   * only chance to validate and to announce the form to the devtools panel.
   */
  @created({ env: "client" })
  joinAfterHydration(): void {
    if (this.joined) return;
    this.join("client");
  }

  /** Whether `join` ran on this side — see `joinAfterHydration`. */
  private joined = false;

  @destroyed
  dispose(): void {
    this.disposed = true;
    if (__DEV__) {
      window.removeEventListener("ramonda:form-request", this.announce);
      window.dispatchEvent(new CustomEvent("ramonda:form-gone", { detail: { key: this } }));
    }
  }

  /**
   * Everything the Forms tab is allowed to read or ask for, and nothing else.
   *
   * A narrow object rather than the instance: the panel can see what is on screen and ask for a
   * reset or a submit, and it cannot reach the schema, the field tree, or anything that would let
   * it change the form in a way the form did not sanction. Getters rather than a copy, because it
   * is read on every poll and must answer for the form as it is now.
   */

  /**
   * New `defaultValues` — "fetch the record, then fill the form".
   *
   * The pattern did not work at all before this: `current` latched the defaults on its first read,
   * which is `prime()`, and never consulted the prop for values again. A form handed
   * `{ name: "Ada" }` a moment after mounting kept showing the empty strings it started with, and
   * nothing said so.
   *
   * ## The rule
   *
   * - a field the user has **not** touched takes the new value
   * - a field the user **has** touched keeps what was typed
   *
   * Which is what anyone asking for this wants, and where every library that has answered it ends
   * up. Losing what somebody is halfway through typing because a request came back is the failure
   * worth designing against; showing them a stale empty box is the other one.
   *
   * "Touched" here means **edited** — `changedKeys`, or a value that has moved away from the
   * defaults it was built from. Not `touchedKeys`: that means BLURRED, and a field somebody tabbed
   * through without typing in has no content of theirs to protect.
   *
   * ## Why `@watchProp`
   *
   * It runs before the render, so the new values are on screen in the same pass rather than one
   * frame later, and writing state in it is safe for that reason — the same argument `Query`'s
   * `onKeyChanged` records. It also watches the HOOK's props rather than the owner component's,
   * which is the only reading that could work here.
   *
   * ## The cost of a rebuilt literal
   *
   * `@watchProp` fires on identity, so a props factory that builds `defaultValues: { … }` inline —
   * the normal way to write one — fires this on **every render of the owner**. So the first thing it
   * does is answer "did anything actually move" by value, and a form whose defaults are genuinely
   * unchanged goes no further: no write, no render, and `values` stays the same object.
   *
   * What that comparison costs, per render of the owner, over three runs of 20,000 iterations in
   * this repo's test environment: **2.0 – 2.6 µs** at ten fields, **13.4 – 19.6 µs** at a hundred,
   * **40.2 – 66.0 µs** at three hundred. The spread is the environment's, not the walk's — a third
   * of the top figure moves run to run.
   *
   * ## Why `@StableProps("defaultValues")` is not declared, though it looks made for this
   *
   * It would hand back one identity while the contents are equal, and this would not fire at all —
   * which is exactly right for `Query.key` and wrong here. The comparison behind it is bounded:
   * five levels deep, and anything wider than fifty items is called different rather than sampled.
   * Both bounds err toward "different", so nothing is lost — but a form's defaults are routinely
   * past both, and a declaration that quietly stops helping is worse than no declaration.
   *
   * The bounds err that way BECAUSE of this prop: with the declaration in place, a record whose
   * only change was row 55 of 60 came back as the previous object and the value was lost with
   * nothing reported. The framework's width bound answered "equal" from a sample of fifty. That is
   * fixed in core now, and the reason the form still does its own comparison stands on its own:
   * deciding per field who owns what needs the full walk anyway.
   */
  @watchProp((props) => props.defaultValues)
  onDefaultsChanged([next]: [InferIn<S>]): void {
    // Nothing has read the values yet, so `current` has not latched — it will take `next` itself
    // when something does, and merging into values that do not exist would only get in the way.
    if (this.held === undefined) return;

    const previous = this.seenDefaults;
    if (equal(next, previous)) return;
    this.seenDefaults = next;

    const replaced: Path[] = [];
    this.held = adopt(this.held, next, previous, ROOT, (path) => this.changedKeys.has(pathKey(path)), replaced);
    // Every field was the user's, so the new defaults changed nothing that is on screen. Bumping
    // anyway would re-render a form that looks exactly the same.
    if (replaced.length === 0) return;

    // What was recorded about a value is about the value that WAS there. The messages come back from
    // the validation below, addressed to what the form holds now.
    for (const path of replaced) this.forgetUnder(path);
    this.bump();
    // Only the fields that actually took a new value. A record arriving over a form the reader has
    // half filled in typically replaces a handful of fields and leaves the rest alone. Every aspect,
    // because `forgetUnder` above dropped what was recorded under each of them too.
    for (const path of replaced) this.wakeAt(path, EVERY_ASPECT);
    void this.revalidate();
  }

  /**
   * What the devtools panel shows for this form.
   *
   * Without it the row reads `state: { version: 7 }` and a set of props that never change — a
   * counter going up, and nothing anyone would open the panel to look at. The values, the messages
   * and what has been touched are plain fields, because `@state` means "serialise me into the
   * hydration blob" and a form holds whatever the schema's input side is: a `Date`, a `File`, a
   * class instance. See `INSPECT`.
   *
   * `errors` is what the form has COMPUTED, not what it is showing — a message held back because
   * nothing has been touched is exactly what someone is in the panel to find.
   */
  [INSPECT](): Record<string, unknown> {
    return {
      values: this.current,
      errors: Object.fromEntries([...this.issues].map(([key, messages]) => [readableKey(key), messages])),
      touched: [...this.touchedKeys].map(readableKey),
      changed: [...this.changedKeys].map(readableKey),
      isValid: this.isValid,
      isDirty: this.isDirty,
      isSubmitting: this.submitting,
      submitCount: this.submits,
    };
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

  /* ---- the same five, without touching `version` — for `FormState`, see `Form.read` ---- */

  get formErrorsQuietly(): readonly string[] {
    return this.errorsAtQuietly(ROOT);
  }

  get isValidQuietly(): boolean {
    return this.validated && this.issues.size === 0;
  }

  get isDirtyQuietly(): boolean {
    return this.dirtyAtQuietly(ROOT);
  }

  get isSubmittingQuietly(): boolean {
    return this.submitting;
  }

  get submitCountQuietly(): number {
    return this.submits;
  }

  /**
   * Whether the last validation found nothing.
   *
   * Reports the messages the form has COMPUTED, not the ones it is showing — a form whose
   * errors are all still hidden because nothing has been touched is not valid.
   */
  get isValid(): boolean {
    void this.version;
    return this.isValidQuietly;
  }

  get isDirty(): boolean {
    return this.dirtyAt(ROOT);
  }

  get isSubmitting(): boolean {
    void this.version;
    return this.isSubmittingQuietly;
  }

  get submitCount(): number {
    void this.version;
    return this.submitCountQuietly;
  }

  /* ---------------------------------------------------------------- *
   * FieldHost — what the tree calls back into.
   * ---------------------------------------------------------------- */

  /**
   * ## Two ways to read a field, and the difference is the SUBSCRIPTION
   *
   * The four reads below touch `version`, and what that does is NOT what it looks like. A plain
   * component's render is neither an effect nor a tracker, so reading a signal there records nothing —
   * measured. What the touch reaches is the two scopes that DO record: a `@compute` that derives from a
   * field, and a `list()` item, which the list engine builds inside a tracker of its own. So it is what
   * makes `@compute get canSave() { return this.form.isValid }` re-derive.
   *
   * The component that owns the form re-renders on every change for a different reason, and it cannot
   * opt out: `@state` on a hook holds the OWNING component's `reBuild` from the moment the signal is
   * constructed, whatever that component goes on to read.
   *
   * The touch is wrong for a component watching ONE field through `Field`, which has a narrower
   * subscription of its own. Inside a `list()` row it is worse than wrong: the row's tracker would
   * record `version` and every row would rebuild on every keystroke anywhere in the form, which is
   * exactly the 45 ms this package used to cost at three hundred rows. Such a reader goes through the
   * same `FieldHandle` class over a QUIET host (see `watch`), whose reads are the `*Quietly` methods
   * here: the same answer, recording nothing.
   *
   * The pair exists rather than a flag because the quiet host is what a `Field` is handed, so there
   * is no state to set and unset around a read, and nothing to get wrong on a path that throws.
   */
  read(path: Path): unknown {
    void this.version;
    return this.readQuietly(path);
  }

  readQuietly(path: Path): unknown {
    return readAt(this.current, path);
  }

  write(path: Path, next: unknown): void {
    this.held = writeAt(this.current, path, next);
    // Edited, not touched: `touched` means blurred, and conflating the two left a field in
    // `validateOn: "blur"` already marked before the blur, so the blur validated nothing.
    this.changedKeys.add(pathKey(path));
    this.bump();
    // The value, and the marks — an edit is what `errorsAt` reads to decide whether this field's
    // message may be SHOWN. Not `shape`: writing a value does not change any array's length or order,
    // which is what lets a component rendering a list of rows sleep through a keystroke inside one.
    this.wakeAt(path, ASPECT.value | ASPECT.marks);

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
    return this.errorsAtQuietly(path);
  }

  errorsAtQuietly(path: Path): readonly string[] {
    const key = pathKey(path);
    const interactedWith = this.touchedKeys.has(key) || this.changedKeys.has(key);
    if (this.submits === 0 && !interactedWith) return NO_MESSAGES;
    return this.issues.get(key) ?? NO_MESSAGES;
  }

  touchedAt(path: Path): boolean {
    void this.version;
    return this.touchedAtQuietly(path);
  }

  touchedAtQuietly(path: Path): boolean {
    return this.touchedKeys.has(pathKey(path));
  }

  /**
   * Whether the value here has moved away from the baseline.
   *
   * Measured against `seenDefaults` rather than `props.defaultValues`, because that is the baseline
   * the rest of the class already maintains: `reset` moves it to the values it was handed, `resetAt`
   * moves one field's, and `onDefaultsChanged` moves it when a record arrives. Reading the prop here
   * instead made the two disagree — `form.reset(record)` reported a dirty form that nobody had
   * touched, so the unsaved-changes guard fired on the way out and Save came up enabled.
   */
  dirtyAt(path: Path): boolean {
    void this.version;
    return this.dirtyAtQuietly(path);
  }

  dirtyAtQuietly(path: Path): boolean {
    return !equal(readAt(this.current, path), readAt(this.baseline, path));
  }

  touch(path: Path): void {
    const key = pathKey(path);
    if (this.touchedKeys.has(key)) return;

    this.touchedKeys.add(key);
    this.bump();
    // Only this path, and only the marks: `touched` is per field, and so is the message it may now
    // reveal. No value moved.
    this.wake(key, ASPECT.marks);
    if (this.trigger === "blur") this.revalidate();
  }

  resetAt(path: Path): void {
    const back = readAt(this.props.defaultValues, path);
    this.held = writeAt(this.current, path, back);
    // The baseline moves with the value, exactly as in `reset`. `forgetUnder` clears the edit mark
    // below, and this clears the other half of the same question: without it a field reset AFTER the
    // defaults had moved would sit at the new default while the baseline still held the old one, and
    // read as the user's forever after.
    this.seenDefaults = writeAt(this.seenDefaults as InferIn<S>, path, back);
    this.forgetUnder(path);
    this.bump();
    // The value moved and everything recorded under it was dropped, so the subtree hears about all of
    // it. `shape` too: resetting an array field puts back a list of a different length.
    this.wakeAt(path, EVERY_ASPECT);
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
    const was = items.length;

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
    // And the field nodes for rows the array no longer has. A node is kept for the life of the form on
    // purpose — it is what keeps `bind.onInput` one function per field — but that was also true of a row
    // that had been removed, so a form that once showed ten thousand rows held a node and a handle for
    // every one of them afterwards. Both trees, since a watched field reads through the quiet one.
    if (items.length < was) {
      this.tree.forgetFrom(path, items.length);
      this.quietTree.forgetFrom(path, items.length);
    }
    this.bump();
    // The whole subtree, and every aspect of it: the rows at or after the change hold different values,
    // the array around them has a different length or order — which is the `shape` a list renders from —
    // and `forgetUnder` above dropped the marks and messages that described the rows that moved.
    this.wakeAt(path, EVERY_ASPECT);
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
    // The whole subtree, and every aspect of it: the rows at or after the change hold different values,
    // the array around them has a different length or order — which is the `shape` a list renders from —
    // and `forgetUnder` above dropped the marks and messages that described the rows that moved.
    this.wakeAt(path, EVERY_ASPECT);
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
   * library does it, and the ones worth copying have it on by default.
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
    // The baseline moves with them: nothing in a form that was just reset is the user's, so defaults
    // arriving afterwards are free to take every field. Reading `props.defaultValues` here instead
    // would mark a `reset(record)` form as edited everywhere and let no later default in.
    this.seenDefaults = this.held;
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
    // Everything: the values, the messages, the touch marks and the reveal rule all moved at once.
    this.wakeAll();
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
    // A message, and the touch mark that lets it be seen. Set by hand from a server's answer, so no
    // value moved and no array changed.
    this.wake(pathKey(parsed), ASPECT.messages | ASPECT.marks);
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  private get current(): InferIn<S> {
    // Lazily, rather than in a field initializer: reading a prop subscribes to it, and the
    // subscription belongs to the render that asked, not to construction.
    if (this.held === undefined) {
      this.held = this.props.defaultValues;
      this.seenDefaults = this.held;
    }
    return this.held;
  }

  /**
   * What "the user has not changed this" is measured against.
   *
   * `current` first, because that is what latches the pair on a form nothing has read yet — without
   * it the very first `isDirty` would compare against `undefined` and call every field dirty.
   */
  private get baseline(): InferIn<S> {
    void this.current;
    return this.seenDefaults as InferIn<S>;
  }

  private bump(): void {
    if (this.disposed) return;
    this.version++;
    // Here rather than at each call site: every change in the form goes through this, and a form-level
    // fact can move on any of them — a validation landing flips `isValid`, a keystroke flips `isDirty`.
    this.publish();
  }

  /* ---------------------------------------------------------------- *
   * Form-level subscriptions — what a submit button watches.
   * ---------------------------------------------------------------- */

  /**
   * Components watching the FORM rather than a field: a save button, a summary of the root errors.
   *
   * Separate from `watchers` because the question is different. A field watcher is told that something
   * at its path changed and believes it; a form watcher must not be, because the facts it reads are
   * ANSWERS — `isValid` is `false` before a keystroke and `false` after it, and waking a button for
   * that is exactly what a form-wide counter did wrong. So this side compares the answer to the last
   * one it published and wakes only on a real move.
   */
  private readonly formWatchers = new Set<FormWatcher>();

  /**
   * The answers as last published, so `publish` can tell a change from an event.
   *
   * Deliberately not initialised from the form: at construction nothing has been validated and nobody
   * is watching, and the first `publish` with a watcher present fills it in. `undefined` for the
   * messages means "never published", which is not the same as "published as empty".
   */
  private published_: {
    valid: boolean;
    dirty: boolean;
    submitting: boolean;
    submits: number;
    formErrors: readonly string[];
  } = {
    valid: false,
    dirty: false,
    submitting: false,
    submits: 0,
    formErrors: NO_MESSAGES,
  };

  watchForm(watcher: FormWatcher): void {
    this.formWatchers.add(watcher);
    // Its mask may name facts nothing has published yet, and the next `publish` compares against what
    // is here — so bring the record up to date now, or the first change would look like no change.
    this.record(this.wanted());
  }

  unwatchForm(watcher: FormWatcher): void {
    this.formWatchers.delete(watcher);
  }

  /** The union of what every form watcher reads — so an unwatched fact is never computed. */
  private wanted(): number {
    let mask = 0;
    for (const watcher of this.formWatchers) mask |= watcher.reads;
    return mask;
  }

  /** Brings the record up to date without waking anyone. */
  private record(mask: number): void {
    const at = this.published_;
    if (mask & FACT.valid) at.valid = this.isValidQuietly;
    if (mask & FACT.dirty) at.dirty = this.isDirtyQuietly;
    if (mask & FACT.submitting) at.submitting = this.isSubmittingQuietly;
    if (mask & FACT.submits) at.submits = this.submitCountQuietly;
    if (mask & FACT.formErrors) at.formErrors = this.formErrorsQuietly;
  }

  /**
   * Wakes the form watchers whose answer MOVED, and nobody else.
   *
   * Called from `bump`, which is the one place every change goes through. Costs a handful of
   * comparisons, and only for facts somebody reads: `isDirty` is a walk of the whole value against the
   * baseline — 11.5 µs over 900 leaves — so a form nobody asks about that never pays it.
   */
  private publish(): void {
    if (this.formWatchers.size === 0) return;

    const mask = this.wanted();
    const at = this.published_;
    let moved = 0;

    if (mask & FACT.valid) {
      const now = this.isValidQuietly;
      if (now !== at.valid) {
        at.valid = now;
        moved |= FACT.valid;
      }
    }
    if (mask & FACT.dirty) {
      const now = this.isDirtyQuietly;
      if (now !== at.dirty) {
        at.dirty = now;
        moved |= FACT.dirty;
      }
    }
    if (mask & FACT.submitting) {
      const now = this.isSubmittingQuietly;
      if (now !== at.submitting) {
        at.submitting = now;
        moved |= FACT.submitting;
      }
    }
    if (mask & FACT.submits) {
      const now = this.submitCountQuietly;
      if (now !== at.submits) {
        at.submits = now;
        moved |= FACT.submits;
      }
    }
    if (mask & FACT.formErrors) {
      const now = this.formErrorsQuietly;
      if (!sameMessages(at.formErrors, now)) {
        at.formErrors = now;
        moved |= FACT.formErrors;
      }
    }

    if (moved === 0) return;
    for (const watcher of this.formWatchers) watcher.bump(moved);
  }

  /* ---------------------------------------------------------------- *
   * Per-field subscriptions — what makes a change surgical.
   * ---------------------------------------------------------------- */

  /**
   * Who is watching which path. One entry per path anything asked about, so a form nobody has split
   * into components allocates nothing here.
   *
   * The values are `Field` hooks, and each one owns a `@state` counter belonging to the component
   * that used it — which is the whole mechanism. `State` is internal to `@ramonda/core` on purpose
   * ("apps reach reactivity through @state / @compute / context"), so this package holds no signals
   * of its own; it holds the *list of who to poke*, and each watcher's own state does the waking.
   *
   * Measured, 300 rows through `list()`, one keystroke: every row rebuilt, 45 ms, because every row
   * read the one form-wide counter and so depended on every change in the form. The granularity was
   * always in the list engine — one tracker per item — and a single counter flattened it.
   */
  private readonly watchers = new Map<string, Set<Watcher>>();

  /**
   * Registers `watcher` for changes at `path`, and hands back the handle it should read through.
   *
   * The handle comes from a QUIET tree: same class, same `bind`, same stable handler identities, but
   * its reads do not touch `version` — see `read`. A watcher that read through the ordinary tree
   * would subscribe its component to the whole form on the first read and undo the point of being
   * here.
   */
  watch(path: Path, watcher: Watcher): FieldHandle {
    const key = pathKey(path);
    let set = this.watchers.get(key);
    if (set === undefined) {
      set = new Set();
      this.watchers.set(key, set);
    }
    set.add(watcher);

    return (this.quietTree.node(path) as { $: FieldHandle }).$;
  }

  unwatch(path: Path, watcher: Watcher): void {
    const key = pathKey(path);
    const set = this.watchers.get(key);
    if (set === undefined) return;

    set.delete(watcher);
    // Dropped rather than left empty, so `wakeUnder` walks only paths somebody is actually watching.
    if (set.size === 0) this.watchers.delete(key);
  }

  /**
   * The same form, with the four reads swapped for their quiet twins.
   *
   * Everything else is the form's own method: writing, touching, splicing and reordering subscribe
   * nobody, so there is no quiet variant of them to make.
   */
  private quietHost(): FieldHost {
    return {
      read: (path) => this.readQuietly(path),
      errorsAt: (path) => this.errorsAtQuietly(path),
      touchedAt: (path) => this.touchedAtQuietly(path),
      dirtyAt: (path) => this.dirtyAtQuietly(path),
      write: (path, next) => this.write(path, next),
      touch: (path) => this.touch(path),
      resetAt: (path) => this.resetAt(path),
      rowIds: (path) => this.rowIds(path),
      splice: (path, start, remove, insert) => this.splice(path, start, remove, insert),
      move: (path, from, to) => this.move(path, from, to),
      watch: (path, watcher) => this.watch(path, watcher),
      unwatch: (path, watcher) => this.unwatch(path, watcher),
    };
  }

  /** Pokes everyone watching one exact path, about the kinds of change named. */
  private wake(key: string, aspects: number): void {
    const set = this.watchers.get(key);
    if (set === undefined) return;
    for (const watcher of set) watcher.bump(aspects);
  }

  /**
   * The value at `path` moved, so three sets of watchers have to hear about it.
   *
   * - **the path itself**, which is the obvious one
   * - **its ancestors**, because their value, their `dirty` and their `rows` are aggregates of what
   *   is underneath — a row's field changing makes the array around it dirty
   * - **its descendants**, because their value came from inside what was just replaced: `set` on an
   *   object, a `splice`, or a whole new record all move fields nobody named
   *
   * The descendants are found by string prefix over the watched paths, which is why `unwatch` drops
   * empty entries. It is proportional to how many paths are WATCHED, not to the size of the form.
   */
  private wakeAt(path: Path, aspects: number): void {
    const key = pathKey(path);
    this.wake(key, aspects);

    for (let depth = path.length - 1; depth >= 0; depth--) this.wake(pathKey(path.slice(0, depth)), aspects);

    const prefix = keyPrefix(path);
    for (const [watched, set] of this.watchers) {
      // `startsWith("")` is true of everything, which is exactly right for the root.
      if (watched !== key && watched.startsWith(prefix)) {
        for (const watcher of set) watcher.bump(aspects);
      }
    }
  }

  /** Every watcher, about everything — for a change that really does reach the whole form. */
  private wakeAll(): void {
    for (const set of this.watchers.values()) {
      for (const watcher of set) watcher.bump(EVERY_ASPECT);
    }
  }

  /**
   * Wakes the fields whose MESSAGES changed, and only those.
   *
   * A validation re-answers the whole form — that is what makes a cross-field rule work — but the
   * answer is usually the same as last time for all but one field. Comparing the two maps is what
   * turns "the schema ran" into "these three fields changed", and it is what keeps a keystroke in
   * one row from waking three hundred others.
   */
  private wakeChangedMessages(before: Issues, after: Issues): void {
    if (this.watchers.size === 0) return;

    for (const [key, set] of this.watchers) {
      const was = before.get(key);
      const now = after.get(key);
      if (was === now) continue;
      if (was !== undefined && now !== undefined && sameMessages(was, now)) continue;

      for (const watcher of set) watcher.bump(ASPECT.messages);
    }
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

    return outcome.then(
      (resolved) => {
        this.land(runId, resolved.issues);
      },
      (error) => this.failed(runId, error),
    );
  }

  private land(runId: number, issues: Issues): void {
    // A later validation owns the answer now. Recording this one would show the verdict on
    // values the form has already moved past.
    if (this.runId !== runId || this.disposed) return;

    const before = this.issues;
    this.issues = issues;
    this.validated = true;
    this.bump();
    // Only the fields whose messages actually moved. The schema re-answers the whole form — that is
    // what makes a cross-field rule work — but the answer is the same as last time for all but one or
    // two fields, and waking the rest is what a keystroke in a long list must not do.
    this.wakeChangedMessages(before, issues);
  }

  /**
   * The schema was asked and did not answer: its promise rejected.
   *
   * Standard Schema does not promise that the promise RESOLVES, and an async rule doing real work —
   * a uniqueness lookup against the server — rejects whenever that work does. Every validator
   * propagates it: a `fetch` that throws inside a refinement comes out as a rejected promise. So
   * this is an ordinary condition to be in, not a broken program, which is why it reports rather
   * than throws.
   *
   * **`validated` goes back to false**, and that is the whole answer. `isValid` reads it, so a form
   * whose validation failed stops claiming to be valid — the same stance the class takes on the
   * server, where an async answer cannot be awaited and the markup says `isValid: false`. "We asked
   * and did not hear back" is not "nothing failed".
   *
   * **The messages it already had are kept.** Blanking them would say the form had been re-answered.
   *
   * Guarded by `runId` and `disposed` exactly as `land` is: a rejection from a superseded run is
   * about values the form has moved past, and a dead form neither reports nor renders.
   */
  private failed(runId: number, error: unknown): void {
    if (this.runId !== runId || this.disposed) return;

    this.validated = false;
    if (__DEV__) {
      report(
        "RMF004",
        "The schema's validation rejected, so the form has no verdict on these values.",
        { reason: error instanceof Error ? error.message : String(error) },
        error,
      );
    }
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
    this.touchAll();
    // `submits` moving off zero changes what EVERY field is allowed to show — see `errorsAt` — so
    // this is one of the two places a change genuinely reaches the whole form.
    this.wakeAll();

    const runId = ++this.runId;
    const outcome = validate(this.props.schema, this.current);

    if (!isPromise(outcome)) {
      this.finish(runId, outcome.issues, outcome.value);
      return;
    }

    this.bump();
    void outcome.then(
      (resolved) => this.finish(runId, resolved.issues, resolved.value),
      (error) => {
        // `settle` runs whatever `failed` decides, for the reason `finish` records: the submit this
        // belonged to is over either way, and `submitting` is what the button is disabled by. One
        // failed lookup used to disable it for the life of the page.
        this.failed(runId, error);
        this.settle();
      },
    );
  }

  private finish(runId: number, issues: Issues, value: unknown): void {
    if (this.disposed) return;

    /**
     * A later validation, a reset, or new defaults: this answer is about values the form has moved
     * past, so it is not recorded and `onSubmit` is not called with them.
     *
     * But the submit it belonged to is OVER, and `submitting` is what the button is disabled by —
     * so returning without releasing it wedged the form permanently. Only reachable with an ASYNC
     * schema, because a synchronous one has already been through here before anything else could
     * run, which is why it went unnoticed: type one character while an async schema is out and the
     * form can never be submitted again.
     */
    if (this.runId !== runId) {
      this.settle();
      return;
    }

    const before = this.issues;
    this.issues = issues;
    this.validated = true;
    // The reveal rule already woke everyone on the first submit; on a second one only the messages
    // that moved need to hear about it.
    this.wakeChangedMessages(before, issues);
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
      report(
        "RMF003",
        "`onSubmit` threw. Handle the failure inside it.",
        { reason: error instanceof Error ? error.message : String(error) },
        error,
      );
    }
  }

  /**
   * Marks every path the values reach as touched, so `field.$.touched` reads true after a submit.
   *
   * NOT what reveals the messages — `errorsAt` shows everything once `submits` is off zero, and it
   * has to, because a message can be filed against a key the values never had: a required field
   * absent from an object is exactly that, and this walk cannot reach it. So the two answers differ
   * for such a field, deliberately: its message shows, and it is not "touched", because nobody
   * touched it.
   *
   * It costs a walk of the whole value tree, paid once per submit, on an action the reader initiated:
   * **261 µs** over 1208 paths — see `markKeys`, which is where that number comes from and what it was
   * before. What it leaves behind used to be the more interesting cost, a `touchedKeys` with one entry
   * per path that `forgetUnder` then scanned on every row insert or removal; that is **42 µs** now.
   */
  private touchAll(): void {
    markKeys(this.current, "", 0, this.touchedKeys);
  }

  /** Drops the messages and the touch marks at or under a path. */
  private forgetUnder(path: Path, options?: { keepSelf: boolean }): void {
    // Rendered ONCE, not once per key. `covers` took a `Path` and so rebuilt this string for every
    // key it was asked about: after a submit has touched every path, that is a thousand `pathKey`
    // calls per row inserted or removed, and it was most of the 424 µs this used to cost.
    const covered = coverage(path, options?.keepSelf === true);

    // Only copied if something is actually dropped. A splice on an array with no messages under it —
    // the ordinary case for a form nobody has submitted yet — now allocates nothing.
    let next: Map<string, readonly string[]> | undefined;
    for (const key of this.issues.keys()) {
      if (!covered(key)) continue;
      if (next === undefined) next = new Map(this.issues);
      next.delete(key);
    }
    if (next !== undefined) this.issues = next;

    for (const set of [this.touchedKeys, this.changedKeys]) {
      // Collected before deleting, and the list holds the MATCHES rather than the whole set: copying
      // every key was the second half of the cost, and after a submit the set is one key per path in
      // the form.
      let doomed: string[] | undefined;
      for (const key of set) {
        if (!covered(key)) continue;
        (doomed ??= []).push(key);
      }
      if (doomed !== undefined) {
        for (const key of doomed) set.delete(key);
      }
    }
  }
}

/**
 * Whether two message lists say the same thing.
 *
 * Compared by content because a validation builds a fresh array every run, so identity says nothing —
 * and this is what turns "the schema ran" into "these two fields changed". Short by nature: a field
 * with more than a handful of messages does not exist.
 */
function sameMessages(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((message, index) => message === b[index]);
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>)?.then === "function";
}

/**
 * Whether a stored key sits at or under a path — as a TEST built once, then asked about many keys.
 *
 * Compares the KEY form on both sides rather than parsing a stored key back into segments, because
 * `pathKey` is built to be unambiguous and its string form is not.
 *
 * A closure rather than a three-argument predicate, and that is the whole performance story of
 * `forgetUnder`: taking the `Path` per call meant rebuilding `pathKey(path)` and `keyPrefix(path)` for
 * every key examined, which after a submit is one per path in the form.
 */
function coverage(path: Path, keepSelf: boolean): (key: string) => boolean {
  // The root covers everything, and `keyPrefix([])` is the empty string that every key starts with —
  // so the only question left is whether the root's own entry survives.
  if (path.length === 0) return keepSelf ? (key) => key !== "" : () => true;

  const self = pathKey(path);
  const prefix = keyPrefix(path);
  return keepSelf ? (key) => key.startsWith(prefix) : (key) => key === self || key.startsWith(prefix);
}

/**
 * Records the KEY of every path the value reaches, leaves and branches alike.
 *
 * Keys rather than paths, and each built from its parent's. Measured over 1208 paths, which is a form
 * of 300 objects: **884 µs** for the shape this replaces — a fresh `[...path, key]` array per node with
 * `pathKey` run over it — **467 µs** once the key is carried down instead, and **261 µs** with
 * `Object.keys` in place of `Object.entries`, which was allocating a pair array per node. A submit walks
 * the whole form, so this is the one place those two allocations were worth removing.
 *
 * What is left is a concatenation and a `Set.add` per path, and going below it means a different
 * structure rather than a tighter loop.
 *
 * A `Date` is a leaf. It is an object, and descending into one would mark `getTime` as a field.
 */
function markKeys(value: unknown, key: string, depth: number, into: Set<string>): void {
  into.add(key);
  if (value === null || typeof value !== "object" || value instanceof Date) return;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      markKeys(value[index], childKey(key, depth, index), depth + 1, into);
    }
    return;
  }

  for (const name of Object.keys(value)) {
    markKeys((value as Record<string, unknown>)[name], childKey(key, depth, name), depth + 1, into);
  }
}

/**
 * The new defaults, with everything the user owns left exactly where it is.
 *
 * Answers `held` unchanged when it takes nothing, so an untouched-but-identical form allocates
 * nothing and `replaced` stays empty — which is what tells the caller there is no render to do.
 *
 * `replaced` collects the paths that actually took a new value, because the messages and touch marks
 * recorded under them are about values that are no longer there.
 *
 * ## Containers descend, leaves decide
 *
 * The ownership test cannot be applied to a whole object, because a form where one field was edited
 * has a ROOT that differs from its defaults — and answering "the user owns the root" there would
 * adopt nothing at all. So an object is always walked, and only its leaves are asked.
 *
 * ## Arrays descend only when nothing has changed length
 *
 * Index-wise merging is meaningful only while row *i* is still row *i*. Once a length differs
 * anywhere in the three, the indexes no longer line up — merging them would pair a row with whatever
 * happens to sit at its number now, which is the identity failure `this.ids` exists to prevent. So a
 * length change makes the array a leaf: untouched, it takes the new one whole (`rowIds` tops up and
 * trims itself, so the rows that survive keep their identities); edited, the user's array stays.
 */
function adopt(
  held: unknown,
  next: unknown,
  previous: unknown,
  path: Path,
  edited: (path: Path) => boolean,
  replaced: Path[],
): unknown {
  // Written at this exact path — `field.$.set(…)`, or a keystroke. Theirs, whatever is underneath.
  if (edited(path)) return held;

  if (isPlain(held) && isPlain(next)) {
    const out: Record<string, unknown> = { ...held };
    let moved = false;

    // The union, so a key the new defaults ADD arrives rather than being invisible for being absent
    // from what the form happens to hold.
    for (const key of new Set([...Object.keys(held), ...Object.keys(next)])) {
      // `readAt` rather than indexing, because the old defaults need not have had an object here at
      // all — it answers undefined for anything the value does not reach, which is what a key with
      // no history should compare against.
      const taken = adopt(held[key], next[key], readAt(previous, [key]), [...path, key], edited, replaced);
      if (!Object.is(taken, out[key])) {
        out[key] = taken;
        moved = true;
      }
    }

    return moved ? out : held;
  }

  if (Array.isArray(held) && Array.isArray(next) && Array.isArray(previous)) {
    if (held.length === next.length && held.length === previous.length) {
      const out = [...held];
      let moved = false;

      for (let i = 0; i < held.length; i++) {
        const taken = adopt(held[i], next[i], previous[i], [...path, i], edited, replaced);
        if (!Object.is(taken, out[i])) {
          out[i] = taken;
          moved = true;
        }
      }

      return moved ? out : held;
    }
  }

  // A leaf. It is the user's the moment it has moved away from the defaults it was built from —
  // which is what catches an edit `changedKeys` never recorded, a `splice` above all.
  if (!equal(held, previous)) return held;
  if (equal(held, next)) return held;

  replaced.push(path);
  return next;
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

  /**
   * A `Date` names a moment, and two of them for one moment are equal here even though `Object.is`
   * says otherwise. Without this a defaults factory writing `when: new Date(iso)` — a fresh object
   * on every run — replaced the field, dropped the messages under it and re-ran the whole schema on
   * every render of the owner, for a value that had not moved.
   *
   * Only `Date`. Anything else with a `getTime` is not one, and still compares by identity.
   */
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();

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

/**
 * A `pathKey` back into something a reader recognises.
 *
 * The internal key separates segments with a NUL and marks an index with `#`, both of which exist so
 * two different paths cannot collide. Neither is readable, and the panel is the one place these keys
 * are shown to a person.
 */
function readableKey(key: string): string {
  if (key === "") return "(form)";
  return key
    .split("\u0000")
    .map((segment) => (segment.startsWith("#") ? `[${segment.slice(1)}]` : segment))
    .join(".")
    .replace(/\.\[/g, "[");
}
