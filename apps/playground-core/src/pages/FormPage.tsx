import { Component, list, memoized, state } from "@ramonda/core";
import { Form, type StandardResult, type StandardSchemaV1 } from "@ramonda/form";

/**
 * Two forms on one page, so the devtools FORMS tab has something with shape to it.
 *
 * The SSR playground's `SignupPage` covers the WIDTH of `@ramonda/form` — every field type, arrays,
 * nested objects, a server render and a hydration. This page is for the panel instead: two live
 * forms are two groups, one is valid and one is not, and the two `validateOn` settings put a field
 * in the state people ask about — an error on something they have not typed in yet.
 *
 * Open the panel (Alt+D), switch to FORMS, and use the page. Nothing here talks to devtools; the
 * tab exists because `@ramonda/form` registers it.
 */

/* ── Sign-in: small, and valid as soon as it is filled ──────────────────── */

interface SignIn {
  email: string;
  password: string;
}

const signInSchema: StandardSchemaV1<SignIn, SignIn> = {
  "~standard": {
    version: 1,
    vendor: "playground",
    validate: (value) => {
      const values = value as SignIn;
      const issues = [
        ...(values.email.includes("@") ? [] : [{ message: "needs an @", path: ["email"] }]),
        ...(values.password.length >= 8 ? [] : [{ message: "at least 8 characters", path: ["password"] }]),
      ];
      return (issues.length > 0 ? { issues } : { value: values }) as StandardResult<SignIn>;
    },
  },
};

const SIGN_IN_BLANK: SignIn = { email: "", password: "" };

class SignInForm extends Component {
  @state private sent = "";

  private form = this.use(Form<typeof signInSchema>, (self: SignInForm) => ({
    schema: signInSchema,
    defaultValues: SIGN_IN_BLANK,
    // Validates as you type, so the FORMS tab shows an error appearing and clearing per keystroke.
    validateOn: "change" as const,
    onSubmit: (values: SignIn) => {
      self.sent = `signed in as ${values.email}`;
    },
  }));

  render() {
    const f = this.form.fields;

    return (
      <div className="panel">
        <p className="label">sign in · validateOn: "change"</p>

        <form onsubmit={this.form.submit}>
          <label>
            email
            <input {...f.email.$.bind} type="email" />
          </label>
          {f.email.$.error ? <p className="error small">{f.email.$.error}</p> : null}

          <label>
            password
            <input {...f.password.$.bind} type="password" />
          </label>
          {f.password.$.error ? <p className="error small">{f.password.$.error}</p> : null}

          <button type="submit" disabled={!this.form.isValid}>
            Sign in
          </button>
        </form>

        <p className="muted small">
          {this.form.isValid ? "valid" : "invalid"} · {this.form.isDirty ? "edited" : "untouched"} ·{" "}
          {this.form.submitCount} submits
        </p>
        {this.sent ? <p className="small">{this.sent}</p> : null}
      </div>
    );
  }
}

/* ── Profile: bigger, and only complains when you submit ─────────────────── */

interface Profile {
  name: string;
  bio: string;
  tags: string[];
}

const profileSchema: StandardSchemaV1<Profile, Profile> = {
  "~standard": {
    version: 1,
    vendor: "playground",
    validate: (value) => {
      const values = value as Profile;
      const issues = [
        ...(values.name.trim() ? [] : [{ message: "who are you?", path: ["name"] }]),
        ...(values.bio.length <= 140 ? [] : [{ message: "140 characters at most", path: ["bio"] }]),
        ...values.tags.flatMap((tag, index) =>
          tag.trim() ? [] : [{ message: "an empty tag", path: ["tags", index] }],
        ),
      ];
      return (issues.length > 0 ? { issues } : { value: values }) as StandardResult<Profile>;
    },
  },
};

const PROFILE_BLANK: Profile = { name: "", bio: "", tags: ["ramonda"] };

class ProfileForm extends Component {
  /**
   * A METHOD rather than an arrow written in `render()`, which is the form a list should reach for.
   *
   * An inline callback is a fresh function every render, so the engine cannot know what it closed over
   * and rebuilds every row. A method cannot capture a render's locals, so its rows are reused — and it
   * reads everything it needs INSIDE itself, where reads are tracked. See `list()`'s own doc.
   */
  private tagRow(row: { field: { $: { bind: unknown } }; index: number }) {
    return (
      <div className="row">
        <input {...(row.field.$.bind as Record<string, unknown>)} />
        <button type="button" onclick={this.removeTag(row.index)}>
          ×
        </button>
      </div>
    );
  }

  /**
   * Bound per argument, so the row's × is the SAME function across renders.
   *
   * `onClick={() => f.tags.$.remove(row.index)}` is a fresh closure every render, which RMD020
   * reports — and this page should be the model rather than the counter-example.
   *
   * The decorator sat on `tagRow` until `unkeyable-memoized-argument` said so: a doc comment written
   * between the two had left it on the member above, which takes an OBJECT and returns markup. A
   * cache key holds a string, a number or a boolean, so that call could never be memoised — and in
   * development it throws, the moment the list has a row in it.
   */
  @memoized
  private removeTag(index: number): () => void {
    return () => this.form.fields.tags.$.remove(index);
  }

  private form = this.use(Form<typeof profileSchema>, () => ({
    schema: profileSchema,
    defaultValues: PROFILE_BLANK,
    /**
     * The default, and the interesting one for the panel.
     *
     * The PAGE shows nothing until you submit — a message on a field nobody has typed in is noise.
     * The TAB shows every one of them, each marked `never interacted with`, which is the pairing
     * that answers "it says this is required and I have not touched it". Seeing what the form knows
     * before it is willing to say it is most of why the tab is worth having.
     */
    validateOn: "submit" as const,
    onSubmit: () => {},
  }));

  /** Methods, not closures: auto-bound, so their identity never moves. */
  private addTag(): void {
    this.form.fields.tags.$.append("");
  }

  private resetForm(): void {
    this.form.reset();
  }

  render() {
    const f = this.form.fields;

    return (
      <div className="panel">
        <p className="label">profile · validateOn: "submit"</p>

        <form onsubmit={this.form.submit}>
          <label>
            name
            <input {...f.name.$.bind} />
          </label>
          {f.name.$.error ? <p className="error small">{f.name.$.error}</p> : null}

          <label>
            bio
            <textarea {...f.bio.$.bind} rows={2} />
          </label>
          {f.bio.$.error ? <p className="error small">{f.bio.$.error}</p> : null}

          <p className="label">tags</p>
          {list(f.tags.$.rows, this.tagRow)}
          <button type="button" onclick={this.addTag}>
            + tag
          </button>

          <button type="submit">Save</button>
          <button type="button" onclick={this.resetForm}>
            Reset
          </button>
        </form>

        <p className="muted small">
          {this.form.isValid ? "valid" : "invalid"} · {this.form.submitCount} submits
        </p>
      </div>
    );
  }
}

export class FormPage extends Component {
  render() {
    return (
      <section>
        <h1>Forms</h1>
        <p className="muted">
          Two live forms. Open the devtools (Alt+D) and switch to <strong>FORMS</strong>: each is a group, a valid one
          is a single row, and a broken one gets a row per field that is wrong.
        </p>

        <div className="grid">
          <SignInForm />
          <ProfileForm />
        </div>
      </section>
    );
  }
}
