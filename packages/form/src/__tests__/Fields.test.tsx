import { describe, expect, test } from "vitest";
import { FieldTree, IS_FIELD_NODE } from "../fieldTree";
import type { Path } from "../path";
import { pathKey, readAt, writeAt } from "../path";
import type { FieldNode } from "../types";

/**
 * The field tree on its own — no hook, no runtime, no render.
 *
 * A host built from a plain object is enough to exercise every question the tree answers,
 * and it keeps these assertions about the TREE rather than about the form's state machine,
 * which has its own suite.
 */
function host(initial: unknown) {
  let values = initial;
  const touched = new Set<string>();
  const errors = new Map<string, readonly string[]>();
  const ids = new Map<string, string[]>();
  let nextId = 0;
  const writes: string[] = [];

  return {
    writes,
    get values() {
      return values;
    },
    setErrors(path: Path, messages: readonly string[]) {
      errors.set(pathKey(path), messages);
    },
    read: (path: Path) => readAt(values, path),
    write: (path: Path, next: unknown) => {
      writes.push(`${pathKey(path)}=${JSON.stringify(next)}`);
      values = writeAt(values, path, next);
    },
    errorsAt: (path: Path) => errors.get(pathKey(path)) ?? [],
    touchedAt: (path: Path) => touched.has(pathKey(path)),
    dirtyAt: () => false,
    touch: (path: Path) => {
      touched.add(pathKey(path));
    },
    resetAt: () => {},
    rowIds: (path: Path) => {
      const key = pathKey(path);
      const value = readAt(values, path);
      const length = Array.isArray(value) ? value.length : 0;
      let list = ids.get(key);
      if (!list) {
        list = [];
        ids.set(key, list);
      }
      while (list.length < length) list.push(`r${nextId++}`);
      list.length = length;
      return list;
    },
    splice: (path: Path, start: number, remove: number, insert: readonly unknown[]) => {
      const value = readAt(values, path);
      const items = Array.isArray(value) ? [...value] : [];
      items.splice(start, remove, ...insert);
      values = writeAt(values, path, items);
    },
    // The tree is exercised here WITHOUT the per-field subscriptions — the fake host watches nothing,
    // which is what keeps these assertions about the tree. `Field` has its own suite.
    watch: () => {
      throw new Error("this suite does not watch fields");
    },
    unwatch: () => {},
    move: (path: Path, from: number, to: number) => {
      const value = readAt(values, path);
      const items = Array.isArray(value) ? [...value] : [];
      items.splice(to, 0, ...items.splice(from, 1));
      values = writeAt(values, path, items);
    },
  };
}

interface Shape {
  email: string;
  agree: boolean;
  age: number;
  when: Date;
  address: { street: string; city: string };
  contacts: { kind: string; value: string }[];
}

function tree(initial: Shape) {
  const h = host(initial);
  return { h, fields: new FieldTree(h).root as FieldNode<Shape> };
}

const SEED: Shape = {
  email: "a@b.c",
  agree: false,
  age: 30,
  // Built from local parts on purpose — see the date tests, where the whole question is which
  // calendar day the reader is shown.
  when: new Date(2026, 7, 7, 1, 0, 0),
  address: { street: "Knez Mihailova", city: "Beograd" },
  contacts: [{ kind: "email", value: "x@y.z" }],
};

describe("the field tree", () => {
  test("a node has ONE identity, however it is reached", () => {
    // The whole design rests on this. A fresh node per access is a fresh `bind.oninput` per
    // access, which RMD020 reports and which really does re-attach the listener every render.
    const { fields } = tree(SEED);

    expect(fields.email).toBe(fields.email);
    expect(fields.address.street).toBe(fields.address.street);
    expect(fields.contacts[0].value).toBe(fields.contacts[0].value);
    expect(fields.address.$).toBe(fields.address.$);

    // Reached twice through different intermediate expressions, still one object.
    const viaHandle = fields.address.$.at("street");
    expect(viaHandle).toBe(fields.address.street);
  });

  test("the two handlers in `bind` keep their identity across reads", () => {
    const { fields } = tree(SEED);

    const first = fields.email.$.bind;
    const second = fields.email.$.bind;

    // The object is rebuilt — JSX flattens a spread, so only what is INSIDE is compared.
    expect(first).not.toBe(second);
    expect(first.oninput).toBe(second.oninput);
    expect(first.onblur).toBe(second.onblur);
    expect(first.name).toBe(second.name);
    expect(first.value).toBe(second.value);
  });

  test("`bind` picks the control from the value's runtime type", () => {
    const { fields } = tree(SEED);

    expect(fields.email.$.bind).toMatchObject({ name: "email", value: "a@b.c" });
    // A text field carries no `type` at all, so the element keeps whatever it declared —
    // `<input type="email" {...bind} />` stays an email input.
    expect(Object.hasOwn(fields.email.$.bind, "type")).toBe(false);
    expect(fields.agree.$.bind).toMatchObject({ type: "checkbox", checked: false });
    expect(fields.age.$.bind).toMatchObject({ type: "number", value: 30 });
    expect(fields.contacts[0].value.$.bind).toMatchObject({ name: "contacts[0].value", value: "x@y.z" });
  });

  test("`aria-invalid` appears only while there is something to report", () => {
    const { h, fields } = tree(SEED);

    expect(fields.email.$.bind["aria-invalid"]).toBeUndefined();
    h.setErrors(["email"], ["not an email"]);
    expect(fields.email.$.bind["aria-invalid"]).toBe(true);
  });

  test("a path reads the way the schema does, brackets and all", () => {
    const { fields } = tree(SEED);

    expect(fields.email.$.path).toBe("email");
    expect(fields.address.street.$.path).toBe("address.street");
    expect(fields.contacts[0].value.$.path).toBe("contacts[0].value");
    // `name` is the same string, and it is what a no-JS submit would post under.
    expect(fields.contacts[0].value.$.name).toBe("contacts[0].value");
  });

  test("`then` is not a field, so a node cannot be mistaken for a thenable", async () => {
    // Without this a node reaching a promise position — `await node`, or returning one from
    // an async function — is treated as a thenable and never settles, with nothing reported.
    const { fields } = tree(SEED);

    expect((fields as unknown as { then?: unknown }).then).toBeUndefined();
    await expect(Promise.resolve(fields.address)).resolves.toBe(fields.address);
  });

  test("nothing that inspects a node makes it build children", () => {
    const { fields } = tree(SEED);

    // A spread, `Object.keys`, a devtools walk: all see an empty object rather than
    // materialising the whole schema.
    expect(Object.keys(fields)).toEqual([]);
    expect({ ...fields }).toEqual({});
    expect((fields as unknown as Record<symbol, unknown>)[IS_FIELD_NODE]).toBe(true);
    expect(Symbol.toPrimitive in fields).toBe(false);
  });

  test("assigning to a field is refused, and says what to do instead", () => {
    const { fields } = tree(SEED);

    expect(() => {
      (fields as unknown as { email: unknown }).email = "x";
    }).toThrow(/RMF001/);
  });

  test("`set` goes through the host, with the value's own path", () => {
    const { h, fields } = tree(SEED);

    fields.address.street.$.set("Terazije");
    fields.contacts[0].kind.$.set("phone");

    // The key form separates segments with NUL, so a schema key holding a dot, a bracket or
    // a space cannot make two different paths share an entry.
    expect(h.writes).toEqual([`address\u0000street="Terazije"`, `contacts\u0000#0\u0000kind="phone"`]);
    expect((h.values as Shape).address.street).toBe("Terazije");
    // The sibling is untouched, and the object it lives in was copied rather than mutated.
    expect((h.values as Shape).address.city).toBe("Beograd");
    expect(h.values).not.toBe(SEED);
  });

  test("an input event is read according to the control `bind` asked for", () => {
    const { h, fields } = tree(SEED);

    handler(fields.email.$.bind, "oninput")(inputEvent("text", { value: "z@z.z" }));
    handler(fields.agree.$.bind, "oninput")(inputEvent("checkbox", { checked: true }));
    handler(fields.age.$.bind, "oninput")(inputEvent("number", { value: "41" }));

    expect((h.values as Shape).email).toBe("z@z.z");
    expect((h.values as Shape).agree).toBe(true);
    expect((h.values as Shape).age).toBe(41);
  });

  test("an emptied number input holds the empty string rather than NaN", () => {
    // NaN poisons arithmetic silently. `""` is a value the schema can report on.
    const { h, fields } = tree(SEED);

    handler(fields.age.$.bind, "oninput")(inputEvent("number", { value: "" }));

    expect((h.values as Shape).age).toBe("");
  });

  /**
   * A date control shows the day the reader is in, not the day UTC is in.
   *
   * `toISOString().slice(0, 10)` is the obvious way to write this and is wrong for most of the
   * world: 01:00 on the 7th in Belgrade is 23:00 on the 6th in UTC, so the control showed the 6th —
   * and picking that same shown day wrote the 6th back. The reader's date moved a day by being
   * looked at.
   *
   * **Two times, and that is deliberate.** One assertion cannot fail in every zone: an early hour
   * only crosses the UTC boundary where the offset is positive, a late hour only where it is
   * negative. Together they catch the fault whichever side of Greenwich the runner sits on, and both
   * pass once the formatting is local. In UTC exactly there is nothing to catch, and both pass either
   * way — which is honest, because there is no bug there.
   */
  test("a date control shows the reader's calendar day, in any timezone", () => {
    const early = tree({ ...SEED, when: new Date(2026, 7, 7, 1, 0, 0) });
    expect(early.fields.when.$.bind).toMatchObject({ type: "date", value: "2026-08-07" });

    const late = tree({ ...SEED, when: new Date(2026, 7, 7, 23, 0, 0) });
    expect(late.fields.when.$.bind).toMatchObject({ type: "date", value: "2026-08-07" });
  });

  test("picking the day the control already showed changes nothing", () => {
    // The round trip is where the drift became data loss: read the shown value, hand it straight
    // back as the control does, and the value must not move.
    for (const hour of [1, 23]) {
      const { h, fields } = tree({ ...SEED, when: new Date(2026, 7, 7, hour, 30, 0) });
      const shown = fields.when.$.bind.value as string;

      handler(fields.when.$.bind, "oninput")(inputEvent("date", { value: shown }));

      const after = (h.values as Shape).when;
      expect(after).toBeInstanceOf(Date);
      expect([after.getFullYear(), after.getMonth(), after.getDate()]).toEqual([2026, 7, 7]);
      // The time it already held is carried across: a date input cannot express one, so throwing it
      // away would silently move an appointment to midnight.
      expect([after.getHours(), after.getMinutes()]).toEqual([hour, 30]);
    }
  });

  test("picking a different day moves to that day, and only that day", () => {
    const { h, fields } = tree({ ...SEED, when: new Date(2026, 7, 7, 9, 15, 0) });

    handler(fields.when.$.bind, "oninput")(inputEvent("date", { value: "2026-12-31" }));

    const after = (h.values as Shape).when;
    expect([after.getFullYear(), after.getMonth(), after.getDate()]).toEqual([2026, 11, 31]);
    expect([after.getHours(), after.getMinutes()]).toEqual([9, 15]);
  });

  /**
   * An emptied number input is still a number input.
   *
   * `bind` reads the control's kind off the value's runtime type, and `fromControl` writes `""` for
   * an emptied number field — deliberately, so a schema can report on it instead of `NaN` poisoning
   * arithmetic. The two together lost the control: `""` is a string, so `type: "number"` disappeared
   * from the attributes, the element reverted to text, and every later `fromControl` read it as text
   * and wrote a string. The field never became numeric again — the spinner gone, and on a phone the
   * numeric keyboard gone mid-entry.
   */
  test("a number field that the reader clears is still a number field", () => {
    const { h, fields } = tree(SEED);
    expect(fields.age.$.bind).toMatchObject({ type: "number", value: 30 });

    handler(fields.age.$.bind, "oninput")(inputEvent("number", { value: "" }));
    expect((h.values as Shape).age).toBe("");

    expect(fields.age.$.bind).toMatchObject({ type: "number", value: "" });

    // And typing into it again produces a NUMBER, because the control it reads from is still one.
    handler(fields.age.$.bind, "oninput")(inputEvent("number", { value: "7" }));
    expect((h.values as Shape).age).toBe(7);
  });

  test("a cleared date field keeps its control too", () => {
    const { fields } = tree(SEED);
    expect(fields.when.$.bind).toMatchObject({ type: "date" });

    // A date input that the reader clears hands back `""`, which no `Date` branch would match.
    handler(fields.when.$.bind, "oninput")(inputEvent("date", { value: "" }));
    expect(fields.when.$.bind).toMatchObject({ type: "date", value: "" });
  });

  test("a text field stays a text field, and never claims a type it was not given", () => {
    // The memory above must not leak into an ordinary string: an empty text field is not a number
    // input waiting to be filled.
    const { h, fields } = tree(SEED);

    handler(fields.email.$.bind, "oninput")(inputEvent("text", { value: "" }));

    expect((h.values as Shape).email).toBe("");
    expect(Object.hasOwn(fields.email.$.bind, "type")).toBe(false);
  });

  test("blur marks the field touched and nothing else", () => {
    const { h, fields } = tree(SEED);

    expect(fields.email.$.touched).toBe(false);
    handler(fields.email.$.bind, "onblur")(new Event("blur"));

    expect(fields.email.$.touched).toBe(true);
    expect(h.writes).toEqual([]);
  });

  test("the list members refuse a field that is not a list, by name", () => {
    const { fields } = tree(SEED);

    expect(() => (fields.email as unknown as { $: { length: number } }).$.length).toThrow(/RMF002/);
    expect(() => (fields.email as unknown as { $: { length: number } }).$.length).toThrow(/`email`/);
  });
});

/**
 * Reaches a handler off a `bind`.
 *
 * A local cast rather than a `declare module` augmentation: augmenting `CommonBind` with an
 * index signature leaked into the whole program and silently disarmed two of
 * `Types.test.tsx`'s negative cases, which is the opposite of what a test file should do.
 */
function handler(bind: object, key: "oninput" | "onblur"): (event: Event) => void {
  return (bind as Record<string, (event: Event) => void>)[key] as (event: Event) => void;
}

/** An `<input>`-shaped event target, without needing a document. */
function inputEvent(type: string, props: { value?: string; checked?: boolean }): Event {
  return { target: { type, ...props } } as unknown as Event;
}
