import { Component } from "@ramonda/core";
import { Form, type StandardSchemaV1 } from "@ramonda/form";

// A `type` that may be left off — read as what it is, or text — in a project with strict null checks,
// which the check's own fixtures are not.
declare const maybeEmail: "email" | undefined;
/** A type a form fits, its handler typed as an event handler is: a function of the event, or `null`. */
declare const formLike: { reset(): void; onclick: ((event: PointerEvent) => void) | null };
/** One it does not: a handler that takes nothing cannot be a form's, which is handed its event. */
declare const notAForm: { reset(): void; onclick: (() => void) | null };
declare const maybeNumber: "number" | undefined;
declare const schema: StandardSchemaV1<{ age: number; born: Date; name: string }>;

export class Signup extends Component {
  private f = this.use(Form<typeof schema>, () => ({
    schema,
    defaultValues: { age: 30, born: new Date(2000, 0, 1), name: "" },
    onSubmit: () => {},
  }));

  clear() {
    formLike.reset();
    notAForm.reset();
  }

  render() {
    const { age, born, name } = this.f.fields;
    return (
      <form>
        <input type="number" aria-label="age" value={age.$.inputValue} oninput={age.$.oninput} />
        <input aria-label="age as text" value={age.$.inputValue} oninput={age.$.oninput} />
        <input type="date" aria-label="born" value={born.$.inputValue} oninput={born.$.oninput} />
        <input aria-label="born as text" value={born.$.inputValue} oninput={born.$.oninput} />
        <input aria-label="name" value={name.$.inputValue} oninput={name.$.oninput} />
        <input type="range" aria-label="name on a slider" value={name.$.inputValue} oninput={name.$.oninput} />
        <input type={maybeEmail} aria-label="name, its type left off or email" value={name.$.inputValue} />
        <input type={maybeNumber} aria-label="age, its type left off or number" value={age.$.inputValue} />
      </form>
    );
  }
}
