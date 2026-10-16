import { Component, Select, TextArea } from "@ramonda/core";
import * as ui from "@ramonda/core";

declare const value: string;
declare const bind: Record<string, unknown>;
declare const viewing: boolean;
const LOCKED = true;
declare const drafts: Record<string, string>;
declare const Card: (props: { onchange?: unknown; children?: unknown }) => unknown;

class App extends Component<{ text: string; size: string }> {
  pick(_event: Event) {}
  type(_event: Event) {}
  render() {
    const { text } = this.props;
    const own = this.props;
    const { size: picked } = own;
    return (
      <form>
        {/* ✗ no-handler */}
        <Select value={value} aria-label="held select">
          <option value="a">a</option>
        </Select>
        {/* ✗ no-handler */}
        <TextArea value={value} aria-label="held text" />
        {/* ✗ held-between-keystrokes */}
        <TextArea value={value} onchange={this.type} aria-label="saved on blur" />
        {/* ✗ both */}
        <TextArea value={value} defaultValue="x" oninput={this.type} aria-label="both" />

        {/* ✓ a handler that moves the model */}
        <Select value={value} onchange={this.pick} aria-label="picked">
          <option value="a">a</option>
        </Select>
        <Select value={value} oninput={this.pick} aria-label="picked on input">
          <option value="a">a</option>
        </Select>
        <TextArea value={value} oninput={this.type} aria-label="typed" />
        <TextArea value={value} onInput={this.type} aria-label="typed camel" />
        <TextArea value={value} on:input={this.type} aria-label="typed colon" />
        {/* ✓ the user's */}
        <TextArea defaultValue="x" aria-label="default" />
        {/* ✓ a spread may carry the handler */}
        <TextArea value={value} {...bind} aria-label="bound" />
        {/* ✓ takes no input */}
        <TextArea value={value} readonly aria-label="read only" />
        <Select value={value} disabled aria-label="disabled">
          <option value="a">a</option>
        </Select>
        {/* ✓ a handler around it */}
        <fieldset oninput={this.type}>
          <TextArea value={value} aria-label="heard above" />
        </fieldset>
        {/* ✓ handed in by the parent, whose handler this cannot see */}
        <TextArea value={this.props.text} aria-label="from props" />
        <TextArea value={this.props.text ?? ""} aria-label="from props with a fallback" />
        <TextArea value={text} aria-label="from props destructured" />
        <TextArea value={this.props.text || ""} aria-label="from props or empty" />
        <TextArea value={viewing ? this.props.text : value} aria-label="from props on one arm" />
        <Select value={String(this.props.size)} aria-label="from props through a call">
          <option value="a">a</option>
        </Select>
        <TextArea value={`${this.props.text}!`} aria-label="from props in a template" />
        <TextArea value={this.props.text.trim()} aria-label="from props through a method" />
        <TextArea
          value={
            this.props.text +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value +
            value
          }
          aria-label="from props at the head of a long sum"
        />
        <Select value={own.size} aria-label="from props through a local">
          <option value="a">a</option>
        </Select>
        <Select value={picked} aria-label="from props renamed through a local">
          <option value="a">a</option>
        </Select>
        {/* ✗ no-handler: the model is this component's, only keyed by a prop */}
        <TextArea value={drafts[this.props.text]} aria-label="keyed by a prop" />
        {/* ✓ a defaultValue written as undefined is none */}
        <Select value={value} oninput={this.pick} defaultValue={undefined} aria-label="undefined default">
          <option value="a">a</option>
        </Select>
        {/* ✓ core's Select through a namespace takes defaultValue as well */}
        <ui.Select defaultValue="a" aria-label="namespaced default">
          <option value="a">a</option>
        </ui.Select>
        {/* ✗ held-between-keystrokes: an ancestor's change comes on blur */}
        <fieldset onchange={this.type}>
          <TextArea value={value} aria-label="changed above" />
        </fieldset>
        {/* ✗ no-handler: readOnly that may be off */}
        <TextArea value={value} readOnly={viewing} aria-label="maybe read only" />
        {/* ✓ a value still loading is no value */}
        <TextArea value={null} aria-label="null value" />
        <TextArea value={undefined} defaultValue="x" aria-label="undefined value" />
        {/* ✓ read-only spelled as a string, and through a const */}
        <TextArea value={value} readonly="true" aria-label="read only string" />
        <TextArea value={value} disabled={LOCKED} aria-label="locked const" />
        {/* ✗ no-handler: a component's onchange is a prop, not a listener */}
        <Card onchange={this.pick}>
          <Select value={value} aria-label="inside a card">
            <option value="a">a</option>
          </Select>
        </Card>
      </form>
    );
  }
}

export { App };
