import { Component, state, onDocument } from "@ramonda/core";

// @onDocument listens on the document, which is what a global shortcut needs —
// the key event does not reach this component's own element unless the focus
// happens to be inside it.
//
// The handler's parameter is typed from the event NAME: "keydown" gives a
// KeyboardEvent with no cast. A name the DOM's map does not know falls back to
// Event, which is all the platform can promise about it.
export class KeyboardShortcut extends Component {
  @state lastKey = "—";
  @state count = 0;

  @onDocument("keydown")
  onKeyDown(event: KeyboardEvent) {
    if (event.key.length !== 1 && event.key !== "Escape") return;
    this.lastKey = event.key === "Escape" ? "Escape" : event.key;
    this.count = this.count + 1;
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          <span>
            last key: <kbd>{this.lastKey}</kbd>
          </span>
          <span className="demo-note">pressed {this.count} times — type anywhere on the page</span>
        </p>
      </div>
    );
  }
}
