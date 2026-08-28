import { Component, bootstrap } from "@ramonda/core";

declare function open(): void;
declare function onKey(e: unknown): void;

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ The plain case, as the control. */}
        <div onclick={open}>Open</div>

        {/* ✗ The verbatim event name, which the framework takes and this did not. */}
        <div on:click={open}>Open</div>

        {/* ✓ A key handler written verbatim IS a keyboard path. */}
        <div onclick={open} on:keydown={onKey}>
          Open
        </div>

        {/* ✓ The dotted key handler, as the control for that half. */}
        <div onclick={open} onkeydown={onKey}>
          Open
        </div>

        {/* ✗ A link inside a link, which is the nesting rule's own control. */}
        <a href="/outer">
          <a href="/inner">inner</a>
        </a>
      </div>
    );
  }
}

bootstrap(<App />, null);
