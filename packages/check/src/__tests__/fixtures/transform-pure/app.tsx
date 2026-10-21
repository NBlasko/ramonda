import { Component, Select, TextArea } from "@ramonda/core";
import {
  counted,
  fetched,
  handsOn,
  marks,
  viaHelper,
  noBlocked,
  configured,
  frozen,
  loose,
  handsOnAnArrow,
  globalDigits,
  dated,
  throughAHelperThatEmpties,
  mappedWithAnArrow,
  max20,
  maxLength,
  phoneMask,
  rebinds,
  stamped,
} from "./masks";
import { fromAPackage } from "./lib";

declare const value: string;

class Fields extends Component<{ transform: (next: string, prev: string) => string }> {
  limit = 3;
  type(_event: Event) {}
  upper(next: string): string {
    return next.toUpperCase();
  }
  capped(next: string, prev: string): string {
    return next.length <= this.limit ? next : prev;
  }
  logged(next: string): string {
    console.log(next);
    return next;
  }
  render() {
    return (
      <form>
        {/* ✓ pure */}
        <input aria-label="method" value={value} oninput={this.type} transform={this.upper} />
        <input aria-label="imported" value={value} oninput={this.type} transform={phoneMask} />
        <input aria-label="factory const" value={value} oninput={this.type} transform={max20} />
        <input aria-label="rebinds" value={value} oninput={this.type} transform={rebinds} />
        <input aria-label="frozen" value={value} oninput={this.type} transform={frozen} />
        <input
          aria-label="a set it makes"
          value={value}
          oninput={this.type}
          transform={(next: string, prev: string) => (new Set(next).size <= 3 ? next : prev)}
        />
        <TextArea aria-label="arrow" value={value} oninput={this.type} transform={(next: string) => next.trim()} />
        <Select aria-label="select" value={value} onchange={this.type} transform={this.upper}>
          <option value="a">a</option>
        </Select>
        {/* ✗ impure */}
        <input aria-label="reads this" value={value} oninput={this.type} transform={this.capped} />
        <input aria-label="logs" value={value} oninput={this.type} transform={this.logged} />
        <input aria-label="counts" value={value} oninput={this.type} transform={counted} />
        <input aria-label="clock" value={value} oninput={this.type} transform={stamped} />
        <input aria-label="network" value={value} oninput={this.type} transform={fetched} />
        <input aria-label="blocked set" value={value} oninput={this.type} transform={noBlocked} />
        <input aria-label="plain config" value={value} oninput={this.type} transform={configured} />
        <input aria-label="loose factory" value={value} oninput={this.type} transform={loose} />
        <input aria-label="const arrow handed on" value={value} oninput={this.type} transform={handsOnAnArrow} />
        <input aria-label="factory handed a function" value={value} oninput={this.type} transform={mappedWithAnArrow} />
        <input aria-label="bare date" value={value} oninput={this.type} transform={dated} />
        <input
          aria-label="helper empties its parameter"
          value={value}
          oninput={this.type}
          transform={throughAHelperThatEmpties}
        />
        <input aria-label="a global regex" value={value} oninput={this.type} transform={globalDigits} />
        <input aria-label="via helper" value={value} oninput={this.type} transform={viaHelper} />
        <input aria-label="hands on" value={value} oninput={this.type} transform={handsOn} />
        <input aria-label="marks input" value={value} oninput={this.type} transform={marks} />
        {/* ✗ unreadable */}
        <input aria-label="from a package" value={value} oninput={this.type} transform={fromAPackage} />
        <input aria-label="from props" value={value} oninput={this.type} transform={this.props.transform} />
        {/* ✗ built-in-render */}
        <input aria-label="made in render" value={value} oninput={this.type} transform={maxLength(20)} />
        {/* ✗ uncontrolled */}
        <input aria-label="uncontrolled" defaultValue="x" transform={this.upper} />
        {/* ✓ an SVG transform is an attribute, and not this rule's */}
        <svg aria-hidden="true">
          <g transform="translate(10, 0)" />
        </svg>
      </form>
    );
  }
}

export { Fields };
