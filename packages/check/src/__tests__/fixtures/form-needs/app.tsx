import { Component, Hook, Select } from "@ramonda/core";
import { Form } from "@ramonda/form";
import { Form as Mine } from "./myForm";
import { Fancy } from "./ui";

declare const value: string;
declare const on: boolean;
declare const bag: Record<string, unknown>;
const oninput = undefined;
/** A class with no render to read, written in this very file. */
declare class Ambient extends Component {}

/** Writes the five from its props, as a design system's input does. */
class StyledInput extends Component<{
  name?: string;
  value: string;
  oninput: (event: Event) => void;
  onblur?: (event: Event) => void;
  invalid?: boolean;
}> {
  render() {
    return (
      <input
        aria-label="styled"
        name={this.props.name}
        value={this.props.value}
        oninput={this.props.oninput}
        onblur={this.props.onblur}
        aria-invalid={this.props.invalid}
      />
    );
  }
}

/** Defaults, then a spread last that may overwrite them. */
class DefaultsInput extends Component<{ field: any; attrs?: Record<string, unknown> }> {
  render() {
    const f = this.props.field;
    return (
      <input
        aria-label="defaults"
        className="styled"
        name={f.name}
        value={f.inputValue}
        oninput={f.oninput}
        onblur={f.onblur}
        aria-invalid={f.invalid}
        {...this.props.attrs}
      />
    );
  }
}

/** Writes nothing of its own: whatever reaches the field is in the spread. */
class BareInput extends Component<{ attrs?: Record<string, unknown> }> {
  render() {
    return <input aria-label="bare" {...this.props.attrs} />;
  }
}

/** Writes its handler by name and lets a caller spread the rest, a value included. */
class HandledInput extends Component<{ oninput: (event: Event) => void; attrs?: Record<string, unknown> }> {
  render() {
    return <input aria-label="handled" oninput={this.props.oninput} {...this.props.attrs} />;
  }
}

/** Passes its own props on to the styled input, one level up. */
class Outer extends Component<{ value: string; oninput: (event: Event) => void; onblur?: (event: Event) => void }> {
  render() {
    return (
      <StyledInput
        name="outer"
        value={this.props.value}
        oninput={this.props.oninput}
        onblur={this.props.onblur}
        invalid={false}
      />
    );
  }
}

/** A field in its own component — rendered inside the form below. */
class Fields extends Component {
  type(_event: Event) {}
  render() {
    return <input aria-label="child field" value={value} oninput={this.type} onblur={this.type} aria-invalid={false} />;
  }
}

/** A component placing its children inside its own form. */
class FormShell extends Component<{ children?: unknown }> {
  form = this.use(Form, {});
  render() {
    return <form onsubmit={this.form.submit}>{this.props.children}</form>;
  }
}

class Page extends Component {
  form = this.use(Form<{ email: string }>, {});
  type(_event: Event) {}
  render() {
    return (
      <form onsubmit={this.form.submit}>
        {/* ✓ all five */}
        <input
          aria-label="complete"
          name="e"
          value={value}
          oninput={this.type}
          onblur={this.type}
          aria-invalid={false}
        />
        <input
          aria-label="complete box"
          type="checkbox"
          name="t"
          checked={on}
          oninput={this.type}
          onblur={this.type}
          aria-invalid={false}
        />
        {/* ✗ missing */}
        <input aria-label="no blur" name="e" value={value} oninput={this.type} aria-invalid={false} />
        <Select aria-label="select without invalid" name="s" value={value} onchange={this.type} onblur={this.type}>
          <option value="a">a</option>
        </Select>
        <Fields />
        {/* ✓ wrapper handed all five */}
        <StyledInput name="w" value={value} oninput={this.type} onblur={this.type} invalid={false} />
        {/* ✗ not-passed */}
        <StyledInput name="w" value={value} oninput={this.type} invalid={false} />
        <Outer value={value} oninput={this.type} />
        {/* ✓ a bag that overwrites nothing; ✗ one that does; ✗ one that cannot be read */}
        <DefaultsInput field={this.form.fields.email.$} attrs={{ placeholder: "you@example.com" }} />
        <DefaultsInput field={this.form.fields.email.$} attrs={{ oninput: undefined }} />
        <DefaultsInput field={this.form.fields.email.$} attrs={bag} />
        {/* ✗ a box whose type is written as an expression is still a box */}
        <input aria-label="braced box" type={"checkbox"} checked={on} oninput={this.type} />
        {/* ✗ unreadable-component */}
        <Fancy label="x" />
        <Ambient />
      </form>
    );
  }
}

/** Fields handed as children to a component whose render puts them in its form. */
class Shelled extends Component {
  type(_event: Event) {}
  render() {
    return (
      <FormShell>
        <input aria-label="shelled" value={value} oninput={this.type} />
      </FormShell>
    );
  }
}

/** Outside any form: the form's needs do not apply. */
class Loose extends Component {
  type(_event: Event) {}
  render() {
    return (
      <div>
        <input aria-label="loose" value={value} oninput={this.type} />
        <StyledInput value={value} oninput={this.type} />
        {/* ✗ what a spread carries is read everywhere: a value with no handler, and a bag unseen */}
        <BareInput attrs={{ value: "fixed" }} />
        {/* ✗ a text field's change comes on blur: `onchange` alone is no handler beside its value */}
        <BareInput attrs={{ value: "x", onchange: this.type }} />
        <DefaultsInput field={this.type} attrs={bag} />
        {/* ✓ a value in the spread, and the field's own handler written by name */}
        <HandledInput oninput={this.type} attrs={{ value: "x" }} />
        {/* ✗ a shorthand holding nothing overrides the form's handler as surely as `oninput: undefined` */}
        <DefaultsInput field={this.type} attrs={{ oninput }} />
        {/* ✓ a value with its handler beside it */}
        <DefaultsInput field={this.type} attrs={{ value: "x", oninput: this.type }} />
      </div>
    );
  }
}

/** ✗ form-not-attached */
class Detached extends Component {
  form = this.use(Form, {});
  render() {
    return <form>nothing</form>;
  }
}

/** ✗ form-in-a-hook */
class SignupForm extends Hook {
  form = this.use(Form, {});
}

/** An app's own `Form`: not @ramonda/form's, so neither recognised nor reported. */
class OwnForm extends Component {
  form = this.use(Mine, {});
  type(_event: Event) {}
  render() {
    return (
      <form onsubmit={this.form.submit}>
        <input aria-label="own form field" value={value} oninput={this.type} />
      </form>
    );
  }
}

export { Page, Shelled, Loose, Detached, SignupForm, OwnForm };
