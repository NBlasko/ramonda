import { Component, list, memoizedHandler, mounted, state } from "@ramonda/core";
import { type Card, ExitCard } from "../demos/ExitCard";

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
    this.cards = this.cards.filter((card) => card.id !== id);
  }

  /** 1. What an app does today. */
  removeNow(id: number) {
    this.readout = "removed straight away — the node is gone before the transition can start";
    this.drop(id);
  }

  /** 2. The workaround: mark it, wait for the stylesheet's duration, then remove. */
  removeAfterClass(id: number) {
    this.leaving = id;
    this.readout = "marked `.leaving`, removing in 3s — a timer the app has to keep in step with the CSS";
    window.setTimeout(() => {
      this.leaving = null;
      this.drop(id);
    }, 3000);
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
   * what makes a row rebuild. `@memoizedHandler` caches by the argument, per member, per instance — and
   * three per-item handlers keyed by the same id is exactly the shape that found the cache-key bug this
   * page was written to demonstrate something else entirely.
   */
  @memoizedHandler
  removeNowFor(id: number) {
    return () => this.removeNow(id);
  }

  @memoizedHandler
  removeAfterClassFor(id: number) {
    return () => this.removeAfterClass(id);
  }

  @memoizedHandler
  removeInTransitionFor(id: number) {
    return () => this.removeInTransition(id);
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
          <button type="button" onClick={this.add}>
            add a card
          </button>{" "}
          <button type="button" onClick={this.clearLog}>
            clear the log
          </button>
        </p>

        <ul className="exit-list">
          {list(this.cards, (card) => (
            <ExitCard
              card={card}
              leaving={this.leaving === card.id}
              onRemove={this.removeNowFor(card.id)}
              onRemoveAfterClass={this.removeAfterClassFor(card.id)}
              onRemoveInTransition={this.removeInTransitionFor(card.id)}
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
