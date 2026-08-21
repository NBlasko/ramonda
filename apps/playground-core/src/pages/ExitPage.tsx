import { Component, list, memoized, mounted, state, Timeout } from "@ramonda/core";
import { type Card, ExitCard } from "../demos/ExitCard";
import { ViewTransition } from "../demos/ViewTransition";

let next = 1;
const make = (): Card => ({ id: next, label: `card ${next++}` });

/**
 * What happens to a CSS exit transition when the element is removed.
 *
 * A card has `transition: opacity 3s, transform 3s, background-color 3s` and a `.leaving` class that
 * fades, slides and reddens it. Removing the card from the array asks the diff to take the node out — and
 * a node that is gone cannot animate. So the exit never plays, however good the CSS is.
 *
 * Three buttons, three answers, and the point is to watch the difference rather than read about it:
 *
 * 1. **remove** — what an app does today. Gone in the same frame; the transition never starts.
 * 2. **class, then remove** — the workaround. It animates, but the app now holds a timer that has to
 *    agree with the stylesheet, and the row stays interactive while it fades.
 * 3. **view transition** — the browser snapshots the frame, the removal happens inside the callback, and
 *    the SNAPSHOT animates. Nothing has to survive: the node is already gone while you watch it leave.
 *
 * Button 3 also answers a framework question. `startViewTransition` takes an async callback and waits for
 * it, and Ramonda commits on a microtask — so awaiting turns inside the callback is enough to put the
 * commit inside the transition. Measured here: it lands inside, so an app can do this today and the
 * framework needs no seam of its own.
 *
 * The log is the other half of the page. Each card is a component, so `@created`, `@mounted`, `@updated`
 * and `@destroyed` are visible — and WHEN `@destroyed` lands is the whole difference between the three.
 */
export class ExitPage extends Component {
  @state cards: Card[] = [make(), make(), make(), make()];
  @state leaving: number | null = null;
  @state readout = "nothing tried yet";
  @state log: string[] = [];

  /**
   * What the browser thinks, printed on the page.
   *
   * The first thing to rule out is the stylesheet: if `transitionDuration` reads `0s`, nothing here is
   * about the diff — the CSS is simply not on the element, and every button would look identical.
   */
  @mounted probe() {
    const card = document.querySelector(".exit-card");
    const duration = card ? getComputedStyle(card).transitionDuration : "no card found";
    const vt = typeof (document as Document & { startViewTransition?: unknown }).startViewTransition;
    this.readout = `transitionDuration=${duration}   startViewTransition=${vt}`;
  }

  /** Stable by being a method, which is what lets it travel through props. */
  say(line: string) {
    const at = new Date().toISOString().slice(14, 23);
    this.log = [...this.log, `${at}  ${line}`].slice(-14);
  }

  add() {
    this.cards = [...this.cards, make()];
  }

  clearLog() {
    this.log = [];
  }

  private drop(id: number) {
    // Clearing the mark here rather than in each caller: every route out of the list goes through this
    // one, and a card that has left cannot still be the one fading. Found by review — with the mark
    // left behind, removing a fading card with another button made the readout claim it "was still
    // fading, so it went at once" about a card that had already gone.
    if (this.leaving === id) this.leaving = null;
    this.cards = this.cards.filter((card) => card.id !== id);
  }

  /** 1. What an app does today. */
  removeNow(id: number) {
    this.readout = "removed straight away — the node is gone before the transition can start";
    this.drop(id);
  }

  /** 2. The workaround: mark it, wait for the stylesheet's duration, then remove. */
  /**
   * The timer this workaround needs, and there is nothing to remember about it.
   *
   * `@timeout` cannot express this one — it fires relative to MOUNT, and this starts on a click. So it
   * is a `Timeout`: teardown clears it, so leaving the page mid-fade simply does not remove the card,
   * where a raw `setTimeout` would have written into a component that is gone (`RMD008` drops the
   * write, so the symptom is a handler that quietly does nothing).
   *
   * **One hook instance is one timer, and that is a decision here rather than a detail.** This page has
   * ONE `leaving` id, so only one card can be fading at a time. A click on a DIFFERENT card finishes the
   * fading one first, and a click on the SAME one does nothing — both in `removeAfterClass`, and both
   * because restarting a single timer would otherwise strand a card. A page that wanted two cards fading
   * at once would put the timer on the CARD, where one instance is one card.
   *
   * That this demo needs a timer at all is still the cost it exists to show. What it no longer shows is
   * an app keeping an id in step with its own teardown.
   */
  private removal = this.use(Timeout, () => ({ run: this.dropLeaving }));

  /**
   * What the timer runs, declared with it rather than written at the call site.
   *
   * It reads `this.leaving` when it FIRES, which is why the id has to be in state — and it is, because
   * the class on the card is driven by the same field. Nothing is captured, so there is no question of
   * whether this sees the card that was clicked or the one that is current: it sees the one that is
   * marked, which is the one fading.
   */
  private dropLeaving() {
    const id = this.leaving;
    if (id === null) return;
    this.leaving = null;
    this.drop(id);
  }

  removeAfterClass(id: number) {
    const pending = this.leaving;

    // Clicking the SAME fading card again does nothing. Restarting its own timer would leave it fully
    // faded and still clickable for up to six seconds — found by review, which is also where the first
    // version of this comment was found claiming otherwise.
    if (pending === id) {
      this.readout = `card ${id} is already fading — the click changes nothing`;
      return;
    }

    // A DIFFERENT card, while one is still fading: finish the first rather than strand it. One hook
    // instance is one timer, so restarting it would leave that card in the list and no longer marked.
    // The raw timer this replaced armed one per click, so both went.
    if (pending !== null) this.drop(pending);

    this.leaving = id;
    this.readout =
      pending !== null
        ? `card ${pending} was still fading, so it went at once — one timer, one card at a time`
        : "marked `.leaving`, removing in 3s — a timer the app has to keep in step with the CSS";
    this.removal.start(3000);
  }

  /**
   * 4. The same, through the hook — which is where this belongs.
   *
   * `ViewTransition` owns the whole dance: it starts the transition, applies the change inside it, and
   * settles on its own `@updated` rather than on a guessed number of microtask turns. Nothing about it
   * needs to be in the framework, and a utility library would ship exactly this.
   */
  transition = this.use(ViewTransition);

  removeWithUpdated(id: number) {
    void this.transition
      .run(() => this.drop(id))
      .then(() => {
        this.readout = this.cards.every((card) => card.id !== id)
          ? "the hook settled on `@updated` — the commit was inside the transition, and nothing was guessed"
          : "the hook's deadline fired instead, so this change scheduled no render";
      });
  }

  /** 3. The browser snapshots the frame; the removal happens inside. */
  removeInTransition(id: number) {
    const start = (document as Document & { startViewTransition?: unknown }).startViewTransition;
    if (typeof start !== "function") {
      this.readout = "this browser has no `document.startViewTransition`";
      return;
    }

    const transition = (start as (cb: () => Promise<void> | void) => { updateCallbackDone: Promise<void> }).call(
      document,
      async () => {
        this.drop(id);
        // Ramonda batches a render on a microtask. Awaiting turns here is what gives the commit a chance
        // to land INSIDE the callback, which is what the browser is waiting for.
        for (let turn = 0; turn < 5; turn++) await Promise.resolve();
      },
    );

    void transition.updateCallbackDone.then(() => {
      this.readout = this.cards.every((card) => card.id !== id)
        ? "the commit landed inside the callback — the snapshot animates out, and the framework changed nothing"
        : "the callback finished before the commit did — the framework would have to hand out a flush";
    });
  }

  /**
   * One stable handler per card, per kind.
   *
   * An inline arrow in the row would be a fresh function every render, which is what `RMD020` reports and
   * what makes a row rebuild. `@memoized` caches by the argument, per member, per instance — and
   * three per-item handlers keyed by the same id is exactly the shape that found the cache-key bug this
   * page was written to demonstrate something else entirely.
   */
  @memoized
  removeNowFor(id: number) {
    return () => this.removeNow(id);
  }

  @memoized
  removeAfterClassFor(id: number) {
    return () => this.removeAfterClass(id);
  }

  @memoized
  removeInTransitionFor(id: number) {
    return () => this.removeInTransition(id);
  }

  @memoized
  removeWithUpdatedFor(id: number) {
    return () => this.removeWithUpdated(id);
  }

  render() {
    return (
      <section className="page">
        <h1>An exit that is interrupted</h1>
        <p>
          Every card fades, slides and reddens over three seconds on <code>.leaving</code>. Remove one three different
          ways and watch which of them you actually see.
        </p>

        <p>
          <button type="button" onclick={this.add}>
            add a card
          </button>{" "}
          <button type="button" onclick={this.clearLog}>
            clear the log
          </button>
        </p>

        <ul className="exit-list">
          {list(this.cards, (card) => (
            <ExitCard
              key={String(card.id)}
              card={card}
              leaving={this.leaving === card.id}
              onRemove={this.removeNowFor(card.id)}
              onRemoveAfterClass={this.removeAfterClassFor(card.id)}
              onRemoveInTransition={this.removeInTransitionFor(card.id)}
              onRemoveWithUpdated={this.removeWithUpdatedFor(card.id)}
              say={this.say}
            />
          ))}
        </ul>

        <p className="exit-readout">{this.readout}</p>

        <h2>Lifecycle</h2>
        <pre className="exit-log">{this.log.length === 0 ? "(nothing yet)" : this.log.join("\n")}</pre>
      </section>
    );
  }
}
