import { Component, Host, bootstrap } from "../framework";

/**
 * Every way a control can be named, beside the two ways it can fail to be.
 *
 * The `htmlFor` half is why these rules live with the id table: `<label htmlFor="email">` is in
 * this file and `id="email"` could as easily be in another. The pairing is a project fact.
 */
@Host("form")
class Signup extends Component {
  render() {
    return (
      <form>
        {/* Not reported: a label points at it by id. */}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" />

        {/* Not reported: a label wraps it. */}
        <label>
          Password
          <input type="password" />
        </label>

        {/* Not reported: a label wraps it two levels up. */}
        <label>
          <span>Postcode</span>
          <div>
            <input type="text" />
          </div>
        </label>

        {/* Not reported: named outright. */}
        <input type="text" aria-label="Search" />
        <input type="text" aria-labelledby="email" />
        <input type="text" title="Middle name" />
        <select aria-label="Country">
          <option>RS</option>
        </select>

        {/* Not reported: these are named by their value, or not rendered. */}
        <input type="submit" value="Send" />
        <input type="hidden" value="x" />

        {/* REPORTED by `control-with-no-label` — nothing anywhere says what it is for. */}
        <input type="text" />
        <textarea />

        {/* REPORTED by `named-only-by-a-placeholder` — a name that exists only while it is empty. */}
        <input type="text" placeholder="you@example.com" />

        {/* Not reported by either: a placeholder BESIDE a real name is a hint, which is its job. */}
        <input type="text" aria-label="Email" placeholder="you@example.com" />
      </form>
    );
  }
}

bootstrap(<Signup />, null);
