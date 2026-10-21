import { Component, Select, TextArea, list } from "@ramonda/core";
import * as ui from "@ramonda/core";

declare const value: string;
declare const on: boolean;
declare const viewing: boolean;
declare const bag: Record<string, unknown>;
const EMPTY = "";
const LOCKED = true;

import { htmlConstraints } from "@ramonda/form/bguard";
import { htmlConstraints as lookalike } from "./mine";

const html = htmlConstraints({});
const fake = lookalike({});

/** A wrapper whose caller may leave the handler out. */
class Loose extends Component<{ value: string; oninput?: (event: Event) => void }> {
  render() {
    return <TextArea value={this.props.value} oninput={this.props.oninput} aria-label="optional handler" />;
  }
}

/** A wrapper whose caller has to give the handler. */
class Strict extends Component<{ value: string; oninput: (event: Event) => void }> {
  render() {
    return <TextArea value={this.props.value} oninput={this.props.oninput} aria-label="required handler" />;
  }
}

class App extends Component<{ text: string; rows: { text: string }[]; attrs?: Record<string, unknown> }> {
  rows = [{ text: "a", size: "s" }];
  overrides: Record<string, unknown> = {};
  pick(_event: Event) {}
  type(_event: Event) {}
  render() {
    return (
      <form oninput={this.type}>
        {/* ✗ no-handler — on the field itself, whatever is around it or wherever the value comes from */}
        <Select value={value} aria-label="held select">
          <option value="a">a</option>
        </Select>
        <TextArea value={value} aria-label="held text" />
        <TextArea value={this.props.text} aria-label="from props" />
        {list(this.rows, (row) => (
          <TextArea value={row.text} aria-label="a list row" />
        ))}
        {this.props.rows.map((row) => (
          <ui.TextArea value={row.text} aria-label="a namespaced row from props" />
        ))}
        <TextArea value={value} onkeydown={this.type} aria-label="keydown only" />
        <TextArea value={value} readOnly={viewing} aria-label="maybe read only" />
        <input value={value} aria-label="held input" />
        <input type="checkbox" checked={on} aria-label="held box" />
        <input type="checkbox" checked={on} readonly aria-label="readonly box" />
        <Select value={value} readonly aria-label="readonly select">
          <option value="a">a</option>
        </Select>
        {/* ✗ held-between-keystrokes */}
        <TextArea value={value} onchange={this.type} aria-label="saved on blur" />
        <input value={value} onchange={this.type} aria-label="input saved on blur" />
        {/* ✗ both */}
        <TextArea value={value} defaultValue="x" oninput={this.type} aria-label="both" />
        <input type="checkbox" checked={on} defaultChecked oninput={this.type} aria-label="both boxes" />
        {/* ✗ literal */}
        <TextArea value="" oninput={this.type} aria-label="literal value" />
        <TextArea value={EMPTY} oninput={this.type} aria-label="literal through a const" />
        <input value={-1} oninput={this.type} aria-label="negative literal input" />
        {/* ✗ unknown-spread */}
        <TextArea value={value} {...bag} aria-label="unknown spread" />
        <input {...bag} aria-label="unknown spread without a value" />
        <input {...fake("nick")} value={value} oninput={this.type} aria-label="an app's own constraints" />
        <input {...html("nick")} value={value} aria-label="constraints and no handler" />
        <input value={value} oninput={this.type} {...this.overrides} aria-label="own field spread" />
        <input {...this.overrides} defaultValue="saved" aria-label="a spread and a default" />

        {/* ✓ a handler of its own */}
        <Select value={value} onchange={this.pick} aria-label="picked">
          <option value="a">a</option>
        </Select>
        <Select value={value} oninput={this.pick} aria-label="picked on input">
          <option value="a">a</option>
        </Select>
        <TextArea value={value} oninput={this.type} aria-label="typed" />
        <input value={value} oninput={this.type} aria-label="typed input" />
        <input type="checkbox" checked={on} onchange={this.pick} aria-label="ticked" />
        <input type="radio" name="r" value="a" checked={on} oninput={this.pick} aria-label="radio picked" />
        {/* ✓ the schema's constraints carry nothing a field is written with */}
        <input {...html("nick")} value={value} oninput={this.type} aria-label="constraints" />
        {/* ✓ a spread of props is read where the component is used, by the form rule */}
        <input value={value} oninput={this.type} {...this.props.attrs} aria-label="props spread" />
        {/* ✓ `on:input` is the field's own handler, as `oninput` is */}
        <TextArea value={value} on:input={this.type} aria-label="typed colon" />
        {/* ✓ the user's */}
        <TextArea defaultValue="x" aria-label="default" />
        <ui.Select defaultValue="a" aria-label="namespaced default">
          <option value="a">a</option>
        </ui.Select>
        <input defaultValue="x" aria-label="default input" />
        <input type="checkbox" defaultChecked aria-label="default box" />
        {/* ✓ takes no edit */}
        <TextArea value={value} readonly aria-label="read only" />
        <TextArea value={value} readonly="true" aria-label="read only string" />
        <TextArea value={value} disabled={LOCKED} aria-label="locked const" />
        <input value={value} readonly aria-label="read only input" />
        <Select value={value} disabled aria-label="disabled">
          <option value="a">a</option>
        </Select>
        <input type="hidden" value={value} aria-label="hidden" />
        <input type="submit" value="Send" aria-label="submit" />
        <input type="hidden" {...bag} aria-label="hidden with a spread" />
        {/* ✓ no model as written */}
        <TextArea value={null} aria-label="null value" />
        <TextArea value={undefined} defaultValue="x" aria-label="undefined value" />
        {/* ✓ an action menu: the select goes back to its placeholder after the handler acts */}
        <Select value="" onchange={this.pick} aria-label="action menu">
          <option value="">Go to…</option>
        </Select>
        <Loose value={value} />
        <Strict value={value} oninput={this.type} />
      </form>
    );
  }
}

export { App };
