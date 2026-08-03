import { object, string, number, array } from "bguard";
import { email } from "bguard/string/email";
import { minLength } from "bguard/string/minLength";
import { maxLength } from "bguard/string/maxLength";
import { regExp } from "bguard/string/regExp";
import { uuid } from "bguard/string/uuid";
import { validUrl } from "bguard/string/validUrl";
import { isValidDate } from "bguard/string/isValidDate";
import { min } from "bguard/number/min";
import { max } from "bguard/number/max";
import { minExcluded } from "bguard/number/minExcluded";
import { describe, expect, test } from "vitest";
import { htmlConstraints, unknownRefPaths } from "../bguard";
import type { ExceptionContext } from "bguard/core";

/**
 * The submodule for what Standard Schema cannot express. Everything here is bguard-specific by
 * definition, which is why it does not live in the main entry.
 */

const signup = object({
  email: string().custom(email()),
  nick: string().custom(minLength(3), maxLength(20)),
  code: string().custom(regExp(/^[A-Z]{3}$/)),
  age: number().custom(min(18), max(120)),
  homepage: string().custom(validUrl()),
  born: string().custom(isValidDate()),
  token: string().custom(uuid()),
  bio: string().optional(),
  address: object({ city: string().custom(minLength(2)) }),
  tags: array(string().custom(minLength(2))),
});

describe("htmlConstraints", () => {
  const html = htmlConstraints(signup);

  test("carries `required` from the schema's required list", () => {
    expect(html("email").required).toBe(true);
    // Declared optional, so the browser has nothing to demand.
    expect(html("bio").required).toBeUndefined();
  });

  test("maps the length and pattern keywords onto their HTML spellings", () => {
    expect(html("nick")).toEqual({ required: true, minlength: 3, maxlength: 20 });
    expect(html("code")).toEqual({ required: true, pattern: "^[A-Z]{3}$" });
  });

  test("maps inclusive bounds onto min and max", () => {
    expect(html("age")).toEqual({ required: true, min: 18, max: 120 });
  });

  test("leaves an EXCLUSIVE bound out rather than reporting it as one short", () => {
    // HTML has no exclusive form. Reporting `min: 0` for `minExcluded(0)` would accept 0, which the
    // schema rejects; reporting `min: 1` would reject 0.5, which it accepts.
    const schema = object({ ratio: number().custom(minExcluded(0)) });
    const only = htmlConstraints(schema);

    expect(only("ratio")).toEqual({ required: true });
  });

  test("turns a format into an input type, where the browser means the same thing", () => {
    expect(html("email").type).toBe("email");
    expect(html("homepage").type).toBe("url");
    expect(html("born").type).toBe("date");
  });

  test("leaves a format with no input type alone", () => {
    // `uuid` is a real JSON Schema format and no `<input type>` means it. Approximating it with
    // `pattern` would be inventing a constraint the schema did not state.
    expect(html("token")).toEqual({ required: true });
  });

  test("reaches a nested field by its path", () => {
    expect(html("address.city")).toEqual({ required: true, minlength: 2 });
  });

  test("resolves an array index to the item schema, so every row agrees", () => {
    expect(html("tags[0]")).toEqual({ minlength: 2 });
    expect(html("tags[7]")).toEqual(html("tags[0]"));
  });

  test("an array ITEM is never `required`", () => {
    // The row exists because the array holds it. There is nothing for the browser to demand, and
    // `required` on every row of an empty-able list would block a submit for the wrong reason.
    expect(html("tags[0]").required).toBeUndefined();
    // The array itself is required, though.
    expect(html("tags").required).toBe(true);
  });

  test("accepts a path as segments as well as a string", () => {
    // A fresh lookup, so the segments arrive BEFORE anything has cached the string form — otherwise
    // the cache answers and the segment path is never actually walked.
    const fresh = htmlConstraints(signup);

    expect(fresh(["address", "city"])).toEqual({ required: true, minlength: 2 });
    expect(fresh(["tags", 0])).toEqual({ minlength: 2 });
    // And the two spellings agree, in either order.
    expect(fresh("address.city")).toBe(fresh(["address", "city"]));
    expect(html(["address", "city"])).toEqual(html("address.city"));
  });

  test("returns the SAME object for the same path", () => {
    // RMD020 compares a vnode's attributes key by key, so a freshly built object per render would
    // be reported for every input on the page.
    const first = html("nick");
    expect(html("nick")).toBe(first);
    expect(html(["nick"])).toBe(first);
  });

  test("a path that names nothing is empty rather than an error", () => {
    // A form outlives a schema change. An input whose field has gone should render without
    // constraints, not throw in the middle of someone's page.
    expect(html("nope")).toEqual({});
    expect(html("address.nope")).toEqual({});
    expect(html("nope.deeper")).toEqual({});
    expect(html("nick.deeper")).toEqual({});
  });

  test("the root has no constraints of its own", () => {
    expect(html("")).toEqual({});
  });

  test("an index into something that is not an array is empty", () => {
    expect(html("nick[0]")).toEqual({});
  });
});

describe("unknownRefPaths", () => {
  const DEFAULTS = { password: "abcdefgh", confirm: "abcdefgh", address: { city: "NS" } };

  const matching = (other: string) => (received: string, ctx: ExceptionContext) => {
    if (received !== ctx.ref(other)) ctx.addIssue("a match", received, "u:mismatch");
  };

  test("says nothing when every rule points at a real field", () => {
    const schema = object({
      password: string(),
      confirm: string().custom(matching("password")),
      address: object({ city: string() }),
    });

    expect(unknownRefPaths(schema, DEFAULTS)).toEqual([]);
  });

  test("finds a typo, which otherwise passes silently for ever", () => {
    // `ctx.ref('pasword')` yields undefined, the comparison quietly fails, and nothing says why.
    const schema = object({
      password: string(),
      confirm: string().custom(matching("pasword")),
      address: object({ city: string() }),
    });

    expect(unknownRefPaths(schema, DEFAULTS)).toEqual([{ to: "pasword", from: "confirm" }]);
  });

  test("resolves a nested path, and reports a nested one that is wrong", () => {
    const schema = object({
      password: string(),
      confirm: string().custom(matching("address.city")),
      address: object({ city: string() }),
    });
    expect(unknownRefPaths(schema, DEFAULTS)).toEqual([]);

    const wrong = object({
      password: string(),
      confirm: string().custom(matching("address.town")),
      address: object({ city: string() }),
    });
    expect(unknownRefPaths(wrong, DEFAULTS)).toEqual([{ to: "address.town", from: "confirm" }]);
  });

  test("reports the location of the rule, not just the path it wanted", () => {
    const schema = object({
      limit: number(),
      rows: array(string().custom(matching("limitt") as never)),
    });

    expect(unknownRefPaths(schema, { limit: 1, rows: ["a", "b"] })).toEqual([
      { to: "limitt", from: "rows[0]" },
      { to: "limitt", from: "rows[1]" },
    ]);
  });

  test("reports each distinct problem once, however many times the rule ran", () => {
    const schema = object({
      a: string().custom((received: string, ctx: ExceptionContext) => {
        // The same bad path twice in one rule.
        void ctx.ref("nope");
        void ctx.ref("nope");
        void received;
      }),
    });

    expect(unknownRefPaths(schema, { a: "x" })).toEqual([{ to: "nope", from: "a" }]);
  });

  test("ignores whether the values were valid — that is not the question", () => {
    const schema = object({
      password: string().custom(minLength(8)),
      confirm: string().custom(matching("pasword")),
      address: object({ city: string() }),
    });

    // Every field fails, and the answer is still about the ref path.
    expect(unknownRefPaths(schema, { password: "x", confirm: "y", address: { city: "" } })).toEqual([
      { to: "pasword", from: "confirm" },
    ]);
  });

  test("says nothing about a rule that did not run", () => {
    // The honest limit, and the reason values are a parameter: a `custom` is an opaque function, so
    // a read can only be recorded from a rule that got far enough to make it.
    const schema = object({
      password: string(),
      confirm: string().custom((received: string, ctx: ExceptionContext) => {
        if (received === "") return; // returns before reading anything
        if (received !== ctx.ref("pasword")) ctx.addIssue("a match", received, "u:mismatch");
      }),
    });

    expect(unknownRefPaths(schema, { password: "", confirm: "" })).toEqual([]);
    // Give it values that reach the comparison and the typo surfaces.
    expect(unknownRefPaths(schema, { password: "p", confirm: "p" })).toEqual([{ to: "pasword", from: "confirm" }]);
  });

  test("accepts a `ref` INTO an array, which does work", () => {
    // `ref` splits on dots and then indexes plainly, and a JavaScript array indexes by string — so
    // `received['rows']['0']` is the first row. Measured, because the segment being a string made it
    // look as though it could not be, and reporting it would have been a false alarm on working code.
    const schema = object({
      rows: array(string()),
      first: string().custom(matching("rows.0")),
    });

    expect(unknownRefPaths(schema, { rows: ["a"], first: "a" })).toEqual([]);
  });

  test("accepts `length` on an array, which a real rule reads", () => {
    // "at least one row" is an ordinary cross-field rule.
    const schema = object({
      rows: array(string()),
      summary: string().custom((received: string, ctx: ExceptionContext) => {
        if ((ctx.ref("rows.length") as number) === 0) ctx.addIssue("a row", received, "u:empty");
      }),
    });

    expect(unknownRefPaths(schema, { rows: ["a"], summary: "s" })).toEqual([]);
  });

  test("still reports a name an array does not have", () => {
    const schema = object({
      rows: array(string()),
      first: string().custom(matching("rows.title")),
    });

    expect(unknownRefPaths(schema, { rows: ["a"], first: "a" })).toEqual([{ to: "rows.title", from: "first" }]);
  });

  test("reaches a field inside an array row", () => {
    const schema = object({
      contacts: array(object({ kind: string(), value: string() })),
      note: string().custom(matching("contacts.0.kind")),
    });

    expect(unknownRefPaths(schema, { contacts: [{ kind: "email", value: "a" }], note: "email" })).toEqual([]);
  });
});
