import { Component, Select } from "@ramonda/core";
import { Form } from "@ramonda/form";

declare const value: string;
declare const rows: string[];

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
        {/* ✗ controlled field */}
        <form>
          <input aria-label="b" value={value} oninput={this.type} />
          <button type="reset">controlled reset</button>
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
