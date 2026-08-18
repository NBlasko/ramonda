import { Component } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { describe, expect, test } from "vitest";
import { Form } from "../Form";
import type { FieldApi, InferIn, InferOut, StandardSchemaV1 } from "../types";

/**
 * The type-level contract. Almost all of this is checked by `pnpm check-types` rather
 * than by running — it fails by not compiling.
 *
 * Negative cases carry `@ts-expect-error`, so the file fails if an error STOPS happening
 * as much as if one starts: an unused directive is itself an error.
 */

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
declare function expectType<T>(): <U>(u: U & Equals<T, U> extends true ? U : never) => void;
/** The parameter is never passed; it exists so `T` has a use and the linter can see it. */
declare function assertType<T extends true>(proof?: T): void;

/**
 * A schema whose input and output genuinely differ, which is what
 * `coerceNumber().default(1)` produces.
 *
 * `contacts: { kind, value }` is here on purpose. `value` is the name that broke a flat
 * field API, so it stays as the regression case for the decision to put everything
 * behind `$`.
 */
interface SignupIn {
  email: string;
  password: string;
  confirm: string;
  age: number;
  agree: boolean;
  born: Date;
  address: { street: string; city: string };
  tags: string[];
  contacts: { kind: string; value: string }[];
  page?: unknown;
}

interface SignupOut extends Omit<SignupIn, "page"> {
  page: number;
}

declare const signup: StandardSchemaV1<SignupIn, SignupOut>;
declare const defaults: SignupIn;

assertType<Equals<InferIn<typeof signup>, SignupIn>>();
assertType<Equals<InferOut<typeof signup>, SignupOut>>();

/* ---------------------------------------------------------------- *
 * 1. The call site, in every shape a real app writes.
 * ---------------------------------------------------------------- */

class Signup extends Component {
  declare seed: SignupIn;

  save(values: SignupOut): void {
    void values;
  }

  /** A. A bag of constants with a bound method — it reads no signal, so it is built once. */
  form = this.use(Form, () => ({
    schema: signup,
    defaultValues: defaults,
    onSubmit: this.save,
  }));

  /** B. Pinned with an instantiation expression. */
  pinned = this.use(Form<typeof signup>, () => ({
    schema: signup,
    defaultValues: defaults,
    onSubmit: this.save,
  }));

  /** C. The callback form, for defaults that come from props. */
  fromProps = this.use(Form, (self: Signup) => ({
    schema: signup,
    defaultValues: self.seed,
    onSubmit: self.save,
  }));

  /**
   * D. Inline and unannotated, UNPINNED — the ONE shape that needs help.
   *
   * The props type is inferred FROM the literal, so a context-sensitive property inside
   * that same literal has no target to be typed against and its parameter is an implicit
   * `any`. The hook itself still resolves correctly, which `callSites` asserts. Exactly
   * the limitation `Query` documents.
   */
  inlineBare = this.use(Form, () => ({
    schema: signup,
    defaultValues: defaults,
    // @ts-expect-error - `values` is an implicit any here, and only here
    onSubmit: (values) => void values,
  }));

  /** E. The same, pinned: the pin gives the literal a target, so the parameter is typed. */
  inlinePinned = this.use(Form<typeof signup>, () => ({
    schema: signup,
    defaultValues: defaults,
    onSubmit: (values) => {
      expectType<SignupOut>()(values);
    },
  }));

  /**
   * F. A handler that drops its parameter entirely. Accepted, unpinned.
   *
   * Worth a case of its own because it is the shape a hand-written stub of `use` gets
   * WRONG: with `HookClassKind`'s first parameter as `never` rather than `Runtime`, the
   * props literal wins the inference and a one-parameter declaration stops being
   * assignable to a zero-parameter call site. Against the real `use` it is fine, and this
   * case is here so that stays true.
   */
  ignoresBare = this.use(Form, () => ({
    schema: signup,
    defaultValues: defaults,
    onSubmit: () => {},
  }));

  /** G. The same, pinned. */
  ignoresPinned = this.use(Form<typeof signup>, () => ({
    schema: signup,
    defaultValues: defaults,
    onSubmit: () => {},
  }));

  /** H. Unused but written and annotated — works with no pin. */
  unusedAnnotated = this.use(Form, () => ({
    schema: signup,
    defaultValues: defaults,
    onSubmit: (_values: SignupOut) => {},
  }));

  /** I. Unused but written, unannotated — works because the pin supplies the type. */
  unusedPinned = this.use(Form<typeof signup>, () => ({
    schema: signup,
    defaultValues: defaults,
    onSubmit: (_values) => {},
  }));

  render(): RamondaNode {
    return <form />;
  }

  callSites(): void {
    expectType<SignupIn>()(this.form.values);
    expectType<SignupIn>()(this.pinned.values);
    expectType<SignupIn>()(this.fromProps.values);
    expectType<SignupIn>()(this.unusedAnnotated.values);
    expectType<SignupIn>()(this.unusedPinned.values);
    expectType<SignupIn>()(this.inlineBare.values);
    expectType<SignupIn>()(this.inlinePinned.values);
    expectType<SignupIn>()(this.ignoresBare.values);
    expectType<SignupIn>()(this.ignoresPinned.values);
  }

  /* -------------------------------------------------------------- *
   * 2. Navigation, and the API behind `$`.
   * -------------------------------------------------------------- */
  navigate(): void {
    const f = this.form.fields;

    expectType<string>()(f.email.$.value);
    expectType<string | undefined>()(f.email.$.error);
    expectType<readonly string[]>()(f.email.$.errors);
    expectType<boolean>()(f.email.$.touched);
    expectType<string>()(f.address.street.$.value);
    expectType<string | undefined>()(f.address.city.$.error);
    expectType<string>()(f.address.$.path);

    f.email.$.set("a@b.c");
    f.age.$.set(3);
    f.address.street.$.set("Knez Mihailova");
  }

  /**
   * The handle, which is what `$` buys beyond avoiding collisions: the API is one object,
   * so a field read several times is named once and a shared component takes a `FieldApi`.
   */
  handle(): void {
    const email: FieldApi<string> = this.form.fields.email.$;
    expectType<string>()(email.value);
    expectType<string | undefined>()(email.error);

    const { value, error } = this.form.fields.password.$;
    expectType<string>()(value);
    expectType<string | undefined>()(error);
  }

  /* -------------------------------------------------------------- *
   * 3. bind, chosen by the value's type.
   * -------------------------------------------------------------- */
  binds(): void {
    const f = this.form.fields;

    expectType<string>()(f.email.$.bind.value);
    expectType<string>()(f.email.$.bind.name);
    expectType<boolean>()(f.agree.$.bind.checked);
    expectType<"checkbox">()(f.agree.$.bind.type);
    expectType<"number">()(f.age.$.bind.type);
    expectType<"date">()(f.born.$.bind.type);
  }

  /* -------------------------------------------------------------- *
   * 4. Arrays — of primitives, and of objects carrying the colliding name.
   * -------------------------------------------------------------- */
  arrays(): void {
    const f = this.form.fields;

    expectType<number>()(f.tags.$.length);
    expectType<string>()(f.tags.$.rows[0].id);
    expectType<number>()(f.tags.$.rows[0].index);
    expectType<string>()(f.tags[0].$.value);
    expectType<string>()(f.tags.$.rows[0].field.$.bind.value);
    f.tags.$.append("new");
    f.tags.$.insert(0, "first");
    f.tags.$.remove(1);

    // The shape that broke a flat API. Here `value` is just a property again.
    expectType<string>()(f.contacts[0].kind.$.value);
    expectType<string>()(f.contacts[0].value.$.value);
    expectType<string | undefined>()(f.contacts[0].value.$.error);
    expectType<string>()(f.contacts.$.rows[0].field.value.$.value);
    f.contacts.$.append({ kind: "email", value: "a@b.c" });
  }

  /* -------------------------------------------------------------- *
   * 5. The escape hatch.
   * -------------------------------------------------------------- */
  escape(): void {
    expectType<string>()(this.form.fields.address.$.at("street").$.value);
  }

  /* -------------------------------------------------------------- *
   * 6. What must NOT type-check.
   * -------------------------------------------------------------- */
  negatives(): void {
    const f = this.form.fields;

    // @ts-expect-error - no such field
    void f.emial;

    // @ts-expect-error - a string field cannot be set to a number
    f.email.$.set(3);

    // @ts-expect-error - a string leaf has no children
    void f.email.street;

    // @ts-expect-error - an object node carries no `bind`
    void f.address.$.bind;

    // @ts-expect-error - an array node carries no `bind`
    void f.tags.$.bind;

    // @ts-expect-error - a text bind has no `checked`
    void f.email.$.bind.checked;

    // @ts-expect-error - a checkbox bind has no `value`
    void f.agree.$.bind.value;

    // @ts-expect-error - wrong element type appended
    f.tags.$.append(3);

    // @ts-expect-error - `values` holds the INPUT side, not the output
    expectType<SignupOut>()(this.form.values);

    // @ts-expect-error - the API is behind `$`, so a leaf has nothing else on it
    void f.email.value;
  }
}

/* ---------------------------------------------------------------- *
 * 7. The one collision left: a schema property actually named `$`.
 * ---------------------------------------------------------------- */

interface Colliding {
  ok: string;
  nested: { $: string; other: number };
}
declare const colliding: StandardSchemaV1<Colliding, Colliding>;
declare const collidingDefaults: Colliding;

class Awkward extends Component {
  form = this.use(Form<typeof colliding>, () => ({
    schema: colliding,
    defaultValues: collidingDefaults,
    onSubmit: (_values) => {},
  }));

  render(): RamondaNode {
    return <form />;
  }

  probe(): void {
    // The uncolliding sibling is unaffected.
    expectType<string>()(this.form.fields.ok.$.value);

    // @ts-expect-error - `nested` has a property named `$`, so the whole node is refused
    void this.form.fields.nested.other;
  }
}

/* ---------------------------------------------------------------- *
 * The runtime half, which is thin on purpose.
 * ---------------------------------------------------------------- */

describe("the form's type surface", () => {
  test("Form is exported as a value, which is what makes `this.use(Form, …)` legal", () => {
    // A type-only export would leave every call site above compiling and every one of them
    // failing at runtime, and nothing in a `check-types` run would notice.
    expect(typeof Form).toBe("function");
    expect(Object.getOwnPropertyNames(Form.prototype)).toContain("submit");
  });

  test("the classes in this file are only ever type-checked", () => {
    // Named so the reason is in the output rather than in a comment nobody reads: this
    // file's value is that it COMPILES. What the members DO is covered by the behaviour
    // suites next to it.
    expect(Signup.name).toBe("Signup");
    expect(Awkward.name).toBe("Awkward");
  });
});
