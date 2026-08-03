import { Component, Host, list, memoizedHandler } from "@ramonda/core";
import { Form, type StandardResult, type StandardSchemaV1 } from "@ramonda/form";

// A whole form: fields, a cross-field rule, an array with rows that keep their
// identity, and a submit that can fail on the server.
//
// The schema is hand-written against the Standard Schema interface so this page
// pulls in no validator. A bguard, zod, valibot or arktype schema drops straight
// in — they all implement the same interface, which is why the form needs no
// adapter for any of them.

interface Signup {
  email: string;
  password: string;
  confirm: string;
  tags: string[];
}

const DEFAULTS: Signup = { email: "", password: "", confirm: "", tags: ["ramonda"] };

const schema: StandardSchemaV1<Signup, Signup> = {
  "~standard": {
    version: 1,
    vendor: "docs",
    validate: (value: unknown) => {
      const v = value as Signup;
      const issues: { path: (string | number)[]; message: string }[] = [];

      if (!v.email.includes("@")) issues.push({ path: ["email"], message: "an email address" });
      if (v.password.length < 8) issues.push({ path: ["password"], message: "at least 8 characters" });
      // The cross-field rule. It reads `password` but lands on `confirm`, so the
      // message appears under the field the reader has to fix.
      if (v.confirm !== v.password) issues.push({ path: ["confirm"], message: "the same password" });

      v.tags.forEach((tag, index) => {
        if (tag.trim() === "") issues.push({ path: ["tags", index], message: "a tag cannot be blank" });
      });
      // A root issue: it belongs to no single field, so it renders as a form error.
      if (v.tags.length > 3) issues.push({ path: [], message: "three tags is plenty" });

      const result: StandardResult<Signup> = issues.length === 0 ? { value: v } : { issues };
      return result;
    },
  },
};

/** Stands in for a server that knows something the schema cannot. */
function register(values: Signup): Promise<{ ok: boolean }> {
  return new Promise((resolve) => setTimeout(() => resolve({ ok: values.email !== "taken@example.com" }), 600));
}

@Host("div")
export class FormDemo extends Component {
  private form = this.use(Form<typeof schema>, {
    schema,
    defaultValues: DEFAULTS,
    onSubmit: this.save,
  });

  private accepted = false;

  async save(values: Signup): Promise<void> {
    const answer = await register(values);
    if (answer.ok) {
      this.accepted = true;
      this.form.reset();
      return;
    }
    this.form.setError("email", "that address is already registered");
  }

  // Keyed by the row's ID rather than its index: remove the first tag and every
  // index below it shifts, so a handler built from an index would be pointing at
  // its neighbour a render later.
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

  // `move` rather than remove-then-insert: the row keeps its id, so it keeps its element and
  // whatever you had typed or selected in it.
  @memoizedHandler
  moveTagUp(id: string) {
    return () => {
      const rows = this.form.fields.tags.$.rows;
      const index = rows.findIndex((row) => row.id === id);
      if (index > 0) this.form.fields.tags.$.move(index, index - 1);
    };
  }

  render() {
    const f = this.form.fields;
    const email = f.email.$;
    const password = f.password.$;
    const confirm = f.confirm.$;

    return (
      <form className="demo-form" onSubmit={this.form.submit}>
        <label>
          Email
          <input {...email.bind} />
          {email.error ? <em className="demo-error">{email.error}</em> : null}
        </label>

        <label>
          Password
          <input type="password" {...password.bind} />
          {password.error ? <em className="demo-error">{password.error}</em> : null}
        </label>

        <label>
          Repeat it
          <input type="password" {...confirm.bind} />
          {confirm.error ? <em className="demo-error">{confirm.error}</em> : null}
        </label>

        <fieldset>
          <legend>Tags</legend>
          <ul className="demo-rows">
            {list({
              each: f.tags.$.rows,
              key: (row) => row.id,
              render: (row) => (
                <li>
                  <input {...row.field.$.bind} />
                  <button type="button" onClick={this.moveTagUp(row.id)} disabled={row.index === 0}>
                    up
                  </button>
                  <button type="button" onClick={this.removeTag(row.id)}>
                    remove
                  </button>
                  {row.field.$.error ? <em className="demo-error">{row.field.$.error}</em> : null}
                </li>
              ),
            })}
          </ul>
          <button type="button" onClick={this.addTag}>
            add a tag
          </button>
        </fieldset>

        {this.form.formErrors.length > 0 ? <p className="demo-error">{this.form.formErrors.join(", ")}</p> : null}
        {this.accepted ? <p className="demo-ok">Registered. The form is back to its defaults.</p> : null}

        <p>
          <button type="submit" disabled={this.form.isSubmitting}>
            {this.form.isSubmitting ? "Sending…" : "Sign up"}
          </button>
        </p>

        <p className="demo-log">
          valid {String(this.form.isValid)} · dirty {String(this.form.isDirty)} · submits{" "}
          {String(this.form.submitCount)}
        </p>
      </form>
    );
  }
}
