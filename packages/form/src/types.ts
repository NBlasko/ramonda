/**
 * The shape of a form, as types.
 *
 * This file is the package's contract, and it was settled against `tsc` before any
 * runtime existed — every claim in the comments below is something the type tests in
 * `__tests__/Types.test.tsx` fail without.
 */

/* ------------------------------------------------------------------ *
 * Standard Schema — the validation contract.
 * ------------------------------------------------------------------ */

/**
 * The Standard Schema v1 interface, vendored rather than depended on, which is what the
 * spec intends: it is a contract between libraries, not a runtime package.
 *
 * Taking this as the contract is what makes the package validator-agnostic. bguard
 * implements it, so it works with no adapter of any kind; so do zod, valibot and
 * arktype.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    /**
     * A promise only when the schema carries async validations, chosen per call — the
     * spec allows either, so a form that never awaits keeps working for every
     * synchronous schema.
     */
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
    /** Type-only: carries the input and output types and is never present at runtime. */
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

export type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardIssue> };

export interface StandardIssue {
  readonly message: string;
  /** Keys, with numbers for array and tuple positions. Absent means the root. */
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

/**
 * What the form HOLDS: what the user types, before the schema converts anything.
 *
 * Read off `~standard.types` rather than inferred with a conditional, because the input
 * and the output both sit inside one optional property — a conditional has to supply a
 * value for whichever it is not inferring, and `never` there collapses the other side.
 */
export type InferIn<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["input"];

/**
 * What `onSubmit` RECEIVES: coerced, defaulted, narrowed.
 *
 * The split is the point. A number input yields a string, and `coerceNumber().default(1)`
 * makes a property optional going in and present coming out — so the values a form holds
 * and the values it submits are genuinely different types, and conflating them is how a
 * handler ends up doing arithmetic on a string.
 */
export type InferOut<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["output"];

/* ------------------------------------------------------------------ *
 * The field API, and the one name it costs.
 * ------------------------------------------------------------------ */

declare const COLLISION: unique symbol;

/**
 * What an object node becomes when its schema has a property named `$`.
 *
 * The explanation rides as a type argument so TypeScript prints it: the error reads
 * `Property 'x' does not exist on type 'Collision<"this object has a property…">'`
 * rather than the bare type name.
 */
export interface Collision<
  Because extends
    string = "this object has a property named '$', which the field API owns — reach it with .$.at('$') or rename it",
> {
  readonly [COLLISION]: Because;
}

/**
 * Everything a field carries, whatever its shape.
 *
 * ## Why it all sits behind `$`
 *
 * Navigation is property access — `form.fields.address.street` — so every name the API
 * puts on a node is a name the schema may not use. A flat API was written first and
 * measured against an ordinary shape:
 *
 * ```ts
 * contacts: { kind: string; value: string }[]
 * ```
 *
 * `value` collided, and `name` and `error` are just as common. Prefixing each of them
 * instead (`$value`, `$error`, …) also type-checks — it was built and run against the
 * same tests — but it costs more in two ways. On a schema of five levels and eight
 * properties, measured three times identically: **1746 type instantiations against 2645**,
 * because behind `$` the API is a lazy property and walking THROUGH a node never
 * instantiates it, while a flattened API is intersected into every node on the path.
 *
 * And it takes the handle away. `const email = form.fields.email.$` reads `email.value`
 * and `email.error` with no prefix at all, and a shared field component takes a
 * `FieldApi<string>` — neither is possible when the node and the API are one object.
 */
export interface FieldApi<T> {
  /** The value as HELD — the input side, so a number input reads a string here. */
  readonly value: T;
  /** The first message, which is what a field renders. */
  readonly error: string | undefined;
  readonly errors: readonly string[];
  readonly touched: boolean;
  readonly dirty: boolean;
  /** The path as the schema sees it, e.g. `address.street` or `contacts[2].value`. */
  readonly path: string;
  /** The `name` attribute, which is `path` — named for how it reads at a call site. */
  readonly name: string;
  set(next: T): void;
  reset(): void;
  /** Escape hatch: a property named `$`, or a key not known until runtime. */
  at<K extends keyof NonNullable<T> & string>(key: K): FieldNode<NonNullable<T>[K]>;
}

/* ------------------------------------------------------------------ *
 * bind — the attributes for the control this value belongs in.
 * ------------------------------------------------------------------ */

export interface CommonBind {
  readonly name: string;
  readonly onInput: (event: Event) => void;
  readonly onBlur: (event: Event) => void;
  readonly "aria-invalid": boolean | undefined;
}

export interface TextBind extends CommonBind {
  readonly value: string;
}
export interface NumberBind extends CommonBind {
  readonly value: number | string;
  readonly type: "number";
}
export interface CheckboxBind extends CommonBind {
  readonly checked: boolean;
  readonly type: "checkbox";
}
export interface DateBind extends CommonBind {
  readonly value: string;
  readonly type: "date";
}

/**
 * The attributes for the value's own kind of control, so `checked` and `value` cannot be
 * mixed up: a boolean field gets `checked`, a number gets `type="number"`.
 *
 * `never` for objects and lists, because no single control holds one. Which element the
 * attributes are spread ONTO is not something a type can see — `<select {...bind} />`
 * type-checks — so that belongs to the `check` package as a lint rule rather than here.
 */
export type Bind<T> = [NonNullable<T>] extends [boolean]
  ? CheckboxBind
  : [NonNullable<T>] extends [number]
    ? NumberBind
    : [NonNullable<T>] extends [Date]
      ? DateBind
      : [NonNullable<T>] extends [string]
        ? TextBind
        : never;

/* ------------------------------------------------------------------ *
 * The three node kinds.
 * ------------------------------------------------------------------ */

export interface LeafApi<T> extends FieldApi<T> {
  readonly bind: Bind<T>;
}

/** One row of an array field, carrying the identity the row keeps across a splice. */
export interface Row<E> {
  /**
   * Stable for the life of the row — survives insert, remove and reorder.
   *
   * Generated ids held in a parallel array and spliced alongside the data, rather than
   * derived from it: a WeakMap cannot key a primitive, and `["a", "b", "a"]` has no
   * identity of its own to borrow. An index is not an identity either — remove row 0 and
   * every error below it slides onto the wrong row.
   */
  readonly id: string;
  readonly index: number;
  readonly field: FieldNode<E>;
}

export interface ArrayApi<E, T> extends FieldApi<T> {
  readonly length: number;
  /**
   * The rows, for `list({ each: …, key: (row) => row.id })`.
   *
   * One identity per structural change rather than per render: `list()`'s `each` is what
   * RMD020 compares, and a rebuilt array loses every row's identity — the exact failure
   * `id` exists to prevent.
   */
  readonly rows: readonly Row<E>[];
  append(item: E): void;
  insert(index: number, item: E): void;
  remove(index: number): void;
}

export interface LeafNode<T> {
  readonly $: LeafApi<T>;
}

/** Children are reached by index, which cannot collide with `$`. */
export interface ArrayNode<E, T> {
  readonly $: ArrayApi<E, T>;
  readonly [index: number]: FieldNode<E>;
}

export type ObjectNode<T> = "$" extends keyof NonNullable<T>
  ? Collision
  : { readonly $: FieldApi<T> } & { readonly [K in keyof NonNullable<T>]-?: FieldNode<NonNullable<T>[K]> };

type Scalar = string | number | boolean | bigint | Date | File | null | undefined;

/**
 * Picks the node kind from the value's shape.
 *
 * Order matters: `Date` and `File` are objects, so `Scalar` is tested before the object
 * branch, or a date field would sprout `getTime` as a child.
 *
 * Named `FieldNode` rather than `Node` because `Node` is a DOM global, and a public type
 * that shadows one is a type nobody can read in an error message.
 */
export type FieldNode<T> = [NonNullable<T>] extends [Scalar]
  ? LeafNode<T>
  : NonNullable<T> extends ReadonlyArray<infer E>
    ? ArrayNode<E, T>
    : NonNullable<T> extends object
      ? ObjectNode<T>
      : LeafNode<T>;

/* ------------------------------------------------------------------ *
 * The hook's props.
 * ------------------------------------------------------------------ */

/** When a field validates for the first time. It always revalidates once it has an error. */
export type ValidateOn = "change" | "blur" | "submit";

export interface FormProps<S extends StandardSchemaV1> {
  schema: S;
  /** What the form holds before validation — the INPUT side of the schema. */
  defaultValues: InferIn<S>;
  /**
   * Receives the OUTPUT side: coerced, defaulted, and only ever called when valid.
   *
   * **One parameter, by choice rather than by constraint.** A second `ctx` argument was
   * measured and works; `setError` and `reset` sit on the form instead because a class
   * component always has `this.form` in scope, so a context object would be a second way
   * to reach what is already reachable. (The React libraries pass one because a function
   * component has no instance to reach for.)
   *
   * A handler may drop the parameter entirely — `onSubmit: () => {}` type-checks.
   */
  onSubmit: (values: InferOut<S>) => void | Promise<void>;
  validateOn?: ValidateOn;
}

/**
 * ## Why there is no `revalidateAll` option
 *
 * There was one, declared here and documented, as the escape hatch for a form big enough that
 * running the whole schema on a keystroke would hurt. **It was never read** — `revalidate()`
 * always ran the whole schema — so it was an option that did nothing, which is worse than an
 * option that is missing.
 *
 * It is gone rather than implemented, because the case it was reserved for does not exist.
 * Measured on a bguard schema with a `custom` per field plus one cross-field rule: 11 fields
 * 3.3 µs, 31 fields 14.9 µs, 101 fields 48.3 µs, 301 fields 154.8 µs. A three-hundred-field
 * form revalidates in a hundredth of a 60fps frame.
 *
 * And the whole-form pass is what makes a cross-field rule correct: bguard writes "the
 * passwords match" on `confirm` as a `custom` that reads `password` through `ctx.ref`, so
 * editing PASSWORD has to re-answer CONFIRM. A field-local pass cannot see that.
 * `@ramonda/form/bguard` records the reasoning that was going to make one safe, and why the
 * fast path was not worth its hazards.
 */
