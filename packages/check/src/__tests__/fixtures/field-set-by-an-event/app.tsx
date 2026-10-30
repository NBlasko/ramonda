import {
  Component,
  Select,
  TextArea,
  createRef,
  created,
  destroyed,
  mounted,
  state,
  updated,
  watchProp,
} from "@ramonda/core";

declare const kind: string;
declare const later: (run: () => void) => void;
declare const event: Event;
const INPUT = "input";
const NONE = undefined;
const READY = "app:ready";

/* ---- Reported ---- */

class ClicksABoxOnMount extends Component {
  @state on = false;
  box = createRef<HTMLInputElement>();
  @mounted
  start() {
    this.box.current?.click(); // REPORT click box
  }
  render() {
    return <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={() => {}} />;
  }
}

class DispatchesInputOnUpdate extends Component {
  @state text = "";
  field = createRef<HTMLInputElement>();
  @updated
  again() {
    this.field.current!.dispatchEvent(new InputEvent(INPUT, { bubbles: true })); // REPORT dispatch input
  }
  render() {
    return <input aria-label="t" ref={this.field} value={this.text} oninput={() => {}} />;
  }
}

class WritesTheValueInAHelper extends Component {
  @state text = "";
  field = createRef<HTMLTextAreaElement>();
  @mounted
  start() {
    this.fill();
  }
  fill() {
    const area = this.field.current!;
    area.value = "x"; // REPORT write field
  }
  render() {
    return <TextArea aria-label="t" ref={this.field} value={this.text} oninput={() => {}} />;
  }
}

/** `.value` and `.checked` on fields no model holds are the element's own: only the held box is a write. */
class WritesFieldsWithNoModel extends Component {
  @state on = false;
  hidden = createRef<HTMLInputElement>();
  loose = createRef<HTMLInputElement>();
  free = createRef<HTMLInputElement>();
  held = createRef<HTMLInputElement>();
  @mounted
  start() {
    this.hidden.current!.value = "token";
    this.loose.current!.value = "x";
    this.free.current!.checked = true;
    this.held.current!.checked = true; // REPORT write held box
  }
  render() {
    return (
      <div>
        <input type="hidden" ref={this.hidden} value="t" />
        <input aria-label="l" ref={this.loose} value={undefined} />
        <input type="checkbox" aria-label="f" ref={this.free} />
        <input type="checkbox" aria-label="h" ref={this.held} checked={this.on} onchange={() => {}} />
      </div>
    );
  }
}

/** A `#private` helper is entered from commit work as any method is. */
class ClicksABoxInAPrivateHelper extends Component {
  @state on = false;
  box = createRef<HTMLInputElement>();
  @mounted
  start() {
    this.#fill();
  }
  #fill() {
    this.box.current?.click(); // REPORT click in a private helper
  }
  render() {
    return <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={this.picked} />;
  }
  picked() {}
}

/** An event dispatched at a field this class renders is an edit, whether or not a model holds it. */
class DispatchesAtAFieldWithNoModel extends Component {
  field = createRef<HTMLInputElement>();
  @mounted
  start() {
    this.field.current!.dispatchEvent(new Event("input")); // REPORT dispatch at a field with no model
  }
  render() {
    return <input aria-label="t" ref={this.field} oninput={this.typed} />;
  }
  typed() {}
}

/** A label of a text area only moves the focus; a box's `.value` and a text field's `.checked` are no model. */
class TouchesNoModel extends Component {
  @state on = false;
  @state text = "";
  label = createRef<HTMLLabelElement>();
  box = createRef<HTMLInputElement>();
  field = createRef<HTMLInputElement>();
  @mounted
  start() {
    this.label.current?.click();
    this.box.current!.value = "yes";
    this.field.current!.checked = true;
  }
  render() {
    return (
      <div>
        <label ref={this.label} for="notes">
          Notes
        </label>
        <TextArea id="notes" aria-label="n" value={this.text} oninput={this.typed} />
        <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={this.typed} />
        <input aria-label="f" ref={this.field} value={this.text} oninput={this.typed} />
      </div>
    );
  }
  typed() {}
}

/** What an `async` hook does past its first sure `await` runs once the commit is over — inside a `try` too. */
class AwaitsBeforeTheEdit extends Component {
  @state on = false;
  box = createRef<HTMLInputElement>();
  api: { open(): void } | undefined;
  @mounted
  async start() {
    try {
      await this.load();
      this.box.current?.click();
    } catch {}
  }
  @mounted
  async later() {
    try {
      this.box.current?.click(); // REPORT click before the await in a try
      await this.load();
    } catch {}
    this.box.current?.click();
  }
  @mounted
  async ready() {
    if (await this.load()) {
    }
    this.box.current?.click();
  }
  @mounted
  keep() {
    // Only kept: it runs where it is called.
    this.api = {
      // @ts-expect-error — the object's own `this`; what the rule reads is that the method is only kept
      open() {
        this.box.current?.click();
      },
    };
  }
  async load() {
    return true;
  }
  render() {
    return <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={this.picked} />;
  }
  picked() {}
}

/** A ref callback written as a method is handed the element it is written on. */
class ClicksThroughARefMethod extends Component {
  @state on = false;
  attach(node: HTMLInputElement | null) {
    node?.click(); // REPORT click through a ref method
  }
  render() {
    return <input type="checkbox" aria-label="b" ref={this.attach} checked={this.on} onchange={this.picked} />;
  }
  picked() {}
}

/** An `input` or a `change` at a label edits nothing; a click at a label of a `Select` only moves the focus. */
class TouchesLabels extends Component {
  @state on = false;
  @state size = "m";
  boxLabel = createRef<HTMLLabelElement>();
  selectLabel = createRef<HTMLLabelElement>();
  @mounted
  start() {
    this.boxLabel.current?.dispatchEvent(new Event("change"));
    this.selectLabel.current?.click();
  }
  render() {
    return (
      <div>
        <label ref={this.boxLabel}>
          <input type="checkbox" aria-label="b" checked={this.on} onchange={this.picked} />
        </label>
        <label ref={this.selectLabel}>
          Size
          <Select aria-label="s" value={this.size} onchange={this.picked}>
            <option value="m">m</option>
          </Select>
        </label>
      </div>
    );
  }
  picked() {}
}

/** A ref on a held box in one branch and a free one in the other holds what either does. */
class WritesARefOnTwoElements extends Component {
  @state on = false;
  @state edit = true;
  @state text = "";
  b = createRef<HTMLInputElement>();
  r = createRef<HTMLInputElement>();
  @mounted
  start() {
    this.b.current!.checked = true; // REPORT write held box in a branch
    this.r.current!.value = "x"; // REPORT write a value beside checked={NONE}
  }
  render() {
    return (
      <div>
        {this.edit ? (
          <input type="checkbox" aria-label="b" ref={this.b} checked={this.on} onchange={() => {}} />
        ) : (
          <input type="checkbox" aria-label="b" ref={this.b} />
        )}
        <input type={kind} aria-label="r" ref={this.r} checked={NONE} value={this.text} oninput={() => {}} />
      </div>
    );
  }
}

class ClicksALabel extends Component {
  @state on = false;
  label = createRef<HTMLLabelElement>();
  @mounted
  start() {
    this.label.current!.dispatchEvent(new MouseEvent("click")); // REPORT click label
  }
  render() {
    return (
      <label ref={this.label}>
        <input type="checkbox" checked={this.on} onchange={() => {}} /> Terms
      </label>
    );
  }
}

class DispatchesAnUnreadableEvent extends Component {
  @mounted
  start() {
    document.querySelector("input")?.dispatchEvent(new Event(kind)); // REPORT unreadable
  }
  render() {
    return <div />;
  }
}

class DispatchesAPrebuiltEvent extends Component {
  @mounted
  start() {
    document.getElementById("name")?.dispatchEvent(event); // REPORT unreadable prebuilt
  }
  render() {
    return <div />;
  }
}

class EditsTheFocusedField extends Component {
  @mounted
  start() {
    document.execCommand("insertText", false, "x"); // REPORT exec-command
  }
  render() {
    return <div />;
  }
}

class ChangesInAForEach extends Component {
  @state on = false;
  boxes = createRef<HTMLSelectElement>();
  @mounted
  start() {
    [1, 2].forEach(() => this.boxes.current!.dispatchEvent(new Event("change"))); // REPORT forEach
  }
  render() {
    return (
      <Select aria-label="s" ref={this.boxes} value="a" oninput={() => {}}>
        <option value="a">a</option>
      </Select>
    );
  }
}

class HandsItsOwnMethodToForEach extends Component {
  @state on = false;
  box = createRef<HTMLInputElement>();
  @mounted
  start() {
    [1].forEach(this.tick);
  }
  tick = () => {
    this.box.current?.click(); // REPORT handed over
  };
  render() {
    return <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={() => {}} />;
  }
}

class EditsFromEveryCommitHook extends Component<{ id: string }> {
  @state text = "";
  field = createRef<HTMLInputElement>();
  constructor() {
    super();
    this.field.current?.dispatchEvent(new Event("change")); // REPORT constructor
  }
  @created
  made() {
    this.field.current?.dispatchEvent(new Event("beforeinput")); // REPORT created
  }
  @destroyed
  gone() {
    this.field.current?.dispatchEvent(new CompositionEvent("compositionend")); // REPORT destroyed
  }
  @watchProp((props: { id: string }) => props.id)
  moved() {
    this.field.current?.dispatchEvent(new Event("compositionstart")); // REPORT watchProp
  }
  render() {
    this.field.current?.dispatchEvent(new Event("input")); // REPORT render
    return <input aria-label="t" ref={this.field} value={this.text} oninput={() => {}} />;
  }
}

class AwaitsInABranchFirst extends Component {
  @state on = false;
  box = createRef<HTMLInputElement>();
  @mounted
  async start() {
    if (this.on) await Promise.resolve();
    this.box.current?.click(); // REPORT await in a branch
  }
  render() {
    return <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={() => {}} />;
  }
}

class HandsACallbackToSomethingUnknown extends Component {
  @state on = false;
  box = createRef<HTMLInputElement>();
  @mounted
  start() {
    later(() => this.box.current?.click()); // REPORT unknown caller
  }
  render() {
    return <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={() => {}} />;
  }
}

/* ---- Not reported ---- */

class ClicksFromAHandler extends Component {
  @state on = false;
  box = createRef<HTMLInputElement>();
  rowClicked() {
    this.box.current?.click();
  }
  render() {
    return (
      <div onclick={this.rowClicked}>
        <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={() => {}} />
      </div>
    );
  }
}

class ClicksAfterTheCommit extends Component {
  @state on = false;
  box = createRef<HTMLInputElement>();
  @mounted
  start() {
    queueMicrotask(() => this.box.current?.click());
    setTimeout(() => this.box.current?.click(), 0);
    Promise.resolve().then(() => this.box.current?.click());
    queueMicrotask(this.tick);
  }
  tick = () => {
    this.box.current?.click();
  };
  render() {
    return <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={() => {}} />;
  }
}

class ClicksPastAnAwait extends Component {
  @state on = false;
  box = createRef<HTMLInputElement>();
  @mounted
  async start() {
    await Promise.resolve();
    this.box.current?.click();
  }
  render() {
    return <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={() => {}} />;
  }
}

class ClicksAButtonAndAFileInput extends Component {
  button = createRef<HTMLButtonElement>();
  file = createRef<HTMLInputElement>();
  @mounted
  start() {
    this.button.current?.click();
    this.file.current?.click();
  }
  render() {
    return (
      <div>
        <button type="button" ref={this.button}>
          Go
        </button>
        <input type="file" aria-label="f" ref={this.file} />
      </div>
    );
  }
}

class AnnouncesItself extends Component {
  @mounted
  start() {
    window.dispatchEvent(new CustomEvent(READY));
  }
  render() {
    return <div />;
  }
}

class WritesAnUncontrolledField extends Component {
  field = createRef<HTMLInputElement>();
  @mounted
  start() {
    this.field.current!.value = "x";
  }
  render() {
    return <input aria-label="u" ref={this.field} />;
  }
}

class FocusesOnMount extends Component {
  field = createRef<HTMLInputElement>();
  @state text = "";
  @mounted
  start() {
    this.field.current?.focus();
  }
  render() {
    return <input aria-label="f" ref={this.field} value={this.text} oninput={() => {}} />;
  }
}

class DispatchesAtTheDocument extends Component {
  @mounted
  start() {
    document.dispatchEvent(new Event("change"));
    window.dispatchEvent(new Event("input"));
  }
  render() {
    return <div />;
  }
}

class Store extends EventTarget {}

class TellsAStore extends Component {
  store = new Store();
  @mounted
  start() {
    this.store.dispatchEvent(new Event("change"));
  }
  render() {
    return <div />;
  }
}

class HandlersWrittenInline extends Component {
  @state on = false;
  @state text = "";
  box = createRef<HTMLInputElement>();
  field = createRef<HTMLInputElement>();
  clear() {
    this.field.current!.value = "";
  }
  render() {
    return (
      <div onclick={() => this.box.current?.click()}>
        <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={() => {}} />
        <input aria-label="t" ref={this.field} value={this.text} oninput={() => {}} />
        <button type="button" onclick={() => this.clear()}>
          Clear
        </button>
        {[1, 2].map((n) => (
          <button type="button" key={n} onclick={() => this.box.current?.click()}>
            {n}
          </button>
        ))}
      </div>
    );
  }
}

class ClicksALabelOfATextField extends Component {
  @state text = "";
  label = createRef<HTMLLabelElement>();
  named = createRef<HTMLLabelElement>();
  @mounted
  start() {
    this.label.current?.click();
    this.named.current?.click();
  }
  render() {
    return (
      <div>
        <label ref={this.label}>
          Name <input value={this.text} oninput={() => {}} />
        </label>
        <label ref={this.named} for="city">
          City
        </label>
        <input id="city" value={this.text} oninput={() => {}} />
      </div>
    );
  }
}

class ClicksALabelForABox extends Component {
  @state on = false;
  label = createRef<HTMLLabelElement>();
  @mounted
  start() {
    this.label.current?.click(); // REPORT label for a box
  }
  render() {
    return (
      <div>
        <label ref={this.label} for="terms">
          Terms
        </label>
        <input id="terms" type="checkbox" checked={this.on} onchange={() => {}} />
      </div>
    );
  }
}

class ARefCallbackRunsInTheCommit extends Component {
  @state on = false;
  render() {
    return (
      <input
        type="checkbox"
        aria-label="b"
        ref={(node: HTMLInputElement | null) => node?.dispatchEvent(new Event("change"))} // REPORT ref callback
        checked={this.on}
        onchange={() => {}}
      />
    );
  }
}

declare function load(): Promise<string>;

class CallsALocalFunctionNow extends Component {
  @state on = false;
  box = createRef<HTMLInputElement>();
  @mounted
  start() {
    const toggle = () => this.box.current?.click(); // REPORT local function called
    toggle();
    function tick(box: HTMLInputElement | null) {
      box?.dispatchEvent(new Event("change"));
    }
    tick(this.box.current);
    document.querySelector("input")?.dispatchEvent(new Event("input")); // REPORT query
  }
  render() {
    return <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={this.flipped} />;
  }
  flipped() {}
}

class AwaitsOnlyInABranch extends Component {
  @state on = false;
  box = createRef<HTMLInputElement>();
  @mounted
  async start() {
    const text = this.on ? await load() : "";
    void text;
    this.box.current?.click(); // REPORT branch await
  }
  render() {
    return <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={this.flipped} />;
  }
  flipped() {}
}

class DispatchesAHeldEdit extends Component {
  @state text = "";
  field = createRef<HTMLInputElement>();
  @mounted
  start() {
    const edit = new Event("input");
    this.field.current?.dispatchEvent(edit); // REPORT held edit
  }
  render() {
    return <input aria-label="t" ref={this.field} value={this.text} oninput={this.typed} />;
  }
  typed() {}
}

class RefCallbackInAConditional extends Component {
  @state on = false;
  render() {
    return (
      <input
        type="checkbox"
        aria-label="b"
        ref={this.on ? (node: HTMLInputElement | null) => node?.click() : undefined} // REPORT ref in a conditional
        checked={this.on}
        onchange={this.flipped}
      />
    );
  }
  flipped() {}
}

class HandlerHeldInALocal extends Component {
  @state on = false;
  box = createRef<HTMLInputElement>();
  @mounted
  start() {
    const tick = () => this.box.current?.click();
    setTimeout(tick, 0);
  }
  render() {
    const toggle = () => this.box.current?.click();
    return (
      <div>
        <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={this.flipped} />
        <button type="button" onclick={toggle}>
          Toggle
        </button>
        <button type="button" onclick={this.on ? () => this.box.current?.click() : undefined}>
          Again
        </button>
      </div>
    );
  }
  flipped() {}
}

class AwaitsBeforeItClicks extends Component {
  @state on = false;
  @state text = "";
  box = createRef<HTMLInputElement>();
  @mounted
  async start() {
    this.text = await load();
    this.box.current?.click();
  }
  @updated
  async again() {
    try {
      await load();
    } catch {
      return;
    }
    this.box.current?.click();
  }
  render() {
    return <input type="checkbox" aria-label="b" ref={this.box} checked={this.on} onchange={this.flipped} />;
  }
  flipped() {}
}

class DispatchesAHeldFocus extends Component {
  @state text = "";
  field = createRef<HTMLInputElement>();
  @mounted
  start() {
    const focus = new FocusEvent("focus");
    this.field.current?.dispatchEvent(focus);
    new MutationObserver(() => this.field.current?.dispatchEvent(new Event("input")));
  }
  render() {
    return <input aria-label="t" ref={this.field} value={this.text} oninput={this.typed} />;
  }
  typed() {}
}
