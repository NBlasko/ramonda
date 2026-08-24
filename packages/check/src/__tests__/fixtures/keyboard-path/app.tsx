import { Component, Host, bootstrap } from "@ramonda/core";

declare function open(): void;
declare function onKey(e: unknown): void;

/** A wrapper that hands its children straight to its own host element. */
@Host("a")
class LinkBox extends Component<{ children?: unknown }> {
  render() {
    return this.props.children;
  }
}

/** The same wrapper written with a FRAGMENT, which adds no element and is how it is usually typed. */
@Host("a")
class LinkFragment extends Component<{ children?: unknown }> {
  render() {
    return <>{this.props.children}</>;
  }
}

/** ✓ A wrapper that puts its children inside something ELSE. Nothing here is provable. */
@Host("a")
class LinkPadded extends Component<{ children?: unknown }> {
  render() {
    return <span>{this.props.children}</span>;
  }
}

@Host("div")
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

        {/* ✗ A link inside a component whose HOST is a link. */}
        <LinkBox>
          <a href="/inner">inner</a>
        </LinkBox>

        {/* ✗ The same through the fragment spelling. */}
        <LinkFragment>
          <a href="/inner">inner</a>
        </LinkFragment>

        {/* ✓ The children land in a `<span>`, so what encloses them is not the host. */}
        <LinkPadded>
          <a href="/inner">inner</a>
        </LinkPadded>

        {/* ✗ The plain nesting, as the control. */}
        <a href="/outer">
          <a href="/inner">inner</a>
        </a>
      </div>
    );
  }
}

bootstrap(<App />, null);
