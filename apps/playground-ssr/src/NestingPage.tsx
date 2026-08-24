import { Component, Head, created, destroyed, interval, state } from "@ramonda/core";

/**
 * The page to LOOK at, now that a component is a range rather than an element.
 *
 * Four things, each readable three ways — in view-source, in the Elements panel, and in the Ramonda
 * devtools tree — and they should disagree in exactly one place:
 *
 * - **view-source** carries the marker pair the server writes around each component's nodes, with
 *   its state blob on the opening one. It is the only thing that can say where one component's run
 *   of siblings ends and the next one's begins, because served markup is text.
 * - **the Elements panel**, after hydration, carries none of it. The markers are consumed and taken
 *   out, so the page ends up holding exactly what a client-side render would have produced.
 * - **the devtools tree** shows every component either way, including the ones with no markup at
 *   all — it reads the child record, which is the only thing that knows they are there.
 */

/** The innermost of four. It is the only one of them with any markup. */
class Inner extends Component {
  render() {
    return <code id="deep">one element, four components</code>;
  }
}

class Middle extends Component {
  render() {
    return <Inner />;
  }
}

class Outer extends Component {
  render() {
    return <Middle />;
  }
}

/**
 * Two cells from one component, and the reason the host had to go.
 *
 * An element here is destroyed by the HTML parser: a `<tr>` accepts `<td>` and nothing else, so a
 * wrapper is FOSTER-PARENTED out in front of the whole table and its children are re-parsed into
 * the row separately. The component's own state and lifecycle end up outside the table while its
 * markup ends up inside it. That was `RMD010`, an error, and it is not a fault that can be made any
 * more — a component has no element to be moved.
 */
class PersonCells extends Component<{ name: string; age: number }> {
  @state editing = false;

  toggle(): void {
    this.editing = !this.editing;
  }

  render() {
    return [
      <td className="name">
        <button type="button" onclick={this.toggle}>
          {this.editing ? "done" : this.props.name}
        </button>
      </td>,
      <td className="age">{this.props.age}</td>,
    ];
  }
}

/** A leaf with markup of its own, so a toggle has something to show and hide. */
class Panel extends Component<{ label: string }> {
  @state hits = 0;

  bump(): void {
    this.hits++;
  }

  render() {
    return (
      <p className="panel-line">
        <button type="button" onclick={this.bump}>
          {this.props.label} — clicked {this.hits} times
        </button>
      </p>
    );
  }
}

/**
 * A component whose whole job is to decide whether other components are rendered.
 *
 * It owns state and a lifecycle and NO markup — its own render returns the children or nothing. This
 * is what a fragment cannot do in React, because a fragment takes no state: the flag has to live in
 * a parent, or a wrapper element has to appear to hold it. Here it is an ordinary component.
 *
 * Watch what the toggle costs in the DOM: nothing. Closed, this component and its two children are
 * three live components with three states and no nodes between them.
 */
class Switch extends Component {
  @state open = true;

  flip(): void {
    this.open = !this.open;
  }

  render() {
    return [
      <p>
        <button id="flip" type="button" onclick={this.flip}>
          {this.open ? "hide both panels" : "show both panels"}
        </button>
      </p>,
      this.open ? <Panel label="first" /> : null,
      this.open ? <Panel label="second" /> : null,
    ];
  }
}

/**
 * A component with state, a lifecycle and a running timer, and no markup at all.
 *
 * It is in the devtools tree with its `ticks` counting up, and it is in no part of the DOM. There
 * used to be a `<ramonda-host style="display: contents">` here: a real node, in the page, that took
 * part in no layout — so the only way to have state without markup was to leave an element behind
 * anyway, or to use a Hook and give up having a lifecycle of your own.
 *
 * Find it in the panel under `Silent`. Nothing on the page will point at it.
 */
class Silent extends Component {
  @state ticks = 0;

  @created born(): void {
    this.ticks = 0;
  }

  @interval(1000) tick(): void {
    this.ticks++;
  }

  @destroyed gone(): void {
    // Here so a reader can watch it fire when the route changes: the component is torn down through
    // the child RECORD, because there is no node to find it on.
    console.info("[Silent] destroyed after", this.ticks, "ticks");
  }

  render() {
    return null;
  }
}

export class NestingPage extends Component {
  head = this.use(Head, () => ({
    title: "Nesting — Ramonda SSR",
    description: "What a component looks like in the DOM now that it owns a range rather than an element.",
  }));

  /** Counts what is left of the server's markers, which after hydration has to be zero. */
  @state comments = -1;

  count(): void {
    const root = document.getElementById("app");
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    let found = 0;
    while (walker.nextNode()) found++;
    this.comments = found;
  }

  render() {
    return (
      <div className="page">
        <h2>Nesting, toggles, and nothing at all</h2>
        <p>
          Open view-source and the Elements panel side by side. The served HTML carries a <code>&lt;!--c…--&gt;</code>{" "}
          pair around each component; the live DOM carries none of them.
        </p>

        <h3>Four components, one element</h3>
        <Outer />
        <p className="demo-note">
          <code>NestingPage → Outer → Middle → Inner</code>. Three of the four render nothing of their own, and the DOM
          holds one <code>&lt;code&gt;</code>.
        </p>

        <h3>Two cells from one component</h3>
        <table>
          <tbody>
            <tr className="person">
              <PersonCells name="Ana" age={31} />
            </tr>
            <tr className="person">
              <PersonCells name="Marko" age={44} />
            </tr>
          </tbody>
        </table>
        <p className="demo-note">
          Each row's two <code>&lt;td&gt;</code> come from one component, which owns the state behind the name button.
          In the Elements panel the row's only children are the two cells.
        </p>

        <h3>A toggle that owns no element</h3>
        <Switch />
        <p className="demo-note">
          Hide them and look again: three components are still live — the switch and the two panels are gone from the
          DOM, and the switch keeps its state. The panels keep theirs only while they are rendered, which is what
          unmounting means.
        </p>

        <h3>A component with no markup at all</h3>
        <Silent />
        <p className="demo-note">
          <code>Silent</code> has state, a <code>@created</code>, a running <code>@interval</code> and no nodes. It is
          in the devtools tree with its counter moving, and nowhere in this page.
        </p>

        <h3>What is left of the server's markers</h3>
        <p>
          <button id="count-comments" type="button" onclick={this.count}>
            count comment nodes under #app
          </button>{" "}
          <output id="comment-count">{this.comments < 0 ? "not counted yet" : String(this.comments)}</output>
        </p>
        <p className="demo-note">
          Zero after hydration. The same page in view-source has one pair per component — that is the whole of what the
          server has to say about structure, and it says it in comments because a comment is the only thing the parser
          leaves alone inside a <code>&lt;tr&gt;</code>.
        </p>
      </div>
    );
  }
}
