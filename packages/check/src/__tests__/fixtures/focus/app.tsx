import { Component, Host, bootstrap } from "../framework";

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
@Host("div")
class Toolbar extends Component {
  render() {
    return (
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
@Host("nav")
class Links extends Component {
  render() {
    return (
      <nav>
        {/* REPORTED — no `href`, and a handler where the destination should be. */}
        <a onClick={() => {}}>Open</a>
        {/* REPORTED — a destination that is this page. */}
        <a href="#" onClick={() => {}}>
          Toggle
        </a>
        {/* REPORTED — not a destination, and the shape a CSP refuses first. */}
        <a href="javascript:void(0)">Run</a>
        {/* REPORTED — no `href` and no handler either; it is text that looks like a link. */}
        <a>Nowhere</a>

        {/* Not reported: a real destination. */}
        <a href="/pricing">Pricing</a>
        {/* Not reported: a fragment that names something is the point of a table of contents. */}
        <a href="#pricing">Jump to pricing</a>
        {/* Not reported: an expression this cannot read — the silence contract. */}
        <a href={to}>Wherever</a>
        {/* Not reported: the legacy anchor TARGET, written to be jumped to rather than to jump. */}
        <a id="pricing" />
      </nav>
    );
  }
}

bootstrap(<Links />, null);
