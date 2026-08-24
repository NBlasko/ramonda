import { Component, Host, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;
declare const which: string;
const ZIP = "zipcode";

@Host("div")
class App extends Component {
  render() {
    return (
      <form>
        {/* ✗ The near miss that reads as deliberate. */}
        <input type="text" autocomplete="fullname" />

        {/* ✗ Two more of the same family. */}
        <input type="text" autocomplete="zip" />
        <input type="tel" autocomplete="phone" />

        {/* ✗ A group word with no field after it — the commonest near miss of all. */}
        <input type="text" autocomplete="billing" />

        {/* ✗ The value one hop away, which the reader follows. */}
        <input type="text" autocomplete={ZIP} />

        {/* ✗ A `<select>` and a `<textarea>` fill too. */}
        <select autocomplete="creditcard" />
        <textarea autocomplete="streetaddress" />

        {/* ✓ The real names. */}
        <input type="text" autocomplete="name" />
        <input type="text" autocomplete="postal-code" />
        <input type="text" autocomplete="address-level2" />

        {/* ✓ A group word in FRONT of a field, which is where it belongs. */}
        <input type="text" autocomplete="shipping street-address" />
        <input type="tel" autocomplete="work tel" />

        {/* ✓ A `section-` prefix, and a trailing `webauthn`. */}
        <input type="text" autocomplete="section-blue billing cc-number" />
        <input type="text" autocomplete="username webauthn" />

        {/* ✓ The two switches, which are the whole value. */}
        <input type="text" autocomplete="off" />
        <input type="password" autocomplete="on" />

        {/* ✓ A value this cannot read is not judged. */}
        <input type="text" autocomplete={which} />

        {/* ✓ An empty value says nothing either way. */}
        <input type="text" autocomplete="" />

        {/* ✓ A spread after it may replace it. */}
        <input type="text" autocomplete="fullname" {...rest} />

        {/* ✗ But a spread BEFORE it cannot reach over it. */}
        <input type="text" {...rest} autocomplete="fullname" />

        {/* ✓ A `<div>` is not something a browser fills. */}
        <div autocomplete="fullname">x</div>
      </form>
    );
  }
}

/** ✗ The same value written where a component configures its own element. */
@Host("input", () => ({ autocomplete: "fullname" }))
class ConfiguredHost extends Component {
  render() {
    return <span>host</span>;
  }
}

bootstrap(
  <div>
    <App />
    <ConfiguredHost />
  </div>,
  null,
);
