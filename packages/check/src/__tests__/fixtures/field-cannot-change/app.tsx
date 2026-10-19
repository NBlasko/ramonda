import { Component, Select, TextArea, list } from "@ramonda/core";
import * as ui from "@ramonda/core";

declare const value: string;
declare const bind: Record<string, unknown>;
declare const viewing: boolean;
const LOCKED = true;
declare const drafts: Record<string, string>;
declare const Card: (props: { onchange?: unknown; children?: unknown }) => unknown;

class App extends Component<{ text: string; size: string; rows: { text: string }[] }> {
  rows = [{ text: "a", size: "s" }];
  pick(_event: Event) {}
  type(_event: Event) {}
  renderEach(each: (row: { text: string }) => unknown) {
    return this.rows.map(each);
  }
  sized([size]: string[]) {
    return (
      <Select value={size} aria-label="from an array parameter">
        <option value="a">a</option>
      </Select>
    );
  }
  far() {
    const hop0 = this.props.text;
    const hop1 = hop0;
    const hop2 = hop1;
    const hop3 = hop2;
    const hop4 = hop3;
    const hop5 = hop4;
    const hop6 = hop5;
    const hop7 = hop6;
    const hop8 = hop7;
    const hop9 = hop8;
    const hop10 = hop9;
    const hop11 = hop10;
    const hop12 = hop11;
    const hop13 = hop12;
    const hop14 = hop13;
    const hop15 = hop14;
    const hop16 = hop15;
    const hop17 = hop16;
    const hop18 = hop17;
    const hop19 = hop18;
    const hop20 = hop19;
    const hop21 = hop20;
    return <TextArea value={hop21} aria-label="past the bound" />;
  }
  each() {
    return (
      <div>
        {this.rows.map((row) => (
          <TextArea value={row.text} aria-label="a row of its own" />
        ))}
        {list(this.rows, (row) => (
          <Select value={row.size} aria-label="a list row of its own">
            <option value="a">a</option>
          </Select>
        ))}
        {this.props.rows.map((row) => (
          <TextArea value={row.text} aria-label="a row from props" />
        ))}
        {ui.list(this.props.rows, (row) => (
          <ui.TextArea value={row.text} aria-label="a namespaced list row from props" />
        ))}
        {Array.from(this.props.rows, (row) => (
          <TextArea value={row.text} aria-label="a row through Array.from" />
        ))}
        {[this.props.text].map((text) => (
          <TextArea value={text} aria-label="a row of props in a literal" />
        ))}
        {this.renderEach((row) => (
          <TextArea value={row.text} aria-label="a callback the rule cannot read" />
        ))}
      </div>
    );
  }
  notes(text: string, { size }: { size: string }) {
    return (
      <div>
        <TextArea value={text} aria-label="from a parameter" />
        <Select value={size} aria-label="from a destructured parameter">
          <option value="a">a</option>
        </Select>
      </div>
    );
  }
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
        {/* ✗ no-handler: `readonly` does nothing to a select — it still opens and picks */}
        <Select value={value} readonly aria-label="readonly select">
          <option value="a">a</option>
        </Select>
        {/* ✗ literal: no handler can move a value written as itself */}
        <TextArea value="" oninput={this.type} aria-label="literal value" />
        {/* ✓ a spread on a form or fieldset around it may carry the handler */}
        <fieldset {...bind}>
          <TextArea value={value} aria-label="spread above" />
        </fieldset>
        {/* ✗ no-handler: a spread on a wrapper that groups no fields says nothing about input */}
        <div {...bind}>
          <TextArea value={value} aria-label="spread on a wrapper" />
        </div>
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
        {/* biome-ignore format: the parentheses are the case */}
        <TextArea value={(null)} aria-label="null value in parentheses" />
        <TextArea value={undefined} defaultValue="x" aria-label="undefined value" />
        {/* ✓ read-only spelled as a string, and through a const */}
        <TextArea value={value} readonly="true" aria-label="read only string" />
        <TextArea value={value} disabled={LOCKED} aria-label="locked const" />
        {/* ✓ a component's onchange may be handed to a form inside it — a maybe, so silent */}
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
