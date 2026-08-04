/**
 * The Forms tab, described for `@ramonda/devtools`.
 *
 * ## Why a form needs a tab at all, when the inspector already shows it
 *
 * A form answers `[INSPECT]()`, so its values and errors already appear on its row in the
 * Components tree. That is the right place to look when you are asking about ONE form you have
 * already found. A tab answers a different question: which forms are live on this page, which of
 * them is invalid, and what exactly is wrong — without hunting through the tree for each.
 *
 * ## Why the row is the form and not the field
 *
 * The obvious shape is a row per field, and it is wrong here: the actions a form has — reset,
 * submit — belong to the WHOLE form, and a contract's actions live on a row. A row per field would
 * have put "reset" on every one of them, meaning the same thing each time.
 *
 * So the form is the row, its values are its value (openable and editable through the panel's own
 * tree), and each field that is actually wrong gets a row of its own underneath. A clean form is
 * one line; a broken one says how it is broken and nothing more.
 *
 * ## The contract, duplicated rather than imported
 *
 * Same reason as `@ramonda/query`: a form package that depended on a devtools package would put a
 * development tool into the dependency graph of every application that ships a form. TypeScript is
 * structural, so the copy is checked at the `register` call.
 *
 * Everything here is behind `__DEV__` at its call site, so a production build strips it.
 */

type RowStatus = "ok" | "busy" | "error" | "idle";

type RowField =
  | { kind: "text"; text: string }
  | { kind: "live"; id: string; text: string }
  | { kind: "badge"; text: string; tone?: "info" | "warn" };

interface RowValue {
  data: unknown;
  preview?: string;
  editable?: boolean;
  write?: (value: unknown) => string | undefined;
  writeNote?: string;
  revision?: number | string;
}

interface PanelRow {
  id: string;
  title: string;
  code?: boolean;
  status?: RowStatus;
  fields?: RowField[];
  error?: string;
  value?: RowValue;
  actions?: { id: string; label: string; title?: string }[];
}

interface PanelSnapshot {
  groups: { label?: string; rows: PanelRow[] }[];
  empty?: string;
}

interface PanelPlugin {
  version: 1;
  id: string;
  label: string;
  snapshot(): PanelSnapshot;
  run?(rowId: string, actionId: string): string | undefined;
}

interface PanelRegistry {
  register(plugin: PanelPlugin): () => void;
  list(): PanelPlugin[];
  subscribe(listener: () => void): () => void;
}

const KEY = "__RAMONDA_PANELS__";

/** The registry, created if this package got here first — either side may load before the other. */
function panelRegistry(): PanelRegistry {
  const holder = globalThis as unknown as { [KEY]?: PanelRegistry };
  const existing = holder[KEY];
  if (existing) return existing;

  const plugins = new Map<string, PanelPlugin>();
  const listeners = new Set<() => void>();
  const announce = () => {
    for (const listener of [...listeners]) listener();
  };

  const registry: PanelRegistry = {
    register(plugin) {
      if (plugin.version !== 1) return () => {};
      plugins.set(plugin.id, plugin);
      announce();
      return () => {
        if (plugins.get(plugin.id) !== plugin) return;
        plugins.delete(plugin.id);
        announce();
      };
    },
    list() {
      return [...plugins.values()];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  holder[KEY] = registry;
  return registry;
}

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

const forms: { id: number; name: string; form: InspectableForm }[] = [];
let nextId = 1;
let registered = false;

/**
 * Adds a live form, and hands back the function that removes it.
 *
 * Called from the hook's own `@create`/`@destroy`, so the list is exactly the forms that are
 * mounted — a form on a route nobody is on cannot appear, and one that unmounted takes its row
 * with it rather than leaving a row nothing answers for.
 */
export function registerDevtoolsForm(form: InspectableForm): () => void {
  /**
   * Numbered, because a hook cannot see the component that used it — `this.constructor.name` is
   * `Form` for every one of them, which would make every row's title the same word.
   *
   * The number is the order they mounted in, and it is stable for a form's life. Finding WHICH one
   * a row is is what the value tree is for: a form's defaults name it faster than a label would.
   */
  const id = nextId++;
  const entry = { id, name: `Form ${id}`, form };
  forms.push(entry);
  install();

  return () => {
    const at = forms.indexOf(entry);
    if (at !== -1) forms.splice(at, 1);
  };
}

/**
 * Registers the tab once, the first time a form mounts.
 *
 * Not deregistered when the last form goes: the tab then says there are none, which is the truth
 * and more useful than a tab that appears and disappears as an app navigates.
 */
function install(): void {
  if (registered) return;
  registered = true;
  panelRegistry().register(formsPanel());
}

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

export { panelRegistry };
export type { PanelPlugin, PanelRegistry, PanelRow, PanelSnapshot };
