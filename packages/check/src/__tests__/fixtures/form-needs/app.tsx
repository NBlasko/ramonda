import { Component, Hook, Select } from "@ramonda/core";
import { Form } from "@ramonda/form";
import { Form as Mine } from "./myForm";
import { Fancy } from "./ui";

declare const value: string;
const NONE = undefined;
declare const on: boolean;
declare const bag: Record<string, unknown>;
declare const rest: Record<string, unknown>;
/** Every attribute a wrapper takes, as a type says — which says nothing of what a spread of it copies. */
declare const handed: {
  name: string;
  value: string;
  oninput: (event: Event) => void;
  onblur: (event: Event) => void;
  invalid: boolean;
};
/** The same, each of it may be left out. */
declare const partial: Partial<typeof handed>;
declare const kind: string;
declare const anObject: object;
declare const anything: {};
/** What `hint && { title: hint }` is in a strict project: the empty string, or the object. */
declare const hinted: "" | 0 | false | { title: string };
const HIDDEN = "hidden";
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

/** The same, its handler spelled `on:input`. */
class ColonInput extends Component<{ field: any; attrs?: Record<string, unknown> }> {
  render() {
    const f = this.props.field;
    return (
      <input
        aria-label="colon"
        name={f.name}
        value={f.inputValue}
        on:input={f.oninput}
        onblur={f.onblur}
        aria-invalid={f.invalid}
        {...this.props.attrs}
      />
    );
  }
}

/** Takes `aria-invalid` under its own name, read by index. */
class AriaInput extends Component<{
  name: string;
  value: string;
  oninput: (event: Event) => void;
  onblur: (event: Event) => void;
  "aria-invalid"?: boolean;
}> {
  render() {
    return (
      <input
        aria-label="aria"
        name={this.props.name}
        value={this.props.value}
        oninput={this.props.oninput}
        onblur={this.props.onblur}
        aria-invalid={this.props["aria-invalid"]}
      />
    );
  }
}

/** A text field with a `change` handler of its own beside the form's, then a spread. */
class TrackedInput extends Component<{ field: any; attrs?: Record<string, unknown> }> {
  render() {
    const f = this.props.field;
    return (
      <input
        aria-label="tracked"
        name={f.name}
        value={f.inputValue}
        oninput={f.oninput}
        onblur={f.onblur}
        aria-invalid={f.invalid}
        onchange={this.track}
        {...this.props.attrs}
      />
    );
  }
  track() {}
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

/** A box that writes nothing of its own: `value` on it is what the form sends, `checked` its model. */
class BoxInput extends Component<{ attrs?: Record<string, unknown> }> {
  render() {
    return <input type="checkbox" aria-label="box" {...this.props.attrs} />;
  }
}

/** One prop spread on two fields, a text field and a box: what each wants of it differs. */
class TwoFields extends Component<{ attrs?: Record<string, unknown> }> {
  render() {
    return (
      <div>
        <input aria-label="two text" {...this.props.attrs} />
        <input type="checkbox" aria-label="two box" {...this.props.attrs} />
      </div>
    );
  }
}

/** Writes nothing of its own: whatever reaches the field is in the spread. */
class BareInput extends Component<{ attrs?: Record<string, unknown> }> {
  render() {
    return <input aria-label="bare" {...this.props.attrs} />;
  }
}

/** Its handler written as nothing after the spread: no handler at all, whatever the bag says. */
class NoHandlerInput extends Component<{ attrs?: Record<string, unknown> }> {
  render() {
    return <input aria-label="no handler" {...this.props.attrs} oninput={undefined} />;
  }
}

/** Spreads FIRST: everything written after it is the field's, and no spread can override it. */
class EarlySpread extends Component<{ field: any; attrs?: Record<string, unknown> }> {
  render() {
    const f = this.props.field;
    return (
      <input
        {...this.props.attrs}
        aria-label="early"
        name={f.name}
        value={f.inputValue}
        oninput={f.oninput}
        onblur={f.onblur}
        aria-invalid={f.invalid}
      />
    );
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
        {/* ✓ an `oninput` written as nothing beside the pick's own `onchange` */}
        <Select
          aria-label="nothing, then onchange"
          name="s"
          value={value}
          oninput={undefined}
          onchange={this.type}
          onblur={this.type}
          aria-invalid={false}
        >
          <option value="a">a</option>
        </Select>
        {/* ✓ a value that is a `const` holding nothing: no model, the field is the user's */}
        <input aria-label="value as a const" name="e" value={NONE} />
        {/* ✗ missing */}
        <input aria-label="no blur" name="e" value={value} oninput={this.type} aria-invalid={false} />
        <input
          aria-label="blur as a const"
          name="e"
          value={value}
          oninput={this.type}
          onblur={NONE}
          aria-invalid={false}
        />
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
        {/* ✓ a text field's own `onchange` taken away: not one of the form's, whose handler is `oninput` */}
        <TrackedInput field={this.form.fields.email.$} attrs={{ onchange: undefined }} />
        {/* ✓ a bag handed as nothing, written or through a const: it spreads nothing */}
        <DefaultsInput field={this.form.fields.email.$} attrs={undefined} />
        <DefaultsInput field={this.form.fields.email.$} attrs={NONE} />
        {/* ✓ keys the field never writes, set to nothing: its `oninput` stays, `on:input` is another */}
        <DefaultsInput
          field={this.form.fields.email.$}
          attrs={{ "on:input": undefined, onchange: undefined, checked: undefined }}
        />
        {/* ✗ a bag that sets the field's `on:input` to nothing */}
        <ColonInput field={this.form.fields.email.$} attrs={{ "on:input": undefined }} />
        {/* ✗ a bag that may come through a spread on the use, which cannot be read */}
        <BareInput {...rest} />
        {/* ✗ one bag that cannot be read, spread on two fields: reported once */}
        <TwoFields attrs={bag} />
        {/* ✓ a handler written in the bag as a method, as it is written as an arrow */}
        <BareInput
          attrs={{
            value: "method",
            name: "m",
            onblur: this.type,
            "aria-invalid": false,
            oninput(event: Event) {
              void event;
            },
          }}
        />
        {/* ✓ a hidden value through a const is not a field the form asks anything of */}
        <input aria-label="hidden const in form" type={HIDDEN} name="id" value={value} />
        {/* ✗ a box whose type cannot be read, written with `checked`, is a field of the form */}
        <input aria-label="unread box in form" type={kind} checked={on} oninput={this.type} />
        <input aria-label="unread radio in form" type={kind} checked={on} value="yes" onchange={this.type} />
        <input aria-label="checked as nothing" type={kind} checked={undefined} value={value} oninput={this.type} />
        <input aria-label="checked as a const" type={kind} checked={NONE} value={value} onchange={this.type} />
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
        <BareInput attrs={{ value: undefined }} />
        <BareInput attrs={{ value: "carried nothing", "on:input": undefined }} />
        <NoHandlerInput attrs={{ value: "x" }} />
        {/* ✗ a handler in the bag that the field's own `oninput={undefined}`, written after, takes away */}
        <NoHandlerInput attrs={{ value: "y", oninput: this.type }} />
        {/* ✓ a spread of a string or an object: neither can carry the bag */}
        <BareInput {...hinted} />
        {/* ✓ an empty object written there hands nothing */}
        <BareInput {...(on ? { title: "t" } : {})} />
        {/* ✗ bag-unreadable — `object` and `{}` name nothing, and may carry anything */}
        <BareInput {...anObject} />
        <BareInput {...anything} />
        {/* ✓ a box's value is what the form sends; ✗ its checked is a model with no handler */}
        <BoxInput attrs={{ value: "yes" }} />
        {/* ✓ `on:input` in the spread is the field's own handler */}
        <BareInput attrs={{ value: "x", "on:input": this.type }} />
        <BoxInput attrs={{ checked: true }} />
        {/* ✗ a text field's change comes on blur: `onchange` alone is no handler beside its value */}
        <BareInput attrs={{ value: "x", onchange: this.type }} />
        <DefaultsInput field={this.type} attrs={bag} />
        {/* ✓ a value in the spread, and the field's own handler written by name */}
        <HandledInput oninput={this.type} attrs={{ value: "x" }} />
        {/* ✗ a shorthand holding nothing overrides the form's handler as surely as `oninput: undefined` */}
        <DefaultsInput field={this.type} attrs={{ oninput }} />
        {/* ✓ a spread written first cannot override what is written after it */}
        <EarlySpread field={this.type} attrs={{ value: undefined, oninput: undefined }} />
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

/** ✗ form-not-attached, named by the field that holds it */
class DetachedSignup extends Component {
  signup = this.use(Form, {});
  render() {
    return <form>nothing</form>;
  }
}

/** ✗ form-not-attached — `login`: one form of two is attached, the other is not. */
class TwoForms extends Component {
  signup = this.use(Form, {});
  login = this.use(Form, {});
  render() {
    return (
      <div>
        <form onsubmit={this.signup.submit}>signup</form>
        <form onsubmit={this.sendLogin}>login</form>
      </div>
    );
  }
  sendLogin() {
    this.login.submit();
  }
}

/** A project's own base for its hooks. */
class BaseHook extends Hook {}

/** ✗ form-in-a-hook — a hook through a base class of the project's. */
class SignupThroughABase extends BaseHook {
  form = this.use(Form, {});
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

/** Hands its own props on whole, one level up: what the styled input needs is asked of its uses. */
class SpreadOuter extends Component<{
  name?: string;
  value: string;
  oninput: (event: Event) => void;
  onblur?: (event: Event) => void;
  invalid?: boolean;
}> {
  render() {
    return <StyledInput {...this.props} />;
  }
}

/** Hands its bag on through its own props: what each use hands for it is read there. */
class SpreadBare extends Component<{ attrs?: Record<string, unknown> }> {
  render() {
    return <BareInput {...this.props} />;
  }
}

/** Wrappers handed through spreads. */
class HandedThroughASpread extends Component {
  form = this.use(Form, {});
  render() {
    return (
      <form onsubmit={this.form.submit}>
        {/* ✗ not-passed — all five: a spread hands none for sure, whatever its type names */}
        <StyledInput {...handed} />
        {/* ✗ not-passed — name, onblur, invalid: a spread that may leave each out */}
        <StyledInput {...partial} value={value} oninput={handed.oninput} />
        {/* ✗ not-passed — name, onblur, invalid: asked of the wrapper that spreads its props */}
        <SpreadOuter value={value} oninput={handed.oninput} />
        {/* ✗ not-passed — aria-invalid, which the input reads by index */}
        <AriaInput name="a" value={value} oninput={handed.oninput} onblur={handed.onblur} />
        {/* ✓ all five, handed to the wrapper that spreads its props */}
        <SpreadOuter name="s" value={value} oninput={handed.oninput} onblur={handed.onblur} invalid={false} />
        {/* ✗ bag-unreadable — through the wrapper's own props */}
        <SpreadBare attrs={bag} />
        {/* ✓ a bag written here, through the wrapper's own props */}
        <SpreadBare attrs={{ placeholder: "spread" }} />
      </form>
    );
  }
}

/** Holds its own form, whose field takes its `name` from a prop: every use hands it, in a form or not. */
class NamedByAProp extends Component<{ n?: string }> {
  form = this.use(Form, {});
  render() {
    return (
      <form onsubmit={this.form.submit}>
        <input
          aria-label="named by a prop"
          name={this.props.n}
          value={value}
          oninput={handed.oninput}
          onblur={handed.onblur}
          aria-invalid={false}
        />
      </form>
    );
  }
}

/** Holds its own form, and in it a styled input whose `name` it takes from a prop of its own. */
class StyledByAProp extends Component<{ n?: string }> {
  form = this.use(Form, {});
  render() {
    return (
      <form onsubmit={this.form.submit}>
        <StyledInput
          name={this.props.n}
          value={value}
          oninput={handed.oninput}
          onblur={handed.onblur}
          invalid={false}
        />
      </form>
    );
  }
}

/** Holds its own form, and in it the styled input handed its own props whole. */
class SpreadInItsForm extends Component<{
  name?: string;
  value: string;
  oninput: (event: Event) => void;
  onblur?: (event: Event) => void;
  invalid?: boolean;
}> {
  form = this.use(Form, {});
  render() {
    return (
      <form onsubmit={this.form.submit}>
        <StyledInput {...this.props} />
      </form>
    );
  }
}

/** Uses them outside any form. */
class UsesNamedByAProp extends Component {
  render() {
    return (
      <div>
        {/* ✗ not-passed — n, through the styled input in its form */}
        <StyledByAProp />
        {/* ✗ not-passed — name, onblur, invalid, through its own props spread in its form */}
        <SpreadInItsForm value={value} oninput={handed.oninput} />
        {/* ✗ not-passed — n */}
        <NamedByAProp />
        {/* ✓ handed */}
        <NamedByAProp n="handed" />
      </div>
    );
  }
}

/** A field in a callback with a body, inside the form. */
class InABlockBody extends Component {
  form = this.use(Form, {});
  render() {
    return (
      <form onsubmit={this.form.submit}>
        {[1, 2].map((item) => {
          return <input aria-label="in a block body" value={String(item)} />;
        })}
      </form>
    );
  }
}

/** A form held in a private field. */
class PrivateForm extends Component {
  #form = this.use(Form, {});
  render() {
    return (
      <form onsubmit={this.#form.submit}>
        <input aria-label="in a private form" value={value} />
      </form>
    );
  }
}

/** ✗ form-not-attached — a private field's form no form attaches. */
class PrivateDetached extends Component {
  #form = this.use(Form, {});
  render() {
    return <div>nothing</div>;
  }
}

/** Spreads a value of a type it is given: what it hands cannot be read. */
class Generic<P> extends Component<{ extra: P }> {
  render() {
    return (
      <div>
        {/* ✗ bag-unreadable — attrs, which a spread of any type may carry */}
        <BareInput {...this.props.extra} />
      </div>
    );
  }
}

/** A spread typed as either of two: a bag only one of them hands may still come through it. */
declare const either: { attrs: { value: string } } | { other: number };
class UnionSpread extends Component {
  render() {
    return (
      <div>
        {/* ✗ bag-unreadable — attrs, which one member hands */}
        <BareInput {...either} />
      </div>
    );
  }
}

export { Generic, UsesNamedByAProp, InABlockBody, PrivateForm, PrivateDetached, UnionSpread };

/** An input whose `type` cannot be read, then a spread: a box or a text field, by what it is handed. */
class Toggle extends Component<{ type: "checkbox" | "text"; attrs?: Record<string, unknown> }> {
  render() {
    return <input aria-label="toggle" type={this.props.type} {...this.props.attrs} />;
  }
}

class UsesToggle extends Component {
  type(_event: Event) {}
  render() {
    return (
      <div>
        {/* ✗ handed `checked` and no handler: a box that cannot be changed */}
        <Toggle type="checkbox" attrs={{ checked: on }} />
        {/* ✓ handed `checked` and `onchange`, a box's handler */}
        <Toggle type="checkbox" attrs={{ checked: on, onchange: this.type }} />
        {/* ✗ handed `value` and only `onchange`: as a text field, its handler is `oninput` */}
        <Toggle type="text" attrs={{ value: "v", onchange: this.type }} />
      </div>
    );
  }
}

export { Toggle, UsesToggle };

/** A field written in a base class's render, which a subclass renders with. */
class BaseField extends Component {
  render() {
    return <input aria-label="inherited render" value={value} />;
  }
}

class SubField extends BaseField {}

class RendersASubField extends Component {
  form = this.use(Form, {});
  render() {
    return (
      <form onsubmit={this.form.submit}>
        <SubField />
      </form>
    );
  }
}

export { RendersASubField };

/** A component a `const` holds, written as a class expression. */
const Row = class extends Component {
  render() {
    return <input aria-label="class in a const" value={value} oninput={handed.oninput} />;
  }
};

class RendersARow extends Component {
  form = this.use(Form, {});
  render() {
    return (
      <form onsubmit={this.form.submit}>
        <Row />
      </form>
    );
  }
}

export { RendersARow };

/** A form held in a base class, attached by the class that extends it. */
class BaseHolder extends Component {
  form = this.use(Form, {});
}

class SubRenders extends BaseHolder {
  render() {
    return (
      <form onsubmit={this.form.submit}>
        <input aria-label="in a form held by a base" value={value} oninput={handed.oninput} />
      </form>
    );
  }
}

export { SubRenders };
