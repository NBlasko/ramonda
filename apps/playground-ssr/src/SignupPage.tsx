import { Component, Host, list, memoizedHandler, type RamondaNode } from "@ramonda/core";
import { Form, type StandardResult, type StandardSchemaV1 } from "@ramonda/form";

/**
 * Every part of `@ramonda/form`, on a page that is rendered by a real server and adopted by a
 * real browser.
 *
 * The questions a jsdom test cannot answer, and the reason this page exists:
 *
 * - does the field proxy survive a server render at all, where there is no event loop waiting
 *   and every getter runs once;
 * - do `name` and `value` reach the HTML, which is what a form that works without JavaScript
 *   would need;
 * - do the generated row ids come out the SAME on both sides, or does hydration renumber every
 *   row and throw the DOM away;
 * - does the hydration blob carry what the form put in it.
 *
 * `scripts/smoke.mjs` asserts the answers against the built bundle.
 */

interface Contact {
  kind: string;
  value: string;
}

interface Signup {
  email: string;
  password: string;
  confirm: string;
  age: number;
  born: Date;
  terms: boolean;
  address: { street: string; city: string };
  tags: string[];
  contacts: Contact[];
}

const DEFAULTS: Signup = {
  email: "",
  password: "",
  confirm: "",
  age: 18,
  born: new Date("1990-01-01"),
  terms: false,
  address: { street: "", city: "" },
  tags: ["ramonda"],
  contacts: [{ kind: "email", value: "" }],
};

/**
 * A schema written straight against the Standard Schema interface.
 *
 * Hand-rolled rather than taken from bguard so this app keeps no dependency on a validator, and
 * the shape is exactly what one produces: every issue collected in one pass, each carrying the
 * path of the field it belongs to. A bguard schema drops in unchanged — it implements the same
 * interface, which is the whole reason the form has no adapter for anything.
 *
 * The cross-field rule is on `confirm` rather than at the root, which is where bguard's own
 * `ctx.ref("password")` would put it, so the message lands under the field the user has to fix.
 */
const schema: StandardSchemaV1<Signup, Signup> = {
  "~standard": {
    version: 1,
    vendor: "playground",
    validate: (value: unknown) => {
      const v = value as Signup;
      const issues: { path: (string | number)[]; message: string }[] = [];

      if (!v.email.includes("@")) issues.push({ path: ["email"], message: "an email address" });
      if (v.password.length < 8) issues.push({ path: ["password"], message: "at least 8 characters" });
      if (v.confirm !== v.password) issues.push({ path: ["confirm"], message: "the same password" });
      if (Number(v.age) < 18) issues.push({ path: ["age"], message: "18 or over" });
      if (!v.terms) issues.push({ path: ["terms"], message: "you have to accept the terms" });
      if (v.address.city === "") issues.push({ path: ["address", "city"], message: "a city" });

      v.tags.forEach((tag, index) => {
        if (tag.trim() === "") issues.push({ path: ["tags", index], message: "a tag cannot be blank" });
      });
      v.contacts.forEach((contact, index) => {
        if (contact.value.trim() === "") {
          issues.push({ path: ["contacts", index, "value"], message: "fill this in or remove the row" });
        }
      });

      // A root issue: it belongs to no single field, so it renders as a form error.
      if (v.tags.length > 4) issues.push({ path: [], message: "four tags is plenty" });

      const result: StandardResult<Signup> = issues.length === 0 ? { value: v } : { issues };
      return result;
    },
  },
};

/** Stands in for the server rejecting a value only it could know about. */
function register(values: Signup): Promise<{ ok: boolean }> {
  return new Promise((resolve) => setTimeout(() => resolve({ ok: values.email !== "taken@example.com" }), 400));
}

@Host("div")
export class SignupPage extends Component {
  private form = this.use(Form<typeof schema>, {
    schema,
    defaultValues: DEFAULTS,
    onSubmit: this.save,
  });

  /** Set once the fake server has accepted, so the page can say so. */
  private accepted = false;

  async save(values: Signup): Promise<void> {
    const answer = await register(values);
    if (answer.ok) {
      this.accepted = true;
      this.form.reset();
      return;
    }
    // The one thing the schema cannot know, arriving the way a real one would.
    this.form.setError("email", "that address is already registered");
  }

  /**
   * One remove handler per ROW ID, not per index.
   *
   * `@memoizedHandler` caches by its arguments, so the same row keeps the same function across
   * renders and the listener is never re-attached. Keyed by the id rather than the index for
   * the same reason the ids exist at all: remove the first tag and every index below it shifts,
   * so a handler built from an index would be pointing at its neighbour a render later.
   */
  @memoizedHandler
  removeTag(id: string) {
    return () => {
      const rows = this.form.fields.tags.$.rows;
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) this.form.fields.tags.$.remove(index);
    };
  }

  addTag(): void {
    this.form.fields.tags.$.append("");
  }

  addContact(): void {
    this.form.fields.contacts.$.append({ kind: "phone", value: "" });
  }

  resetAll(): void {
    this.accepted = false;
    this.form.reset();
  }

  render(): RamondaNode {
    const f = this.form.fields;
    const email = f.email.$;
    const password = f.password.$;
    const confirm = f.confirm.$;
    const age = f.age.$;
    const born = f.born.$;
    const terms = f.terms.$;
    const street = f.address.street.$;
    const city = f.address.city.$;

    return (
      <div className="page signup">
        <h2>Sign up</h2>
        <p>
          Server-rendered, then hydrated. Every input carries a <code>name</code> — which is what a form that works
          without JavaScript would post under — and almost none of them carries an <code>id</code>: `bind` supplies the
          name, and a <code>&lt;label&gt;</code> wrapped around its input needs no id to be associated with it. The few
          ids below are here for `scripts/smoke.mjs` to aim at, not because a form needs them.
        </p>

        <form id="signup" onSubmit={this.form.submit}>
          <label>
            Email
            <input id="email" {...email.bind} />
            {email.error ? <em className="err">{email.error}</em> : null}
          </label>

          <label>
            Password
            <input type="password" {...password.bind} />
            {password.error ? <em className="err">{password.error}</em> : null}
          </label>

          <label>
            Repeat it
            <input type="password" {...confirm.bind} />
            {/* The cross-field rule: editing PASSWORD has to re-answer this one. */}
            {confirm.error ? <em className="err">{confirm.error}</em> : null}
          </label>

          <label>
            Age
            <input {...age.bind} />
            {age.error ? <em className="err">{age.error}</em> : null}
          </label>

          <label>
            Born
            <input {...born.bind} />
          </label>

          <label className="inline">
            <input {...terms.bind} /> I accept the terms
          </label>
          {terms.error ? <em className="err">{terms.error}</em> : null}

          <fieldset>
            <legend>Address — a nested object</legend>
            <label>
              Street
              <input {...street.bind} />
            </label>
            <label>
              City
              <input {...city.bind} />
              {city.error ? <em className="err">{city.error}</em> : null}
            </label>
          </fieldset>

          <fieldset>
            <legend>Tags — an array of primitives</legend>
            {/*
              Keyed by the row's generated id rather than by its index. Remove the first tag and
              every index below it shifts; the id does not, so the reconciler keeps each row's
              element and whatever focus was in it.
            */}
            <ul id="tags">
              {list({
                each: f.tags.$.rows,
                key: (row) => row.id,
                render: (row) => (
                  <li>
                    <input className="tag" {...row.field.$.bind} />
                    <button type="button" className="remove-tag ghost" onClick={this.removeTag(row.id)}>
                      remove
                    </button>
                    {row.field.$.error ? <em className="err">{row.field.$.error}</em> : null}
                  </li>
                ),
              })}
            </ul>
            <button type="button" id="add-tag" className="ghost" onClick={this.addTag}>
              add a tag
            </button>
          </fieldset>

          <fieldset>
            <legend>Contacts — an array of objects</legend>
            <ul>
              {list({
                each: f.contacts.$.rows,
                key: (row) => row.id,
                render: (row) => (
                  <li className="pair">
                    <input {...row.field.kind.$.bind} />
                    <input {...row.field.value.$.bind} />
                    {row.field.value.$.error ? <em className="err">{row.field.value.$.error}</em> : null}
                  </li>
                ),
              })}
            </ul>
            <button type="button" className="ghost" onClick={this.addContact}>
              add a contact
            </button>
          </fieldset>

          {this.form.formErrors.length > 0 ? (
            <p className="err form-errors">{this.form.formErrors.join(", ")}</p>
          ) : null}

          {this.accepted ? <p className="accepted">Registered. The form has been put back to its defaults.</p> : null}

          <p className="actions">
            <button type="submit" disabled={this.form.isSubmitting}>
              {this.form.isSubmitting ? "Sending\u2026" : "Sign up"}
            </button>
            <button type="button" onClick={this.resetAll}>
              Reset
            </button>
          </p>
        </form>

        {/* A readout, so the smoke test and a reader can both see the state without clicking. */}
        <dl className="readout">
          <dt>valid</dt>
          <dd id="s-valid">{String(this.form.isValid)}</dd>
          <dt>dirty</dt>
          <dd id="s-dirty">{String(this.form.isDirty)}</dd>
          <dt>submits</dt>
          <dd id="s-submits">{String(this.form.submitCount)}</dd>
          <dt>tag rows</dt>
          <dd id="s-rowids">{f.tags.$.rows.map((row) => row.id).join(",")}</dd>
          <dt>accepted</dt>
          <dd id="s-accepted">{String(this.accepted)}</dd>
        </dl>
      </div>
    );
  }
}
