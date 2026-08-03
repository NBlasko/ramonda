import { Component, Host, list, state, memoizedHandler } from "@ramonda/core";

/** Module scope, so `each` is the SAME array every render — a fresh literal would be a new value
 *  each time and cost the list the identity it mints from its items. */
const TAGS = ["section", "article", "aside"];

// Every component is exactly one element, and @Host says which. Without it the
// element is <ramonda-host style="display: contents"> — a real node that takes
// part in no layout, so adding a component costs nothing visually.
//
// The tag may come from PROPS, which lets the caller decide: <Card as="section">.
// It must be pure — the diff calls it while deciding whether an existing element
// can be reused, so it runs more than once and may depend on nothing but props.
//
// One instance's host never changes. The host element IS the component, so
// swapping it would destroy that element and everything attached to it. A prop
// change that resolves to a different tag does not mutate the host: it fails to
// match in the diff and a fresh component is built in its place.
@Host((props: { as?: string }) => props.as ?? "div")
class Card extends Component<{ as?: string }> {
  render() {
    return <span>I am a &lt;{this.props.as ?? "div"}&gt;</span>;
  }
}

// No @Host at all — this one gets the default transparent host.
class Plain extends Component {
  render() {
    return <span>I have the default host.</span>;
  }
}

@Host("div")
export class HostTag extends Component {
  @state as = "section";
  @state tagName = "";

  // Cached by its argument, so each button keeps one handler across renders.
  renderChoice(tag: string) {
    return (
      <button type="button" disabled={this.as === tag} onClick={this.select(tag)}>
        as="{tag}"
      </button>
    );
  }

  @memoizedHandler
  select(next: string) {
    return () => {
      this.as = next;
    };
  }

  render() {
    return (
      <div>
        <p className="demo-row">{list({ each: TAGS, render: this.renderChoice })}</p>
        <Card as={this.as} />
        <Plain />
        <p className="demo-note">
          Inspect the elements: the first is a real &lt;{this.as}&gt;, the second is &lt;ramonda-host&gt;.
        </p>
      </div>
    );
  }
}
