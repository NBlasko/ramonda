import { panelRegistry } from "./devtoolsPanel";
import type { PanelPlugin, PanelRow, PanelSnapshot, RowField } from "./devtoolsPanel";

/**
 * The Forms tab — a separate entry, imported only by an app that wants it.
 *
 * ```ts
 * if (import.meta.env.DEV) {
 *   void import("@ramonda/devtools");
 *   void import("@ramonda/form/devtools");
 * }
 * ```
 *
 * ## How it learns about forms, without `Form` knowing about it
 *
 * An EVENT. `Form` announces itself arriving and leaving with one guarded line each, and that is
 * the whole of what the main entry carries — no list, no import of this module, nothing on the
 * class. This module listens and keeps the list.
 *
 * The same shape core uses for `ramonda:tick`, and it is what keeps the dependency pointing one
 * way: a form does not know whether anybody is watching. If nothing is, the events go nowhere.
 *
 * Importing this module registers the tab. There is nothing to call.
 */

/**
 * What a live form has to be able to answer.
 *
 * Deliberately narrow, and narrower than `Form` itself: the panel can read what is on screen and
 * ask for a reset or a submit, and it cannot reach a schema, a field tree or an instance. Written
 * as an interface rather than importing `Form` so that what the panel is trusted with is visible in
 * one place.
 */
export interface InspectableForm {
  readonly values: unknown;
  readonly formErrors: readonly string[];
  readonly isValid: boolean;
  readonly isDirty: boolean;
  readonly isSubmitting: boolean;
  readonly submitCount: number;
  /** Field path → the messages against it, already in the form the app would print. */
  fieldErrors(): Map<string, readonly string[]>;
  /** Which fields have been blurred, and which have been edited. */
  interaction(): { touched: readonly string[]; changed: readonly string[] };
  reset(): void;
  submit(): void;
  /** Bumped on every change — what tells the panel the values moved. */
  readonly revision: number;
}

const forms: { id: number; name: string; form: InspectableForm; key: object }[] = [];
let nextId = 1;

/**
 * A form arriving, as an event.
 *
 * Numbered here rather than in the form, because the number is a panel concern: a hook cannot see
 * the component that used it — `this.constructor.name` is `Form` for every one of them — so the
 * order they mounted in is the only handle a reader gets. Finding WHICH one a row is is what the
 * value tree is for.
 */
window.addEventListener("ramonda:form", (event) => {
  const detail = (event as CustomEvent<{ form: object; key: object; readable: (key: string) => string }>).detail;
  if (!detail) return;
  const id = nextId++;
  forms.push({ id, name: `Form ${id}`, form: view(detail.form, detail.readable), key: detail.key });
});

/**
 * What a `Form` looks like from here.
 *
 * Its own members, read through a cast: a `private` in TypeScript is a compile-time rule, so the
 * fields are ordinary properties at runtime and this module is allowed to know them. Built HERE
 * rather than on the class, because a method that builds it would ship — a class member cannot be
 * tree-shaken, whatever guard surrounds its call.
 *
 * Getters rather than a copy: it is read on every poll and must answer for the form as it is now.
 */
function view(instance: object, readable: (key: string) => string): InspectableForm {
  const form = instance as unknown as {
    current: unknown;
    formErrors: readonly string[];
    isValid: boolean;
    isDirty: boolean;
    submitting: boolean;
    submits: number;
    version: number;
    issues: Map<string, readonly string[]>;
    touchedKeys: Set<string>;
    changedKeys: Set<string>;
    reset: () => void;
    submit: () => void;
  };

  return {
    get values() {
      return form.current;
    },
    get formErrors() {
      return form.formErrors;
    },
    get isValid() {
      return form.isValid;
    },
    get isDirty() {
      return form.isDirty;
    },
    get isSubmitting() {
      return form.submitting;
    },
    get submitCount() {
      return form.submits;
    },
    get revision() {
      return form.version;
    },
    fieldErrors: () => new Map([...form.issues].map(([key, messages]) => [readable(key), messages])),
    interaction: () => ({
      touched: [...form.touchedKeys].map(readable),
      changed: [...form.changedKeys].map(readable),
    }),
    reset: () => form.reset(),
    submit: () => form.submit(),
  };
}

window.addEventListener("ramonda:form-gone", (event) => {
  const key = (event as CustomEvent<{ key: object }>).detail?.key;
  const at = forms.findIndex((entry) => entry.key === key);
  if (at !== -1) forms.splice(at, 1);
});

function formsPanel(): PanelPlugin {
  return {
    version: 1,
    id: "forms",
    label: "FORMS",

    snapshot(): PanelSnapshot {
      return {
        empty: "No forms are mounted. This tab fills in when a component uses Form.",
        groups: forms.map((entry) => ({ rows: rowsFor(entry) })),
      };
    },

    run(rowId, actionId) {
      const entry = forms.find((candidate) => String(candidate.id) === rowId.split("::")[0]);
      if (!entry) return "that form is no longer mounted";

      if (actionId === "reset") {
        entry.form.reset();
        return `reset ${entry.name}`;
      }
      // A real submit, validation and `onSubmit` included — which is the point: the panel is asking
      // the app to do what the button does, not simulating it.
      entry.form.submit();
      return `submitted ${entry.name}`;
    },
  };
}

function rowsFor(entry: { id: number; name: string; form: InspectableForm }): PanelRow[] {
  const form = entry.form;
  const errors = form.fieldErrors();
  const { touched, changed } = form.interaction();

  const summary: PanelRow = {
    id: `${entry.id}::form`,
    title: entry.name,
    status: form.isSubmitting ? "busy" : form.isValid ? "ok" : "error",
    fields: fieldsFor(form, errors.size, touched.length, changed.length),
    // The form-level messages — a cross-field rule, or whatever `setError(ROOT)` put there. Field
    // messages get rows of their own below.
    error: form.formErrors.length > 0 ? form.formErrors.join(" · ") : undefined,
    value: {
      data: form.values,
      revision: form.revision,
      /**
       * Read-only, and the reason is the schema.
       *
       * A form's values are the schema's INPUT side — a `Date`, a `File`, a class instance — so a
       * value typed as JSON could not be put back without either lying about its type or running a
       * parse the schema owns. `reset` is the honest write: it goes through the form and the form
       * revalidates.
       */
      editable: false,
    },
    actions: [
      { id: "reset", label: "reset", title: "put the form back to its defaults" },
      { id: "submit", label: "submit", title: "validate and run onSubmit, exactly as the button does" },
    ],
  };

  // One row per field that is actually wrong. A valid form is a single line — the tab is for
  // finding what is broken, and a list of every field would bury it.
  const broken: PanelRow[] = [...errors].map(([path, messages]) => ({
    id: `${entry.id}::${path}`,
    title: path,
    code: true,
    status: "error" as const,
    error: messages.join(" · "),
    fields: [{ kind: "text" as const, text: describeInteraction(path, touched, changed) }],
  }));

  return [summary, ...broken];
}

function fieldsFor(form: InspectableForm, errorCount: number, touched: number, changed: number): RowField[] {
  const fields: RowField[] = [
    {
      kind: "text",
      text: errorCount === 0 ? "valid" : `${errorCount} field${errorCount === 1 ? "" : "s"} with errors`,
    },
    { kind: "text", text: `${touched} touched · ${changed} edited` },
  ];

  if (form.isDirty) fields.push({ kind: "badge", text: "dirty" });
  if (form.isSubmitting) fields.push({ kind: "badge", text: "submitting…", tone: "warn" });
  if (form.submitCount > 0) {
    fields.push({ kind: "text", text: `${form.submitCount} submit${form.submitCount === 1 ? "" : "s"}` });
  }

  return fields;
}

/**
 * Why a field is showing an error yet — blurred, edited, or neither.
 *
 * It answers the question people actually ask of a form: "it says this is required and I have not
 * touched it". A message on an untouched field is usually `validateOn: "submit"` doing its job, and
 * saying so is quicker than working it out.
 */
function describeInteraction(path: string, touched: readonly string[], changed: readonly string[]): string {
  const parts: string[] = [];
  if (touched.includes(path)) parts.push("blurred");
  if (changed.includes(path)) parts.push("edited");
  return parts.length > 0 ? parts.join(" · ") : "never interacted with";
}

// Importing this module is what registers the tab. There is nothing to call.
panelRegistry().register(formsPanel());
