import { Component, Select, bootstrap } from "@ramonda/core";

declare const value: string;
declare const options: { id: string; label: string }[];
declare const rest: Record<string, unknown>;

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ `Select` sets `selected` from `value` on every option, so this is overwritten. */}
        <Select value={value} aria-label="A">
          <option value="a" selected>
            A
          </option>
          <option value="b">B</option>
        </Select>

        {/* ✗ Written `selected={true}`, which reaches the option the same way. */}
        <Select value={value} aria-label="B">
          <option value="a" selected={true}>
            A
          </option>
        </Select>

        {/* ✗ Nested one level down, which is how a grouped select is written. */}
        <Select value={value} aria-label="C">
          <optgroup label="Hot">
            <option value="a" selected>
              A
            </option>
          </optgroup>
        </Select>

        {/* ✓ No `selected` at all — `value` decides, which is the whole point of the component. */}
        <Select value={value} aria-label="D">
          <option value="a">A</option>
          <option value="b">B</option>
        </Select>

        {/* ✓ Built from data, which this cannot read. */}
        <Select value={value} aria-label="E">
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>

        {/* ✓ `selected={false}` says the opposite and is not a claim to be overwritten. */}
        <Select value={value} aria-label="F">
          <option value="a" selected={false}>
            A
          </option>
        </Select>

        {/* ✓ A spread may carry it, and nothing here can say it does. */}
        <Select value={value} aria-label="G">
          <option value="a" {...rest}>
            A
          </option>
        </Select>
      </div>
    );
  }
}

bootstrap(<App />, null);
