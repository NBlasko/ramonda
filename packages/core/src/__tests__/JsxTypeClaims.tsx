import { Select } from "../base/Select";
import { Component } from "../base/Component";
import { onDocument, onWindow } from "../base/decorators";

/**
 * Everything the JSX types promise, in one file, pinned in both directions.
 *
 * Not a test file — there is nothing to run, and vitest does not pick it up. It is a set of claims
 * checked by `tsc` in this package's own `check-types`, and it is the only place they are written
 * down as code rather than as prose.
 *
 * **A shape with no directive must compile.** **A shape under `@ts-expect-error` must not** — and
 * TypeScript reports an "unused '@ts-expect-error' directive" the day one of them starts
 * compiling, so relaxing any of this fails the build instead of passing quietly. Verified by
 * relaxing one requirement and watching two directives go unused.
 */

declare const loose: Record<string, unknown>;
declare const withAlt: { src: string; alt: string };
declare const imgProps: JSX.IntrinsicElements["img"];
declare const maybeAlt: { src: string; alt?: string };
declare const extras: { className?: string; loading?: string };
declare const maybe: string | undefined;
declare const caption: string;

/** The shape `@ramonda/form` spreads onto a control, as `CommonBind` declares it. */
declare const bind: {
  readonly name: string;
  readonly value: string;
  readonly oninput: (event: Event) => void;
  readonly onblur: (event: Event) => void;
  readonly "aria-invalid": boolean | undefined;
};

/**
 * Names that reach the DOM verbatim and do nothing.
 *
 * Measured by rendering each one and reading back what landed in the document — every one of these
 * arrives lowercased as a name no browser reads.
 */
export class RefusedNames extends Component {
  render() {
    return (
      <div>
        {/* @ts-expect-error — the attribute is `http-equiv` */}
        <meta httpEquiv="refresh" content="5" />
        {/* @ts-expect-error — the attribute is `accept-charset` */}
        <form acceptCharset="utf-8" />
        {/* @ts-expect-error — the attribute IS the initial value */}
        <input defaultValue="v" />
        {/* @ts-expect-error — the attribute IS the initial state */}
        <input defaultChecked />
        {/* @ts-expect-error — Ramonda renders children */}
        <div innerHTML="<p>x</p>" />
        {/* @ts-expect-error — put the text in the children */}
        <span textContent="hi" />
      </div>
    );
  }
}

/** The correct spellings of the same things, which must keep compiling. */
export class AcceptedNames extends Component {
  render() {
    return (
      <div>
        <meta http-equiv="refresh" content="5" />
        <form accept-charset="utf-8" noValidate />
        <input value="v" checked readOnly maxLength={5} tabIndex={0} autocomplete="off" />
        {/* The two that ARE aliased, because they are reserved words. */}
        <div className="x" />
        <label htmlFor="a">A</label>
        <label for="b">B</label>
      </div>
    );
  }
}

/** An image and a frame have nothing inside them to be worked out from, so they must be named. */
export class Unnamed extends Component {
  render() {
    return (
      <div>
        {/* @ts-expect-error — nothing names it */}
        <img src="/a.png" />
        {/* @ts-expect-error — a frame with no title and no ARIA name */}
        <iframe src="/x" />
        {/* @ts-expect-error — an area is a link with a picture's problem */}
        <area href="/x" />
      </div>
    );
  }
}

/** All four ways, and `alt=""` among them: saying "skip me" is an answer, not an omission. */
export class Named extends Component {
  render() {
    return (
      <div>
        <img src="/a.png" alt="a cat" />
        <img src="/b.png" alt="" />
        <img src="/c.png" aria-label="a dog" />
        <img src="/d.png" aria-labelledby="cap" />
        <img src="/e.png" title="a bird" />
        <iframe src="/x" title="A map" />
        <area href="/x" alt="Region" />
      </div>
    );
  }
}

/**
 * What a SPREAD may and may not do — the part people worry about, so it is written out in full.
 *
 * Spreading is not restricted. The requirement is about the NAME, and it is satisfied by anything
 * that proves one is there: the spread's own type, or an attribute written beside it. Only the case
 * where nothing at all provides a name is refused — which is precisely the case `ramonda-check`
 * cannot speak about, since a spreading element is handed to no rule.
 */
export class Spreads extends Component {
  render() {
    return (
      <div>
        {/* Allowed: the spread's type carries a name. */}
        <img {...withAlt} />
        <img {...imgProps} />
        {/* Allowed: the name is written out, whatever else the bag holds. */}
        <img {...loose} alt="written out" />
        <img src="/a.png" {...extras} alt="written out" />
        <iframe {...loose} title="A map" />

        {/* @ts-expect-error — an untyped bag says nothing about carrying a name */}
        <img {...loose} />
        {/* @ts-expect-error — an OPTIONAL alt cannot prove there is one */}
        <img {...maybeAlt} />
        {/* @ts-expect-error — a spread of unrelated extras, and nothing names it */}
        <img src="/a.png" {...extras} />
      </div>
    );
  }
}

/**
 * A name that might be `undefined` is not a name.
 *
 * Measured: an attribute given `undefined` is not written at all — no `alt`, not even an empty one.
 * So `string | undefined` proves nothing, and this type exists to prove something.
 *
 * `ramonda-check` stays quiet on the same line, and that is not a disagreement: the rule asks
 * whether an `alt` was written, because it cannot evaluate an expression and reporting a maybe is
 * the one thing it may never do. The type can see the expression's type, so it asks the stronger
 * question.
 */
export class MaybeNames extends Component {
  render() {
    return (
      <div>
        {/* Allowed: a name that is certainly a string. */}
        <img src="/a.png" alt={caption} />
        {/* Allowed: the decision made. An empty `alt` says "no caption, deliberately". */}
        <img src="/a.png" alt={maybe ?? ""} />

        {/* @ts-expect-error — `string | undefined` is not proof that a name is there */}
        <img src="/a.png" alt={maybe} />
        {/* @ts-expect-error — the same, through ARIA */}
        <img src="/a.png" aria-label={maybe} />
        {/* @ts-expect-error — and for a frame */}
        <iframe src="/x" title={maybe} />
      </div>
    );
  }
}

/**
 * Controls are untouched, which is the other half of the worry.
 *
 * Nothing is REQUIRED on an `<input>`, a `<textarea>` or anything else — the refused NAMES above are
 * optional properties, so they only bite when somebody writes one. A form's spread goes on exactly
 * as it did.
 *
 * `<select>` is the exception, and deliberately so: it is refused as a TAG, which is a required
 * property, so a spread cannot satisfy it either. `<Select>` takes the same spread and is the answer
 * the error names.
 */
export class ControlSpreads extends Component {
  render() {
    return (
      <div>
        <input {...bind} />
        <input {...bind} id="email" type="email" />
        <textarea {...bind} />
        <Select {...loose} value="a" />
        <input {...loose} />
        <div {...loose} />
        <form {...loose} />
      </div>
    );
  }
}

/**
 * Event names, which are the DOM's own with `on` in front — nothing translated, nothing capitalised.
 *
 * The handlers used to come from the element's `on…` PROPERTIES, renamed to `on${Capitalize<name>}`.
 * The DOM's event types are single lowercase tokens, so that produced `onMouseenter`, `onKeydown`,
 * `onDblclick` — the natural spellings were hard errors and the accepted ones were unguessable. It
 * survived because every event this repository writes happens to be one word.
 *
 * They come from the DOM's event MAP now, which needs no capitalisation and holds the five events
 * that have no property at all.
 */
export class EventNames extends Component {
  render() {
    return (
      <div>
        <button onclick={(event) => event.clientX} />
        <div onmouseenter={(event) => event.clientY} />
        <input oninput={(event) => event.type} />

        {/* The five with no `on…` property, which nothing here could name before. */}
        <div onfocusin={(event) => event.relatedTarget} />
        <div onfocusout={(event) => event.relatedTarget} />
        <input oncompositionstart={(event) => event.data} />
        <input oncompositionupdate={(event) => event.data} />
        <input oncompositionend={(event) => event.data} />

        {/* `on:` takes the rest of the name exactly as written, for an event `on…` cannot spell. */}
        <div on:my-event={(event) => event.type} />
        <div on:DOMSomething={(event) => event.type} />
      </div>
    );
  }
}

/** The spellings this used to accept, each refused with the one that replaced it. */
export class RefusedEventSpellings extends Component {
  render() {
    return (
      <div>
        {/* @ts-expect-error — the DOM has no `onClick`; the message names `onclick`. */}
        <button onClick={() => {}} />
        {/* @ts-expect-error — what the old mapping produced, and nobody would guess. */}
        <div onMouseenter={() => {}} />
        {/* @ts-expect-error — the spelling other frameworks use, which the DOM does not have. */}
        <div onMouseEnter={() => {}} />
        {/* @ts-expect-error — `dblclick` is the event; `ondoubleclick` names nothing. */}
        <div onDblClick={() => {}} />
      </div>
    );
  }
}

/**
 * A component's host is a platform element or a custom one, and a custom one carries a DASH.
 *
 * The dash is the platform's rule rather than a preference: it is what makes a name a custom
 * element, and what decides whether the browser will ever upgrade the tag. Without it the element
 * is an `HTMLUnknownElement` for ever, which is what a misspelled real tag also produces.
 *
 * The props are the ELEMENT's, so the same spelling rule reaches them — they used to be
 * `Record<string, unknown>`, which was the one place a camelCase handler still attached quietly.
 */
export class PlatformHost extends Component {
  handle = (_event: PointerEvent) => {};
  render() {
    return (
      <div onclick={this.handle} className="x">
        <span />
      </div>
    );
  }
}

export class CustomHost extends Component {
  render() {
    return (
      <my-widget anything="goes" on:ready={() => {}}>
        <span />
      </my-widget>
    );
  }
}

export class UnknownHost extends Component {
  render() {
    return (
      // @ts-expect-error — not a platform element, and no dash to make it a custom one.
      <mywidget />
    );
  }
}

export class RefusedElementProps extends Component {
  handle = () => {};
  render() {
    return (
      // @ts-expect-error — the DOM's own spelling is lower case, and so is the JSX attribute.
      <div onClick={this.handle}>
        <span />
      </div>
    );
  }
}

/**
 * `@onWindow` and `@onDocument` take the EVENT's own name, and refuse the two spellings that are
 * provably not one.
 *
 * Any other name passes, which is the design rather than a gap: a custom event may be called
 * anything, so `clik` cannot be refused without refusing `save` and `my-event` too. Only what can be
 * proved is stopped — the JSX attribute written where the event belongs, and a known name in the
 * wrong case, which `addEventListener` never matches.
 */
export class EventDecoratorNames extends Component {
  @onDocument("my-event") custom(event: Event) {
    void event.type;
  }
  @onDocument("save") named(event: Event) {
    void event.type;
  }
  @onDocument("DOMSomething") capitalised(event: Event) {
    void event.type;
  }
  @onWindow("online") back(event: Event) {
    void event.type;
  }
  render() {
    return (
      <div>
        <span />
      </div>
    );
  }
}

export class RefusedEventDecoratorNames extends Component {
  // @ts-expect-error — the JSX attribute, where the event's own name belongs.
  @onWindow("onclick") wrong(event: Event) {
    void event;
  }
  // @ts-expect-error — `addEventListener` is case-sensitive, so this never fires.
  @onWindow("MouseDown") miscased(event: Event) {
    void event;
  }
  render() {
    return (
      <div>
        <span />
      </div>
    );
  }
}

/**
 * `<select>` is refused as a TAG, and the message is the property name TypeScript says is missing —
 * so the error in the editor reads as the instruction.
 *
 * It is the one element whose meaning is not in its own attributes: a select's state is which CHILD
 * is chosen, and `selected` on an option is a claim HTML settles by document order, so plain markup
 * means whatever the render order made it mean. `<Select value={x}>` says it once and is settled
 * after the options exist. `<option>` itself is untouched.
 */
declare const chosen: string;

export const chooser = (
  <Select value={chosen}>
    <option value="a">A</option>
    <option value="b">B</option>
  </Select>
);

// @ts-expect-error — the tag is refused; write <Select value={x}>.
export const plainSelect = <select />;

/** `<option>` is untouched: it has no choice to make, so it stays an ordinary tag. */
export const plainOption = <option value="a">A</option>;

/** `multiple` is an ordinary attribute, and its choice is a list rather than one value. */
export const selectMultiple = (
  <Select multiple value={[chosen]}>
    <option value="a">A</option>
  </Select>
);
