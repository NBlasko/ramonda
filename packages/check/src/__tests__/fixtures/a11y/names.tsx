import { bootstrap, Component } from "@ramonda/core";

/**
 * `aria-label` written where the specification says a name is prohibited. Every attribute below is
 * spelled correctly and every role is real, so nothing else in this package has anything to say —
 * and none of these names reaches the accessibility tree.
 */
export class Names extends Component {
  role = "region";
  render() {
    return (
      <div>
        {/* REPORTED — a div is `generic`, and generic is the role for an element with no meaning. */}
        <div aria-label="Filters">A group of filters</div>
        {/* REPORTED — the same for a span, and for a labelledby rather than a label. */}
        <span aria-labelledby="title">Text</span>
        {/* REPORTED — presentation removes the element from the tree, so there is nothing to name. */}
        <div role="presentation" aria-label="Layout" />
        {/* REPORTED — `none` is the same role under its newer name. */}
        <div role="none" aria-label="Layout" />
        {/* REPORTED — a paragraph takes no name either. */}
        <p aria-label="Summary">Some prose.</p>
        {/* REPORTED — twice, once per attribute. */}
        <div aria-label="One" aria-labelledby="two" />

        {/* Not reported: a written role wins, and a region is named exactly this way. */}
        <div role="region" aria-label="Filters" />
        {/* Not reported: the documented way to write a named region. */}
        <section aria-label="Filters" />
        {/* Not reported: how two navs are told apart. */}
        <nav aria-label="Breadcrumb" />
        {/* Not reported: a landmark and a control, both of which take names. */}
        <main aria-label="Content" />
        <button aria-label="Close">×</button>
        {/* Not reported: no name written at all. */}
        <div>Ordinary</div>
        {/* Not reported: nothing here can read the role, and it may be one that takes a name. */}
        <div role={this.role} aria-label="Maybe" />
        {/* Not reported: a component's prop is not markup yet. */}
        <Panel aria-label="Filters" />
      </div>
    );
  }
}

export class Panel extends Component {
  render() {
    return <div />;
  }
}

bootstrap(<Names />, null);
