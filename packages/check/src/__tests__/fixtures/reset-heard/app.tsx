import { Component, Select } from "@ramonda/core";
import { Form } from "@ramonda/form";

declare const value: string;
declare const rows: string[];
declare const kind: string;
declare const busy: boolean;
const HIDDEN = "hidden";

class Child extends Component {
  render() {
    return <span>child</span>;
  }
}

/** Has its own reset, declared. */
class Counter {
  count = 0;
  reset(): void {
    this.count = 0;
  }
}

class Resets extends Component<{ children?: unknown }> {
  form = this.use(Form, {});
  counter = new Counter();
  type(_event: Event) {}
  label = "x";

  clear(event: Event) {
    // ✓ a declared reset, a hook's, and a field of a hook's through a const
    this.counter.reset();
    this.form.reset();
    const city = this.form.fields.city.$;
    city.reset();
    // ✗ the browser's
    (event.currentTarget as HTMLFormElement).reset();
  }

  render() {
    return (
      <div>
        {/* ✓ uncontrolled fields, written here — rows through list/map included */}
        <form>
          <input aria-label="a" defaultValue="a" />
          <Select aria-label="size" defaultValue="m">
            <option value="m">m</option>
          </Select>
          {rows.map((row) => (
            <input aria-label={row} defaultValue={row} />
          ))}
          {value ? <span>yes</span> : null}
          <button type="reset">ok reset</button>
        </form>
        {/* ✓ a reset button, a submit and a hidden value: none of them is edited */}
        <form>
          <input aria-label="q" name="q" defaultValue="" />
          <input type="hidden" name="csrf" value={value} />
          <input type="submit" value="Send" />
          <input type="reset" value="Start over" />
          <input type="hidden" {...this.props} />
        </form>
        {/* ✗ controlled field */}
        <form>
          <input aria-label="b" value={value} oninput={this.type} />
          <button type="reset">controlled reset</button>
        </form>
        {/* ✗ a box whose type is written in capitals is a box */}
        <form>
          <input aria-label="capital box" type="Checkbox" checked={true} oninput={this.type} />
          <button type="reset">capital reset</button>
        </form>
        {/* ✗ controlled box */}
        <form>
          <input aria-label="c" type="checkbox" checked={true} oninput={this.type} />
          <input type="reset" value="box reset" />
        </form>
        {/* ✗ a component */}
        <form>
          <Child />
          <button type="reset">component reset</button>
        </form>
        {/* ✗ children */}
        <form>
          {this.props.children}
          <button type="reset">children reset</button>
        </form>
        {/* ✗ a reset written in braces, and one whose type cannot be read, over a controlled field */}
        <form>
          <input aria-label="braced reset field" value={value} oninput={this.type} />
          <button type={"reset"}>braced reset button</button>
        </form>
        <form>
          <input aria-label="unread reset field" value={value} oninput={this.type} />
          <button type={this.label as "reset"}>unread reset button</button>
        </form>
        {/* ✓ a button of an unread type over uncontrolled fields */}
        <form>
          <input aria-label="unread ok field" defaultValue="x" />
          <button type={this.label as "button"}>unread ok button</button>
        </form>
        {/* ✓ a password field that switches its type is a field, not a reset — in a form or out */}
        <input
          aria-label="password out"
          type={this.label === "x" ? "text" : "password"}
          value={value}
          oninput={this.type}
        />
        <form>
          <input
            aria-label="password in"
            type={this.label === "x" ? "text" : "password"}
            value={value}
            oninput={this.type}
          />
        </form>
        {/* ✓ a button that may reset, outside any form or naming another, is asked nothing */}
        <button type={this.label as "button"}>unread loose button</button>
        <button type={this.label as "button"} form="elsewhere-form">
          unread elsewhere button
        </button>
        {/* ✗ a button whose type a spread may carry, over a controlled field */}
        <form>
          <input aria-label="spread button field" value={value} oninput={this.type} />
          <button {...this.props}>spread button</button>
        </form>
        {/* ✗ a box whose type cannot be read, with its `checked` */}
        <form>
          <input aria-label="unread box" type={kind} checked={true} onchange={this.type} />
          <button type="reset">unread box reset</button>
        </form>
        {/* ✓ a hidden value through a const is not edited */}
        <form>
          <input aria-label="hidden const" type={HIDDEN} name="id" value={value} />
          <button type="reset">hidden const reset</button>
        </form>
        {/* ✗ an unread type with `value` written as nothing and a `checked` that holds the model */}
        <form>
          <input aria-label="nothing then checked" type={kind} value={undefined} checked={true} onchange={this.type} />
          <button type="reset">nothing then checked reset</button>
        </form>
        {/* ✓ a button that is a button or a submit, never a reset, over a controlled field */}
        <form>
          <input aria-label="toggled submit field" value={value} oninput={this.type} />
          <button type={busy ? "button" : "submit"}>toggled submit</button>
        </form>
        {/* ✗ a spread on a field may carry its value */}
        <form>
          <input aria-label="spread field" {...this.props} />
          <button type="reset">spread reset</button>
        </form>
        {/* ✗ a box whose type is written in braces is a box */}
        <form>
          <input aria-label="braced box" type={"checkbox"} checked={true} onchange={this.type} />
          <button type="reset">braced reset</button>
        </form>
        {/* ✗ what `??` renders first is its left side */}
        <form>
          {this.props.children ?? <p>None</p>}
          <button type="reset">fallback reset</button>
        </form>
        {/* ✗ a form any field may join by its id */}
        <form id="joined">
          <input aria-label="joined field" defaultValue="x" />
          <button type="reset">joined reset</button>
        </form>
        {/* ✗ a value */}
        <form>
          {this.label}
          <button type="reset">value reset</button>
        </form>
        {/* ✗ no form, and one naming another form */}
        <button type="reset">loose reset</button>
        <button type="reset" form="other">
          elsewhere reset
        </button>
        {/* ✓ not a reset */}
        <button type="button" onclick={this.clear}>
          clear
        </button>
      </div>
    );
  }
}

export { Resets };
