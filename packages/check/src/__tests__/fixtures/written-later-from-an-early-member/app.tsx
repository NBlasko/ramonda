import { Component, compute, created, state } from "@ramonda/core";

/**
 * Fields written from the constructor, `@created` and `render()`. Each member's own writes are its time,
 * before or at the first render; a function written inside it — a handler, a timer's callback, a
 * listener — runs later, and its writes leave the `@compute` below stale.
 */
class Rated extends Component {
  @state tick = 1;
  /* REPORTED — written by a handler `render()` writes. */
  rate = 1;
  /* REPORTED — written by a timer `@created` starts. */
  speed = 1;
  /* REPORTED — written by a listener the constructor adds. */
  width = 0;
  /* Not reported: written by `render()` itself, the memo pattern. */
  seen = 0;
  /* Not reported: written by the constructor and `@created` themselves. */
  first = 0;

  constructor() {
    super();
    this.first = 1;
    window.addEventListener("resize", () => {
      this.width = window.innerWidth;
    });
  }

  @created start(): void {
    this.first = 2;
    setInterval(() => {
      this.speed++;
    }, 1000);
  }

  @compute get total(): number {
    return this.tick * this.rate * this.speed * this.width * this.seen * this.first;
  }

  render() {
    this.seen = 1;
    return (
      <button
        onclick={() => {
          this.rate = 3;
        }}
      >
        {this.total}
      </button>
    );
  }
}

export { Rated };
