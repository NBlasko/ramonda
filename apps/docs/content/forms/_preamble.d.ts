// A signup form and a contacts list — the two shapes the form pages teach with — plus the pieces a
// schema is written from. `f` is the field tree, which every example on these pages reaches into.
export {};

declare global {
  /** The value about to be written, in a `@watchProp` or a setter example. */
  const next: any;

  interface Signup {
    email: string;
    password: string;
    confirm: string;
    name: string;
    nick: string;
    theme: string;
    tags: string[];
    address: { city: string; street: string };
    contacts: Contact[];
  }
  interface Contact {
    kind: "email" | "phone";
    value: string;
  }
  interface Profile {
    contacts: Contact[];
  }
  class ColourPicker extends Component<any> {
    [key: string]: any;
    render(): any;
  }

  /** The reader's schema, and the defaults it is parsed against. */
  const schema: StandardSchemaV1<Signup, Signup>;
  const signupSchema: StandardSchemaV1<Signup, Signup>;
  const personalSchema: StandardSchemaV1<Signup, Signup>;
  const businessSchema: StandardSchemaV1<Signup, Signup>;
  const DEFAULTS: Signup;
  const BLANK: Signup;

  /**
   * The field tree a `Form` hands back — `f.email.$.bind`, `f.tags.$.rows`.
   *
   * Shaped rather than `any`, and the reason is `list()`: with `each: any` it infers its item type
   * as `unknown`, so every `render: (row) => row.field` in these pages reported `row` as unknown —
   * about a type the example never wrote. Typed, the rows are rows.
   */
  interface DocRow {
    id: string;
    field: DocField;
    remove(): void;
  }
  type DocField = { readonly $: DocFieldApi } & { [key: string]: DocField } & ((...args: any[]) => DocField);
  interface DocFieldApi {
    /** Open on purpose: the exact shape of the field API is not what these pages are checking, and
     *  chasing every member here would make the preamble a second copy of the real type. */
    [key: string]: any;
    rows: DocRow[];
    bind: Record<string, any>;
    error?: string;
    errors: string[];
    value: any;
    touched: boolean;
    dirty: boolean;
    set(value: any): void;
    add(value?: any): void;
  }
  const f: DocField;

  /** The two other things a `Form` is built with, named in every example on these pages. */
  const defaultValues: Signup;
  const onSubmit: (values: Signup) => void;

  const ctx: {
    ref(path: string): unknown;
    ref<T, V>(pick: (root: T) => V): V;
    sibling(name: string): unknown;
    sibling<T, V>(pick: (parent: T) => V): V;
    addIssue(expected: string, received: unknown, key: string): void;
    path: (string | number)[];
  };
  const keyFromRuntime: string;
  const register: (name: string) => Record<string, unknown>;
}
