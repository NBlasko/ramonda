import { Component, createRef, state } from "@ramonda/core";

// A Ref holds a real DOM node. Use it when you need the element itself — focus,
// measure, hand it to a chart library — and not to read or change what the
// component renders, which is what state is for.
export class RefFocus extends Component {
  // On a COMPONENT a ref receives its host element. On an intrinsic tag, that tag.
  private input = createRef<HTMLInputElement>();
  @state length = 0;

  focusInput() {
    // `.current` is null until the element is in the document — so reach for it
    // from an event or @mounted, never from render().
    this.input.current?.focus();
  }

  onInput(event: Event) {
    this.length = (event.target as HTMLInputElement).value.length;
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          <input
            ref={this.input}
            type="text"
            aria-label="Anything you like"
            placeholder="type here"
            oninput={this.onInput}
          />
          <button type="button" onclick={this.focusInput}>
            focus it
          </button>
          <span className="demo-note">{this.length} characters</span>
        </p>
      </div>
    );
  }
}
