import { Component, Host, list, state, created, mounted, destroyed } from "@ramonda/core";

// The order, shown rather than described. Mount the child and watch:
//
//   create → render → mount
//
// @created runs while the component is being built: there is no element yet, so
// nothing here can measure or focus anything. @mounted runs once the DOM this
// commit built is in the document — that is where DOM work belongs.
//
// Unmount it and @destroyed runs, while reactive values are still readable.
@Host("div")
class Tracked extends Component<{ log: (line: string) => void }> {
  @created born() {
    this.props.log(`@created — element in document? ${document.getElementById("tracked") !== null}`);
  }

  @mounted ready() {
    this.props.log(`@mounted  — element in document? ${document.getElementById("tracked") !== null}`);
  }

  @destroyed gone() {
    this.props.log("@destroyed");
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
