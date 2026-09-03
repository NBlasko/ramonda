import { toJSONSchema, parse, type JSONSchema, type RefRead } from "bguard";
import { parsePath, pathToString, type Path } from "./path";
import type { StandardSchemaV1 } from "./types";

/**
 * What bguard can do that Standard Schema cannot express.
 *
 * The form itself needs none of this — Standard Schema is the whole contract, which is why bguard,
 * zod, valibot and arktype all work with no adapter. This submodule is for the two things that are
 * not in that contract because they are not about validating a value:
 *
 * - **the constraints, as HTML attributes.** A schema already says `minLength(3)`; writing
 *   `minlength={3}` next to it is the same fact twice, and the two drift.
 * - **whether a cross-field rule points at a real field.** `ctx.ref('pasword')` returns `undefined`
 *   forever and reports nothing, so the rule silently passes.
 *
 * bguard is an OPTIONAL peer dependency. Importing `@ramonda/form` does not reach this file, so a
 * form over zod pulls in nothing from here.
 *
 * Nothing here imports `@ramonda/core` either, only bguard and this package's own path helpers — so
 * it runs in a bare Node process with no DOM. That is what lets `unknownRefPaths` sit in a plain
 * unit test, or on a server, rather than needing a rendered component to reach it.
 *
 * ## What is deliberately not here
 *
 * `pick`-based per-field validation, which was the original plan for this file. Measured first, on a
 * bguard schema with a `custom` per field and one cross-field rule:
 *
 * | fields | whole-form validation |
 * |---|---|
 * | 11 | 3.3 µs |
 * | 31 | 14.9 µs |
 * | 101 | 48.3 µs |
 * | 301 | 154.8 µs |
 *
 * A 300-field form revalidates in a hundredth of a frame. There is no problem to solve, and the
 * fast path would have brought real hazards: `pick` carries the source's object-level assertions
 * over, so a whole-form rule would run against a partial value and invent an issue; `pick` reaches
 * top-level keys only, so a nested field could not use it; and the dependency graph is discovered by
 * running rules rather than known up front, so a rule that had not run yet would be missed. Each of
 * those shows a wrong or stale message, to save ten microseconds.
 */

/** The subset of HTML validation attributes a JSON Schema can honestly supply. */
export interface HtmlConstraints {
  readonly required?: true;
  readonly minlength?: number;
  readonly maxlength?: number;
  readonly pattern?: string;
  readonly min?: number | string;
  readonly max?: number | string;
  /**
   * From a `format`, and only where the browser's own input type means the same thing. Setting it
   * changes browser behaviour — see the note on `htmlConstraints` about `noValidate`.
   */
  readonly type?: "email" | "url" | "date" | "time" | "datetime-local";
}

const EMPTY: HtmlConstraints = {};

/** `format` values that have an `<input type>` meaning the same thing. `uuid` has none. */
const INPUT_TYPES: Record<string, HtmlConstraints["type"]> = {
  email: "email",
  uri: "url",
  date: "date",
  time: "time",
  "date-time": "datetime-local",
};

/**
 * The HTML validation attributes for each field, derived from the schema.
 *
 * ```tsx
 * const html = htmlConstraints(signupSchema);   // once, outside render
 *
 * <input {...f.nick.$.bind} {...html("nick")} />
 * <input {...row.field.$.bind} {...html(row.field.$.path)} />
 * ```
 *
 * **Answers are cached by path**, so the same path yields the same object every render. That is not
 * a micro-optimisation: RMD020 compares a vnode's attributes key by key and a freshly built object
 * would be reported for every input on the page. It is the same reason the field tree is an identity
 * cache.
 *
 * **Paths are the form's own** — `"address.city"`, `"tags[0]"` — so `f.address.city.$.path` can be
 * handed straight in. An array index resolves to the item schema, so every row of a list gets the
 * same constraints without the schema being walked per row.
 *
 * ## `required` and `type` change what the browser does
 *
 * They are real HTML validation, so the browser checks them before your `onSubmit` runs and shows
 * its own bubble instead — which means the form's messages never appear. Decide which validation the
 * reader sees:
 *
 * - **`<form noValidate onsubmit={this.form.submit}>`** keeps the schema's messages and the
 *   attributes' accessibility benefit: a screen reader still announces a required field, and mobile
 *   keyboards still follow `type="email"`.
 * - **Without `noValidate`**, the browser answers first. Reasonable if you want native behaviour and
 *   the schema only as the server-side truth.
 *
 * Spread `bind` first and these second, so a `type` derived from the schema wins over the one `bind`
 * inferred from the value.
 */
export function htmlConstraints<S extends StandardSchemaV1>(schema: S): (path: string | Path) => HtmlConstraints {
  // Rendered once. `dialect: null` because nothing here reads `$schema`, and it would be the only
  // key in the document that is not about a field.
  const root = toJSONSchema(schema as never, { dialect: null });
  const cache = new Map<string, HtmlConstraints>();

  return (path) => {
    const asString = typeof path === "string" ? path : pathToString(path);
    const cached = cache.get(asString);
    if (cached !== undefined) return cached;

    const answer = constraintsAt(root, typeof path === "string" ? parsePath(path) : path);
    cache.set(asString, answer);
    return answer;
  };
}

/** Walks to the field's node, then reads the keywords it carries. */
function constraintsAt(root: JSONSchema, path: Path): HtmlConstraints {
  let node: JSONSchema | undefined = root;
  let parent: JSONSchema | undefined;
  let key: string | undefined;

  for (const segment of path) {
    if (node === undefined) return EMPTY;
    parent = node;

    if (typeof segment === "number") {
      // Every row of an array shares one item schema, so an index resolves to it. That is also what
      // makes the cache worth having across a long list.
      node = asSchema(node.items);
      key = undefined;
      continue;
    }

    const properties = node.properties as Record<string, unknown> | undefined;
    node = properties ? asSchema(properties[segment]) : undefined;
    key = segment;
  }

  if (node === undefined) return EMPTY;

  return read(node, isRequired(parent, key));
}

function asSchema(value: unknown): JSONSchema | undefined {
  return value !== null && typeof value === "object" ? (value as JSONSchema) : undefined;
}

/**
 * Whether the parent declares this property required.
 *
 * An array ITEM is never "required" in the HTML sense: the row exists because the array holds it, so
 * there is nothing for the browser to demand. That is why the answer is `false` when the last
 * segment was an index rather than a key.
 */
function isRequired(parent: JSONSchema | undefined, key: string | undefined): boolean {
  if (parent === undefined || key === undefined) return false;
  const required = parent.required;
  return Array.isArray(required) && required.includes(key);
}

function read(node: JSONSchema, required: boolean): HtmlConstraints {
  const out: {
    required?: true;
    minlength?: number;
    maxlength?: number;
    pattern?: string;
    min?: number;
    max?: number;
    type?: HtmlConstraints["type"];
  } = {};

  if (required) out.required = true;
  if (typeof node.minLength === "number") out.minlength = node.minLength;
  if (typeof node.maxLength === "number") out.maxlength = node.maxLength;
  if (typeof node.pattern === "string") out.pattern = node.pattern;

  // `minimum` is inclusive and so is HTML's `min`. `exclusiveMinimum` is not, and HTML has no
  // exclusive form — so it is left out rather than reported as one short, which would accept a value
  // the schema rejects or reject one it accepts depending on the step.
  if (typeof node.minimum === "number") out.min = node.minimum;
  if (typeof node.maximum === "number") out.max = node.maximum;

  if (typeof node.format === "string") {
    const type = INPUT_TYPES[node.format];
    if (type !== undefined) out.type = type;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Cross-field rules that point at nothing.
 * ------------------------------------------------------------------ */

/** One cross-field rule whose path names no field in the schema. */
export interface UnknownRef {
  /**
   * The path the rule asked for, with any array index shown as `*`.
   *
   * A rule inside a list runs once per row, and the problem is the rule rather than the row it
   * happened to be on — `contacts.*.kynd`, not fifty entries counting up from `contacts.0.kynd`.
   */
  readonly to: string;
  /** Where the rule lives, in the form's own path notation: `"confirm"`, `"contacts[*].value"`. */
  readonly from: string;
}

/**
 * A location with its array indices replaced by `*`.
 *
 * A rule inside a list is ONE rule. Reported per row, a single typo on a fifty-row list produced
 * fifty entries — measured — which is an answer nobody reads.
 *
 * **Both ends are normalised**, because `ctx.sibling` resolves to an absolute path that carries the
 * row index too: a rule at `contacts[i].value` reading its own row's `kind` records
 * `contacts.0.kind`, `contacts.1.kind`, and so on. Normalising only `from` would still leave one
 * entry per row.
 *
 * The cost is small and worth naming: a constant index written by hand, `ctx.ref("rows.0.id")`, is
 * also shown as `rows.*.id`. The report still points at the right rule, which is what it is for.
 */
function withoutIndices(segments: Path, style: "ref" | "field"): string {
  // The two ends keep the notation they each already use — `to` is a `ref` path, dotted, and `from`
  // is a field path, bracketed. Collapsing them onto one spelling here would make the report say
  // something neither call site says.
  if (style === "ref") return segments.map((segment) => (isIndex(segment) ? "*" : String(segment))).join(".");

  let out = "";
  for (const segment of segments) {
    if (isIndex(segment)) out += "[*]";
    else out += out === "" ? String(segment) : `.${String(segment)}`;
  }
  return out;
}

/** A number, or a string that `ref` produced from one — its segments are always strings. */
function isIndex(segment: string | number): boolean {
  return typeof segment === "number" || /^\d+$/.test(segment);
}

/**
 * Every `ctx.ref` path in the schema that does not name a field.
 *
 * `ctx.ref('pasword')` yields `undefined` for ever. The comparison against it then quietly succeeds
 * or quietly fails — whichever the typo happens to produce — and nothing anywhere says so. It is the
 * shape of bug that survives a code review, because the line reads correctly.
 *
 * **The natural home is a test**, where it holds for good rather than only while someone is looking:
 *
 * ```ts
 * test("every cross-field rule points at a real field", () => {
 *   expect(unknownRefPaths(signupSchema, DEFAULTS)).toEqual([]);
 * });
 * ```
 *
 * ## Why it needs values
 *
 * A `custom` is an opaque function and the paths it reads can depend on what it was given, so the
 * reads are recorded from a real parse rather than derived. Pass the form's `defaultValues`, and pass
 * a filled-in set too if a rule returns early on an empty value — **a rule that does not run reads
 * nothing, so it cannot be checked**. That is the honest limit: this finds a typo in a rule that ran,
 * and says nothing about one that did not.
 *
 * Every issue the parse reports is ignored. Whether the values are valid is not the question.
 */
export function unknownRefPaths<S extends StandardSchemaV1>(schema: S, values: unknown): UnknownRef[] {
  const refReads: RefRead[] = [];
  parse(schema as never, values, { refReads, getAllErrors: true });

  const root = toJSONSchema(schema as never, { dialect: null });
  const problems: UnknownRef[] = [];
  const seen = new Set<string>();

  for (const read of refReads) {
    if (resolves(root, read.toPath)) continue;

    // Both ends without their indices, so one rule inside a list is one report rather than one per
    // row — including a `sibling` read, whose resolved path carries the row index as well.
    const to = withoutIndices(read.toPath, "ref");
    const from = withoutIndices(read.from as Path, "field");

    const key = `${to} ${from}`;
    if (seen.has(key)) continue;
    seen.add(key);

    problems.push({ to, from });
  }

  return problems;
}

/**
 * Whether the schema has something at every segment of the path.
 *
 * This has to follow the walk `ref` ITSELF does, not a tidier one, or it reports paths that work.
 * `ref` splits on dots and then indexes plainly, so on an array:
 *
 * - **`rows.0` resolves.** A JavaScript array indexes by string, so `received['rows']['0']` is the
 *   first row. Measured, because the segment being a string made it look like it could not be.
 * - **`rows.length` resolves**, and is a legitimate thing for a rule to read — "at least one row"
 *   is a real cross-field rule. It is terminal: nothing hangs off a number.
 *
 * Anything else named on an array does not: `rows.title` is undefined at runtime, which is the
 * silent failure this whole function exists to surface.
 */
function resolves(root: JSONSchema, path: readonly string[]): boolean {
  let node: JSONSchema | undefined = root;

  for (const segment of path) {
    if (node === undefined) return false;

    if (node.items !== undefined) {
      if (segment === "length") return true;
      if (!/^\d+$/.test(segment)) return false;
      node = asSchema(node.items);
      continue;
    }

    const properties = node.properties as Record<string, unknown> | undefined;
    node = properties ? asSchema(properties[segment]) : undefined;
    if (node === undefined) return false;
  }

  return true;
}
