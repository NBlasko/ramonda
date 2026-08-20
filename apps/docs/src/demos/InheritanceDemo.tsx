import { Component, Host, state } from "@ramonda/core";

// The unit of reuse is the CLASS, and classes extend each other. That is why
// Ramonda needs no fragments: in a framework whose unit is a function, reuse
// means nesting, nesting costs an element, and a fragment hides it. Classes do
// not nest to be reused, so no wrapper appears.
@Host("div")
class Badge extends Component<{ label: string }> {
  @state clicks = 0;

  bump() {
    this.clicks = this.clicks + 1;
  }

  // Subclasses override this rather than re-implementing the whole render.
  protected decorate(text: string) {
    return <span>{text}</span>;
  }

  render() {
    return (
      <button type="button" className="demo-badge" onclick={this.bump}>
        {this.decorate(`${this.props.label} · ${this.clicks}`)}
      </button>
    );
  }
}

// Overrides ONE method. No constructor, no super() call to remember, and the
// inherited @state keeps working.
class LoudBadge extends Badge {
  protected decorate(text: string) {
    return <strong>{super.decorate(text)}!</strong>;
  }
}

// @Host is inherited too — and can be overridden, which is the answer to "someone
// styled a <td>, I want more behaviour but it must stay a <td>".
@Host("mark")
class MarkedBadge extends Badge {}

@Host("div")
export class InheritanceDemo extends Component {
  render() {
    return (
      <p className="demo-row">
        <Badge label="plain" />
        <LoudBadge label="loud" />
        <MarkedBadge label="marked" />
        <span className="demo-note">three classes, one render() between them — the third is a &lt;mark&gt;</span>
      </p>
    );
  }
}
