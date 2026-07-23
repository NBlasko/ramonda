import { Component, state, list } from "@ramonda/core";
import { Chip, ArrayPanel, IconPanel, PlainPanel, TextPanel } from "../demos/SlotPanels";

interface Guest {
  name: string;
}

let nextGuest = 1;
const makeGuest = (): Guest => ({ name: `guest ${nextGuest++}` });

/**
 * Slots, and the edge cases around them.
 *
 * The thing to try on every panel: click chips to give them counters, then
 * reorder, remove, or hide something — including the panel's OWN head/foot —
 * and check that every counter stayed on the chip it belonged to. The labels
 * always come out right either way; only the counters show whether a DOM node
 * was handed to the wrong owner.
 */
export class SlotsPage extends Component {
  // Case 1: an array slot, driven by list().
  @state guests: Guest[] = [makeGuest(), makeGuest(), makeGuest()];

  // Case 2: a hand-written array slot — no list(), no keys anywhere.
  @state manual = ["alpha", "beta"];

  // Case 3: a single element through a named prop, which can also be null.
  @state showIcon = true;

  // Case 4: plain tags only, slot nested inside an object prop.
  @state plainRows = ["one", "two"];

  // Case 5: text as a slot, and the panel's own chrome around it.
  @state text = "slotted text";
  @state showBefore = true;

  addGuest() {
    this.guests = [...this.guests, makeGuest()];
  }
  prependGuest() {
    this.guests = [makeGuest(), ...this.guests];
  }
  removeFirstGuest() {
    this.guests = this.guests.slice(1);
  }
  reverseGuests() {
    this.guests = [...this.guests].reverse();
  }

  reverseManual() {
    this.manual = [...this.manual].reverse();
  }
  dropManual() {
    this.manual = this.manual.slice(0, -1);
  }
  addManual() {
    this.manual = [...this.manual, `extra ${this.manual.length + 1}`];
  }

  toggleIcon() {
    this.showIcon = !this.showIcon;
  }

  reversePlain() {
    this.plainRows = [...this.plainRows].reverse();
  }
  addPlain() {
    this.plainRows = [...this.plainRows, `row ${this.plainRows.length + 1}`];
  }

  toggleBefore() {
    this.showBefore = !this.showBefore;
  }
  editText() {
    this.text = this.text === "slotted text" ? "changed text" : "slotted text";
  }

  render() {
    return (
      <div className="page">
        <h2>Slots</h2>
        <p className="muted">
          Every panel below uses the <strong>same tag for its own chrome</strong> as the content it receives. Click
          chips to give them counters, then reorder or remove things: the counters must stay with their own chip,
          including the panel's own HEAD/FOOT. Labels alone would not show a problem — only state does.
        </p>

        {/* ── 1. array slot, via list() ──────────────────────────────────── */}
        <section className="slotcase">
          <div className="row">
            <h3>1 · array slot (list)</h3>
            <button onClick={this.prependGuest}>prepend</button>
            <button onClick={this.addGuest}>append</button>
            <button onClick={this.removeFirstGuest}>remove first</button>
            <button onClick={this.reverseGuests}>reverse</button>
          </div>
          <p className="muted small">
            No <code>key</code> written anywhere — the list mints identity from the guest object itself. Reverse and the
            counters travel with their chips.
          </p>
          <ArrayPanel>
            {list({
              each: this.guests,
              render: (guest: Guest) => <Chip label={guest.name} />,
            })}
          </ArrayPanel>
        </section>

        {/* ── 2. hand-written array, no list(), no keys ──────────────────── */}
        <section className="slotcase">
          <div className="row">
            <h3>2 · hand-written array slot, no keys</h3>
            <button onClick={this.addManual}>add</button>
            <button onClick={this.dropManual}>drop last</button>
            <button onClick={this.reverseManual}>reverse</button>
          </div>
          <p className="muted small">
            A plain <code>.map()</code>, unkeyed. The panel's HEAD/FOOT stay intact whatever happens here, because the
            array is one child rather than spliced among them. Reversing <em>inside</em> the slot still moves state by
            position — that is what keys, or <code>list()</code>, are for.
          </p>
          <ArrayPanel>
            {this.manual.map((label) => (
              <Chip label={label} />
            ))}
          </ArrayPanel>
        </section>

        {/* ── 3. single element through a named prop ─────────────────────── */}
        <section className="slotcase">
          <div className="row">
            <h3>3 · single element, named prop, can be null</h3>
            <button onClick={this.toggleIcon}>{this.showIcon ? "hide" : "show"} the slot</button>
          </div>
          <p className="muted small">
            Not an array, so there is no structure to group. Hide and show it a few times: FOOT keeps its counter,
            because every vnode records which component built it.
          </p>
          <IconPanel icon={this.showIcon ? <Chip label="ICON (from caller)" /> : null} />
        </section>

        {/* ── 4. plain tags only, slot nested in an object prop ──────────── */}
        <section className="slotcase">
          <div className="row">
            <h3>4 · plain tags, slot nested inside an object</h3>
            <button onClick={this.addPlain}>add</button>
            <button onClick={this.reversePlain}>reverse</button>
          </div>
          <p className="muted small">
            No components in the slot at all, and it arrives as <code>slots.body</code> — proof the guarantee does not
            depend on the prop's name or on how deep it sits.
          </p>
          <PlainPanel
            slots={{
              body: this.plainRows.map((label) => <li className="chip">{label}</li>),
            }}
          />
        </section>

        {/* ── 5. text as a slot ──────────────────────────────────────────── */}
        <section className="slotcase">
          <div className="row">
            <h3>5 · text slot between elements</h3>
            <button onClick={this.editText}>change the text</button>
            <button onClick={this.toggleBefore}>{this.showBefore ? "remove" : "restore"} the element before it</button>
          </div>
          <p className="muted small">
            Text has no tag and no key. Removing the element in front of it shifts every position after it — the case
            where a naive walk starts handing nodes to the wrong child.
          </p>
          <TextPanel before={this.showBefore ? <i className="mid">·before·</i> : null}>{this.text}</TextPanel>
        </section>
      </div>
    );
  }
}
