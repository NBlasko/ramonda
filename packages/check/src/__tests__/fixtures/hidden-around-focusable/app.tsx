import { Component, bootstrap } from "@ramonda/core";

declare const busy: boolean;
declare const rows: string[];

class Action extends Component {
  render() {
    return null;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ The modal shape: the page behind is hidden and every control back there still tabs. */}
        <div aria-hidden="true">
          <button type="button">Save</button>
        </div>

        {/* ✗ Nested two elements deep, which is how it really looks. */}
        <div aria-hidden="true">
          <section>
            <p>text</p>
            <a href="/x">Read more</a>
          </section>
        </div>

        {/* ✗ Something put in the tab order by hand. */}
        <div aria-hidden="true">
          <div tabIndex={0}>panel</div>
        </div>

        {/* ✗ The bare spelling of the attribute is the same claim. */}
        <div aria-hidden>
          <input type="text" />
        </div>

        {/* ✓ `inert` is the fix, and does the focus half as well. */}
        <div aria-hidden="true" inert>
          <button type="button">Save</button>
        </div>

        {/* ✓ Taken out of the tab order by hand — the other fix. */}
        <div aria-hidden="true">
          <button type="button" tabIndex={-1}>
            Save
          </button>
        </div>

        {/* ✓ Nothing focusable inside. */}
        <div aria-hidden="true">
          <span>decorative</span>
          <svg />
        </div>

        {/* ✓ An `<a>` with no href is not focusable. */}
        <div aria-hidden="true">
          <a>not a link</a>
        </div>

        {/* ✓ A hidden input is not focusable. */}
        <div aria-hidden="true">
          <input type="hidden" />
        </div>

        {/* ✓ A COMPONENT renders what it renders — guessing is how a rule reports a correct page. */}
        <div aria-hidden="true">
          <Action />
        </div>

        {/* ✓ And so does an expression. */}
        <div aria-hidden="true">{rows.map((r) => r)}</div>

        {/* ✓ `aria-hidden={busy}` may be either, so nothing is claimed. */}
        <div aria-hidden={busy}>
          <button type="button">Save</button>
        </div>

        {/* ✓ `aria-hidden="false"` hides nothing. */}
        <div aria-hidden="false">
          <button type="button">Save</button>
        </div>
      </div>
    );
  }
}

bootstrap(<App />, null);
