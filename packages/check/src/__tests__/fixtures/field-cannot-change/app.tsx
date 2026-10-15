import { Component, Select, TextArea } from "@ramonda/core";

declare const value: string;
declare const bind: Record<string, unknown>;
declare const viewing: boolean;

class App extends Component<{ text: string }> {
  pick(_event: Event) {}
  type(_event: Event) {}
  render() {
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
        {/* ✗ held-between-keystrokes: an ancestor's change comes on blur */}
        <fieldset onchange={this.type}>
          <TextArea value={value} aria-label="changed above" />
        </fieldset>
        {/* ✗ no-handler: readOnly that may be off */}
        <TextArea value={value} readOnly={viewing} aria-label="maybe read only" />
      </form>
    );
  }
}

export { App };
