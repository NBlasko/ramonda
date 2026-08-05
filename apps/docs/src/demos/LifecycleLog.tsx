import { Component, Host, list, state, create, mount, destroy } from "@ramonda/core";

// The order, shown rather than described. Mount the child and watch:
//
//   create → render → mount
//
// @create runs while the component is being built: there is no element yet, so
// nothing here can measure or focus anything. @mount runs once the DOM this
// commit built is in the document — that is where DOM work belongs.
//
// Unmount it and @destroy runs, while reactive values are still readable.
@Host("div")
class Tracked extends Component<{ log: (line: string) => void }> {
  @create born() {
    this.props.log(`@create — element in document? ${document.getElementById("tracked") !== null}`);
  }

  @mount ready() {
    this.props.log(`@mount  — element in document? ${document.getElementById("tracked") !== null}`);
  }

  @destroy gone() {
    this.props.log("@destroy");
  }

  render() {
    this.props.log("render");
    return <span id="tracked">I am the tracked component.</span>;
  }
}

@Host("div")
export class LifecycleLog extends Component {
  @state shown = false;
  @state lines: string[] = [];

  // Not @state on `lines` alone — pushing into an array in place would not be a
  // new value, so nothing would notice. Replace it. (RMD005 reports the mistake.)
  log(line: string): void {
    this.lines = [...this.lines, line];
  }

  toggle() {
    this.shown = !this.shown;
  }

  clear() {
    this.lines = [];
  }

  renderLine(line: string) {
    return <li>{line}</li>;
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          <button type="button" onClick={this.toggle}>
            {this.shown ? "unmount it" : "mount it"}
          </button>
          <button type="button" onClick={this.clear}>
            clear log
          </button>
        </p>
        {this.shown ? <Tracked log={this.log} /> : null}
        <ul className="demo-log">{list({ each: this.lines, render: this.renderLine })}</ul>
      </div>
    );
  }
}
