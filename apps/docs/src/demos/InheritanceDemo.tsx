import { Component, state } from "@ramonda/core";

// The unit of reuse is the CLASS, and classes extend each other. That is why
// Ramonda needs no fragments: in a framework whose unit is a function, reuse
// means nesting, nesting costs an element, and a fragment hides it. Classes do
// not nest to be reused, so no wrapper appears.
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
      <div>
        <button type="button" className="demo-badge" onclick={this.bump}>
          {this.decorate(`${this.props.label} · ${this.clicks}`)}
        </button>
      </div>
    );
  }
}

// Overrides ONE method. No constructor, no super() call to remember, and the
// inherited @state keeps working.
//
// `override` is not decoration: with `noImplicitOverride` on, TypeScript refuses a member that
// shadows a base's without it — so renaming `decorate` on Badge turns this into an error instead
// of a method nobody calls any more.
class LoudBadge extends Badge {
  protected override decorate(text: string) {
    return <strong>{super.decorate(text)}!</strong>;
  }
}

// A subclass can change the ELEMENT as well as the behaviour, by overriding the render — which is
// the answer to "someone styled a <td>, I want more behaviour but it must stay a <td>".
class MarkedBadge extends Badge {
  override render() {
    return <mark>{this.decorate(this.props.label)}</mark>;
  }
}

export class InheritanceDemo extends Component {
  render() {
    return (
      <div>
        <p className="demo-row">
          <Badge label="plain" />
          <LoudBadge label="loud" />
          <MarkedBadge label="marked" />
          <span className="demo-note">three classes, one render() between them — the third is a &lt;mark&gt;</span>
        </p>
      </div>
    );
  }
}
