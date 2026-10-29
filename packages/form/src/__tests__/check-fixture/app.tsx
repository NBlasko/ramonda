import { Component } from "@ramonda/core";
import { Form, type StandardSchemaV1 } from "@ramonda/form";

declare const schema: StandardSchemaV1<{ age: number; born: Date; name: string }>;

export class Signup extends Component {
  private f = this.use(Form<typeof schema>, () => ({
    schema,
    defaultValues: { age: 30, born: new Date(2000, 0, 1), name: "" },
    onSubmit: () => {},
  }));

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
      </form>
    );
  }
}
