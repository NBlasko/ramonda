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
    setErrorAt: () => {},
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
    // The whole design rests on this. A fresh node per access is a fresh `oninput` per
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

  test("the two handlers keep their identity across reads", () => {
    const { fields } = tree(SEED);

    expect(fields.email.$.oninput).toBe(fields.email.$.oninput);
    expect(fields.email.$.onblur).toBe(fields.email.$.onblur);
  });

  test("`inputValue` is what each kind of control shows", () => {
    const { fields } = tree(SEED);

    expect(fields.email.$.inputValue).toBe("a@b.c");
    expect(fields.age.$.inputValue).toBe(30);
    expect(fields.contacts[0].value.$.inputValue).toBe("x@y.z");
    // A checkbox takes `checked={field.value === true}`.
    expect(fields.agree.$.value).toBe(false);
  });

  test("`invalid` is true only while there is something to report, and no value otherwise", () => {
    const { h, fields } = tree(SEED);

    expect(fields.email.$.invalid).toBeUndefined();
    h.setErrors(["email"], ["not an email"]);
    expect(fields.email.$.invalid).toBe(true);
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

  test("an input event is read according to the control that sent it", () => {
    const { h, fields } = tree(SEED);

    fields.email.$.oninput(inputEvent("text", { value: "z@z.z" }));
    fields.agree.$.oninput(inputEvent("checkbox", { checked: true }));
    fields.age.$.oninput(inputEvent("number", { value: "41" }));

    expect((h.values as Shape).email).toBe("z@z.z");
    expect((h.values as Shape).agree).toBe(true);
    expect((h.values as Shape).age).toBe(41);
  });

  test("an emptied number input holds the empty string rather than NaN", () => {
    // NaN poisons arithmetic silently. `""` is a value the schema can report on.
    const { h, fields } = tree(SEED);

    fields.age.$.oninput(inputEvent("number", { value: "" }));

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
    expect(early.fields.when.$.inputValue).toBe("2026-08-07");

    const late = tree({ ...SEED, when: new Date(2026, 7, 7, 23, 0, 0) });
    expect(late.fields.when.$.inputValue).toBe("2026-08-07");
  });

  test("picking the day the control already showed changes nothing", () => {
    // The round trip is where the drift became data loss: read the shown value, hand it straight
    // back as the control does, and the value must not move.
    for (const hour of [1, 23]) {
      const { h, fields } = tree({ ...SEED, when: new Date(2026, 7, 7, hour, 30, 0) });
      const shown = fields.when.$.inputValue;

      fields.when.$.oninput(inputEvent("date", { value: shown }));

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

    fields.when.$.oninput(inputEvent("date", { value: "2026-12-31" }));

    const after = (h.values as Shape).when;
    expect([after.getFullYear(), after.getMonth(), after.getDate()]).toEqual([2026, 11, 31]);
    expect([after.getHours(), after.getMinutes()]).toEqual([9, 15]);
  });

  /**
   * A cleared number field holds `""` — a value the schema can report on — and shows it, and the next
   * number typed into it is a number again: the control says what it is, by its own `type`.
   */
  /** A slider is a number control too: it hands back its position as text, and the field holds the number. */
  test("a range input writes a number", () => {
    const { h, fields } = tree(SEED);

    fields.age.$.oninput(inputEvent("range", { value: "7" }));

    expect((h.values as Shape).age).toBe(7);
  });

  /** An empty number field takes a number from its slider: its number is still to come. */
  test("a range input on an empty field writes a number", () => {
    for (const empty of [undefined, ""]) {
      const { h, fields } = tree({ ...SEED, age: empty as unknown as number });

      fields.age.$.oninput(inputEvent("range", { value: "60" }));

      expect((h.values as Shape).age, String(empty)).toBe(60);
    }
  });

  /**
   * The control decides, not the value held: a slider hands back a number to any field. A field of text
   * in one is `ramonda-check`'s to report, from the field's type.
   */
  test("a range input writes a number whatever the field held", () => {
    const { h, fields } = tree(SEED);

    fields.email.$.oninput(inputEvent("range", { value: "50" }));

    expect((h.values as Shape).email).toBe(50);
  });

  /** An emptied `Date` holds nothing — `undefined`, whatever it was handed: the form does not guess at the schema. */
  test("an emptied date field holds undefined, whatever it was handed", () => {
    const { h, fields } = tree({ ...SEED, when: null as unknown as Date });
    fields.when.$.oninput(inputEvent("date", { value: "2026-10-29" }));
    fields.when.$.oninput(inputEvent("date", { value: "" }));

    expect((h.values as Shape).when).toBe(undefined);
  });

  /** A year below 100 is that year, not 1900 more: the year a reader types passes through `0002`. */
  test("a date input on an empty field keeps an early year", () => {
    const { h, fields } = tree({ ...SEED, when: undefined as unknown as Date });

    fields.when.$.oninput(inputEvent("date", { value: "0002-05-10" }));

    const day = (h.values as Shape).when;
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([2, 4, 10, 0]);
    // Shown in four digits, as a date input reads it — `2-05-10` would empty the field mid-year.
    expect(fields.when.$.inputValue).toBe("0002-05-10");
  });

  /** A year of five digits is a year: one digit too many typed is a day, shown back as typed, not nothing. */
  test("a date input keeps a year of more than four digits", () => {
    const { h, fields } = tree({ ...SEED, when: undefined as unknown as Date });

    fields.when.$.oninput(inputEvent("date", { value: "20261-10-29" }));

    expect([(h.values as Shape).when.getFullYear(), fields.when.$.inputValue]).toEqual([20261, "20261-10-29"]);
  });

  /** A year past what a `Date` holds is no day: the field holds nothing, never an invalid `Date`. */
  test("a date input past the last year a Date holds writes nothing", () => {
    const { h, fields } = tree({ ...SEED, when: undefined as unknown as Date });

    fields.when.$.oninput(inputEvent("date", { value: "999999-01-01" }));

    expect((h.values as Shape).when).toBe(undefined);
  });

  /** A day before year 1 is none a date input shows, so the input is shown nothing rather than `00-5-01-01`. */
  test("a date before year 1 is shown as no day", () => {
    const early = new Date(2026, 0, 1);
    early.setFullYear(-5);
    const { fields } = tree({ ...SEED, when: early });

    expect(fields.when.$.inputValue).toBe("");
  });

  /** A date field that held no date takes one from its control: the day, at local midnight. */
  test("a date input on an empty field writes a day", () => {
    const { h, fields } = tree({ ...SEED, when: undefined as unknown as Date });

    fields.when.$.oninput(inputEvent("date", { value: "2026-10-29" }));

    expect((h.values as Shape).when).toEqual(new Date(2026, 9, 29));
  });

  /**
   * A date written as text — `""` at the start, or a day already — gets the control's text back: the
   * value it holds says it is text. A `Date` emptied holds nothing, so `""` never means a `Date`.
   */
  test("a date input writes text to a field of text, and nothing to an emptied Date", () => {
    const written: unknown[] = [];
    for (const held of ["", "2026-01-01"]) {
      const { h, fields } = tree({ ...SEED, email: held });
      fields.email.$.oninput(inputEvent("date", { value: "2026-10-29" }));
      written.push((h.values as Shape).email);
    }
    const { h, fields } = tree(SEED);
    fields.when.$.oninput(inputEvent("date", { value: "" }));
    written.push((h.values as Shape).when);

    expect(written).toEqual(["2026-10-29", "2026-10-29", undefined]);
  });

  test("a number field that the reader clears takes a number again", () => {
    const { h, fields } = tree(SEED);

    fields.age.$.oninput(inputEvent("number", { value: "" }));
    expect({ held: (h.values as Shape).age, shown: fields.age.$.inputValue }).toEqual({ held: "", shown: "" });

    fields.age.$.oninput(inputEvent("number", { value: "7" }));
    expect((h.values as Shape).age).toBe(7);
  });

  /** A boolean field is set by a radio pair or a select through its `value`: "No" is picked as "false". */
  test("a radio of a boolean field writes its own value, not whether it is checked", () => {
    const { h, fields } = tree(SEED);

    fields.agree.$.oninput(inputEvent("checkbox", { checked: true }));
    fields.agree.$.oninput(inputEvent("radio", { value: "false", checked: true }));

    expect((h.values as Shape).agree).toBe("false");
  });

  test("a cleared date field shows nothing", () => {
    const { fields } = tree(SEED);

    // A date input that the reader clears hands back `""`; the `Date` field holds nothing, and shows `""`.
    fields.when.$.oninput(inputEvent("date", { value: "" }));
    expect(fields.when.$.inputValue).toBe("");
  });

  test("blur marks the field touched and nothing else", () => {
    const { h, fields } = tree(SEED);

    expect(fields.email.$.touched).toBe(false);
    fields.email.$.onblur(new Event("blur"));

    expect(fields.email.$.touched).toBe(true);
    expect(h.writes).toEqual([]);
  });

  test("the list members refuse a field that is not a list, by name", () => {
    const { fields } = tree(SEED);

    expect(() => (fields.email as unknown as { $: { length: number } }).$.length).toThrow(/RMF002/);
    expect(() => (fields.email as unknown as { $: { length: number } }).$.length).toThrow(/`email`/);
  });
});

/** An `<input>`-shaped event target, without needing a document. */
function inputEvent(type: string, props: { value?: string; checked?: boolean }): Event {
  return { target: { type, ...props } } as unknown as Event;
}
