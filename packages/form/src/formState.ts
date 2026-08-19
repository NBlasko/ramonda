import { createContext, destroyed, Hook, INSPECT, state } from "@ramonda/core";

import { NO_MESSAGES } from "./validate";

/**
 * WHICH form-level fact changed, as a bitmask — the same trick `ASPECT` plays for a field.
 *
 * A save button reads `isValid` and `isSubmitting`, and neither of them moves on an ordinary keystroke:
 * a form that was invalid before the keystroke and invalid after it has not changed its answer. So the
 * button wakes when validity FLIPS and when a submit starts or ends, and sleeps through the typing.
 */
export const FACT = {
  valid: 1,
  dirty: 2,
  submitting: 4,
  submits: 8,
  formErrors: 16,
} as const;

/** Something watching the form itself rather than a field. `FormState` is the only implementation. */
export interface FormWatcher {
  /** Which facts this watcher's component has read — the form skips computing the rest. */
  readonly reads: number;
  bump(facts: number): void;
}

/**
 * What a `FormState` reads, declared here so this module imports nothing from `Form`.
 *
 * The `*Quietly` reads exist because the form's public getters touch its own `version` signal, which
 * inside a `@compute` or a `list()` item would tie the reader to every change in the form — see the
 * comment on `Form.read`.
 */
export interface FormFacts {
  readonly isValidQuietly: boolean;
  readonly isDirtyQuietly: boolean;
  readonly isSubmittingQuietly: boolean;
  readonly submitCountQuietly: number;
  readonly formErrorsQuietly: readonly string[];
  submit(event?: Event): void;
  reset(): void;
  watchForm(watcher: FormWatcher): void;
  unwatchForm(watcher: FormWatcher): void;
}

/**
 * How a descendant finds the form, with nothing passed down.
 *
 * A context rather than a prop, and the form publishes it ITSELF — `Form` mounts the provider with
 * `this.use(FormProvider, …)`, which puts the channel on the OWNING component's context, where every
 * descendant inherits it. The router does the same thing with its route state, and it is the one way
 * available: `GLOBAL_RUNTIME` is internal to `@ramonda/core`, so this package cannot reach
 * `owner.context` by hand.
 *
 * Two forms NESTED behave correctly and for free: contexts are prototype-chained per component, so the
 * inner one shadows the outer for everything inside it.
 *
 * Two forms SIDE BY SIDE are two components, and core refuses the alternative — a second `Form` on one
 * component would publish over the first and hand every descendant the second whichever form's markup
 * it is in (RMD056). So a form owns a component, and two of them are two scopes: a component that
 * renders `this.props.children` gives its form the subtree it is for, which is what makes a plain
 * `this.use(FormState)` below it unambiguous with nothing passed down.
 *
 * The value is the form itself and its identity never changes, so the context is only a way to FIND
 * the form — a consumer subscribing to the `form` key is subscribing to something that never moves.
 * Everything reactive goes through `watchForm`.
 *
 * Not `optional`, deliberately: a `FormState` with no form above it is a fault, and core reports it as
 * RMD003 when the component mounts, naming the label below. That is a diagnostic this package gets
 * without writing one.
 */
const [FormProvider, FormConsumer] = createContext<{ form: FormFacts | undefined }>(
  { form: undefined },
  { label: "RamondaForm" },
);

export { FormProvider };

/**
 * The form itself — what it is doing, not what any one field holds.
 *
 * ```tsx
 * class SaveButton extends Component {
 *   private form = this.use(FormState);
 *
 *   render(): RamondaNode {
 *     return (
 *       <button disabled={!this.form.isValid || this.form.isSubmitting}>
 *         {this.form.isSubmitting ? "Saving…" : "Save"}
 *       </button>
 *     );
 *   }
 * }
 * ```
 *
 * **No props.** The form publishes itself on the context, so this works anywhere below the component
 * that owns it — however deep, and through layouts that know nothing about forms.
 *
 * ## Why a component rather than a read on the form
 *
 * `<button disabled={!this.form.isValid}>` written in the owner's render is what makes the owner
 * re-render on every keystroke: reading a form getter inside a `@compute` body ties that body to the
 * form's counter, and the owner is woken by it regardless. Moving the button into its own component
 * with this hook is what lets the owner read NOTHING off the form — and then its render can be a
 * `@compute` that is built once and reused for the life of the form.
 *
 * ## What wakes it
 *
 * The facts it READ, and only when the answer actually moved. Validity that was false and is false
 * again wakes nobody; a submit starting or ending does. `isDirty` is the one to know about: it is a
 * comparison of the whole value against the baseline, so the form computes it only while something is
 * watching it.
 */
export class FormState extends Hook implements FormWatcher {
  /**
   * The subscription. `@state` on a hook holds the OWNING component's rebuild, so incrementing this
   * wakes exactly the component that used the hook — the same mechanism `Field` runs on.
   */
  @state private version = 0;

  private found = this.use(FormConsumer);

  /**
   * Which facts this component has read, never cleared.
   *
   * Sound for the reason `Field.reads` records: reading a fact for the first time takes a render, and
   * that render came from something already subscribed or from the component's own state, so a fact
   * that is not in here cannot be affecting what is on screen.
   */
  reads = 0;

  bump(facts: number): void {
    if ((facts & this.reads) === 0) return;
    this.version++;
  }

  /**
   * Registered on the first READ, and re-registered whenever the mask grows.
   *
   * Not from `@created`, and that is the whole story of one bug: a `@created` defaults to
   * `env: "shared"`, and core skips a shared create during hydration because it already ran on the
   * server. So on a page that arrived as markup this hook registered with nobody, silently, and a save
   * button never heard that validity had flipped. Registering from a read has no such hole — the read
   * happens in the render, on whichever side is rendering.
   *
   * Re-registering as the mask grows is what keeps the form's record of "the answers as last published"
   * honest: `watchForm` brings it up to date for the facts now being watched, so the first change after
   * a new fact is read is compared against the truth rather than against a default.
   */
  private synced = -1;

  private facts(): FormFacts | undefined {
    const form = this.form;
    if (form !== undefined && this.synced !== this.reads) {
      this.synced = this.reads;
      form.watchForm(this);
    }
    return form;
  }

  @destroyed
  detach(): void {
    this.form?.unwatchForm(this);
  }

  /** `undefined` only with no form above, which core has already reported as RMD003. */
  private get form(): FormFacts | undefined {
    return this.found.form;
  }

  /** What the panel shows, read without subscribing — describing must not change behaviour. */
  [INSPECT](): Record<string, unknown> {
    const form = this.form;
    if (form === undefined) return { form: "(no form above this component)" };
    return {
      isValid: form.isValidQuietly,
      isSubmitting: form.isSubmittingQuietly,
      submitCount: form.submitCountQuietly,
      formErrors: form.formErrorsQuietly,
      watching: Object.entries(FACT)
        .filter(([, bit]) => (this.reads & bit) !== 0)
        .map(([name]) => name),
    };
  }

  get isValid(): boolean {
    void this.version;
    this.reads |= FACT.valid;
    return this.facts()?.isValidQuietly ?? false;
  }

  /** A comparison of the whole value against the baseline — the form runs it only while it is read. */
  get isDirty(): boolean {
    void this.version;
    this.reads |= FACT.dirty;
    return this.facts()?.isDirtyQuietly ?? false;
  }

  get isSubmitting(): boolean {
    void this.version;
    this.reads |= FACT.submitting;
    return this.facts()?.isSubmittingQuietly ?? false;
  }

  get submitCount(): number {
    void this.version;
    this.reads |= FACT.submits;
    return this.facts()?.submitCountQuietly ?? 0;
  }

  /** Messages with no field of their own: a schema failure at the root. */
  get formErrors(): readonly string[] {
    void this.version;
    this.reads |= FACT.formErrors;
    return this.facts()?.formErrorsQuietly ?? NO_MESSAGES;
  }

  /**
   * Submits, exactly as the form would.
   *
   * Here so a button outside the `<form>` element — a toolbar, a dialog footer — can submit it without
   * the owner passing a handler down. Pass the event when there is one: it is what tells the form which
   * element to look in for the first invalid field.
   */
  submit(event?: Event): void {
    this.form?.submit(event);
  }

  /**
   * Back to the defaults.
   *
   * No-argument only. `reset(values)` needs the schema's input type, which a hook that knows nothing
   * about the schema cannot supply — that one goes through the form itself.
   */
  reset(): void {
    this.form?.reset();
  }
}
