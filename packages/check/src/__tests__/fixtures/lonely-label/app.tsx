import { Component, Host, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;
declare const editing: boolean;
declare const id: string;

/** A form component that renders its own control. */
@Host("input")
class TextField extends Component {
  render() {
    return null;
  }
}

@Host("div")
class App extends Component {
  render() {
    return (
      <form>
        {/* ✗ Names nothing, and clicking it focuses nothing. */}
        <label>Email</label>

        {/* ✗ The same with markup inside that is not a control. */}
        <label>
          <span>Email</span> <em>required</em>
        </label>

        {/* ✓ `htmlFor` written out. */}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" />

        {/* ✓ An `htmlFor` this cannot READ is still written. Whether it points anywhere is
            `reference-to-an-id-that-is-not-there`'s question. */}
        <label htmlFor={id}>Email</label>

        {/* ✓ The control written inside it, which needs no id at all. */}
        <label>
          Email <input type="email" />
        </label>

        {/* ✓ Nested one element deeper. */}
        <label>
          <span>
            Email <input type="email" />
          </span>
        </label>

        {/* ✓ A COMPONENT may be the control, and what it renders is decided inside it. */}
        <label>
          Email <TextField />
        </label>

        {/* ✓ Anything in an expression may hold one. */}
        <label>Email {editing && <input type="email" />}</label>

        {/* ✓ A spread may be carrying the `htmlFor`. */}
        <label {...rest}>Email</label>

        {/* ✓ A `<select>` and a `<textarea>` are controls too. */}
        <label>
          Country <select />
        </label>
        <label>
          Notes <textarea />
        </label>
      </form>
    );
  }
}

bootstrap(<App />, null);
