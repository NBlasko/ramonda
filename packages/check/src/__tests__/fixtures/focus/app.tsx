import { Component, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;
declare const busy: boolean;
declare const index: number;

/**
 * Every shape `aria-hidden-on-focusable` has an opinion about, beside every shape it must not.
 *
 * A fixture of its own rather than a few more lines in `a11y/`: adding cases to a shared fixture
 * moves every OTHER rule's counts in it, which is how a green suite starts asserting the wrong
 * numbers. Measured once already in this package — a hook class added to `framework.ts` moved
 * three fixtures at a stroke.
 */
class Toolbar extends Component {
  render() {
    return (
      <div>
        <div>
          {/* REPORTED — a button is focusable on its own, and this one cannot be announced. */}
          <button aria-hidden="true">Save</button>
          {/* REPORTED — an `<a>` with an `href` is focusable too. */}
          <a href="/help" aria-hidden="true">
            Help
          </a>
          {/* REPORTED — `tabIndex` put a plain div in the tab order. */}
          <div aria-hidden="true" tabIndex={0}>
            Panel
          </div>
          {/* REPORTED — the same fact written as a string, which JSX also accepts. */}
          <span aria-hidden="true" tabIndex="0">
            Chip
          </span>

          {/* Not reported: the two agree — hidden from the tree AND out of the tab order. */}
          <button aria-hidden="true" tabIndex={-1}>
            Decorative
          </button>
          {/* Not reported: an `<a>` with no `href` is not focusable to begin with. */}
          <a aria-hidden="true">not a link</a>
          {/* Not reported: nothing focusable about it. */}
          <span aria-hidden="true">×</span>
          {/* Not reported: this is the RIGHT shape — the icon is hidden, the button is announced. */}
          <button>
            <svg aria-hidden="true" />
            Delete
          </button>
          {/* Not reported: a hidden input is not focusable. */}
          <input type="hidden" aria-hidden="true" />
          {/* Not reported: `aria-hidden="false"` is not a claim that anything is hidden. */}
          <button aria-hidden="false">Cancel</button>
          {/* Not reported: an expression this cannot read — the silence contract. */}
          <button aria-hidden={busy}>Maybe</button>
          {/* Not reported: a `tabIndex` this cannot read says nothing about the tab order. */}
          <div aria-hidden="true" tabIndex={index}>
            Row
          </div>
          {/* Not reported: a spread may carry either attribute, so no rule is handed this at all. */}
          <button aria-hidden="true" {...rest}>
            Spread
          </button>
          {/* Not reported: a COMPONENT is not markup yet — what it renders is decided inside it. */}
          <Toolbar aria-hidden="true" />
        </div>
      </div>
    );
  }
}

bootstrap(<Toolbar />, null);

declare const to: string;

/**
 * Every shape `link-without-a-destination` has an opinion about, beside every shape it must not.
 *
 * In this fixture rather than its own because the two rules are about the same thing from opposite
 * sides — one is about an element the keyboard reaches and should not, the other about one it
 * should reach and cannot.
 */
class Links extends Component {
  render() {
    return (
      <nav>
        <nav>
          {/* REPORTED — no `href`, and a handler where the destination should be. */}
          <a onclick={() => {}}>Open</a>
          {/* REPORTED — a destination that is this page. */}
          <a href="#" onclick={() => {}}>
            Toggle
          </a>
          {/* REPORTED — not a destination, and the shape a CSP refuses first. */}
          <a href="javascript:void(0)">Run</a>
          {/* REPORTED — no `href` and no handler either; it is text that looks like a link. */}
          <a>Nowhere</a>

          {/* REPORTED — an EMPTY href resolves to this page, so following it reloads: worse than the
              bare `#` above rather than the same. Found by auditing the claim ("one that goes
              nowhere") against the code, which enumerated only `#` and `javascript:`. */}
          <a href="">Empty</a>

          {/* Not reported: a real destination. */}
          <a href="/pricing">Pricing</a>
          {/* Not reported: a fragment that names something is the point of a table of contents. */}
          <a href="#pricing">Jump to pricing</a>
          {/* Not reported: an expression this cannot read — the silence contract. */}
          <a href={to}>Wherever</a>
          {/* Not reported: the legacy anchor TARGET, written to be jumped to rather than to jump. */}
          <a id="pricing" />
        </nav>
      </nav>
    );
  }
}

bootstrap(<Links />, null);

/**
 * A click handler with no keyboard path, beside every shape that has one.
 *
 * The wrapper cases are the load-bearing half. "Click anywhere on the card" is written constantly
 * and works perfectly well for a keyboard, because the real control is one level in — a rule that
 * reported it would be reporting a page that works.
 */
class Cards extends Component {
  render() {
    return (
      <section>
        {/* REPORTED — a pointer and nothing else. */}
        <div onclick={() => {}}>Open</div>
        {/* REPORTED — `onMouseDown` is the same fault. */}
        <span onmousedown={() => {}}>Drag</span>
        {/* Reported too, and it is the OLD spelling on purpose: the framework's types refuse
            `onMouseUp` now, but a project with no types still compiles it and the rule has to see
            it. The lookup is lower-cased, so both reach the same answer. */}
        <span onMouseUp={() => {}}>Also drag</span>

        {/* Not reported: a button is all three things already. */}
        <button onclick={() => {}}>Open</button>
        {/* Not reported: a key handler is a keyboard path. */}
        <div onclick={() => {}} onkeydown={() => {}} role="button" tabIndex={0}>
          Open
        </div>
        {/* Not reported: somebody is building the path by hand; picking at a half-built one is a
            different rule from this one. */}
        <div onclick={() => {}} role="button">
          Open
        </div>
        {/* Not reported: the real control is one level in. */}
        <div className="card" onclick={() => {}}>
          <h3>Title</h3>
          <a href="/read">Read more</a>
        </div>
        {/* Not reported: a COMPONENT renders who-knows-what, so nothing here is certain. */}
        <div onclick={() => {}}>
          <Cards />
        </div>
        {/* Not reported: no handler at all. */}
        <div className="plain">Text</div>
        {/* Not reported: nothing inside it, so it is a backdrop rather than a control. Found by
            running the first version of this rule against the documentation site, where both of its
            reports were exactly this and both were correct. */}
        <div className="backdrop" onclick={() => {}} />
      </section>
    );
  }
}

bootstrap(<Cards />, null);
