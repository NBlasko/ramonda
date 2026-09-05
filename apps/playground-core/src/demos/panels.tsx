import {
  Component,
  Hook,
  state,
  persist,
  compute,
  created,
  mounted,
  destroyed,
  watchProp,
  onWindow,
  onDocument,
  interval,
  timeout,
} from "@ramonda/core";

/* ── Nested hooks: CounterHook uses HistoryHook (hook-of-a-hook) ────────── */
class HistoryHook extends Hook<{ value: number }> {
  @state history: number[] = [];

  // `@created` seeds the first value, `@watchProp` records every one after it. Two named halves
  // rather than one body whose reactivity would come from what it happened to read: each says when
  // it runs, and neither can start doing the other's job because a read moved.
  @created seed() {
    this.history = [this.props.value];
  }

  @watchProp((props) => props.value)
  track([next]: [number]) {
    this.history = [...this.history, next].slice(-5);
  }
}

class CounterHook extends Hook {
  @state count = 0;
  hist = this.use(HistoryHook, () => ({ value: this.count }));
  increment() {
    this.count++;
  }
  decrement() {
    this.count--;
  }
}

/* ── One panel per decorator/feature ───────────────────────────────────── */
export class Counter extends Component {
  counter = this.use(CounterHook);
  @persist createdAt = new Date().toLocaleTimeString();

  @compute get doubled() {
    return this.counter.count * 2;
  }

  render() {
    return (
      <div>
        <p className="label">@state · @compute · nested hooks (CounterHook → HistoryHook)</p>
        <div className="row">
          <button onclick={this.counter.decrement}>−</button>
          <strong className="big">{this.counter.count}</strong>
          <button onclick={this.counter.increment}>+</button>
          <span className="muted">doubled: {this.doubled}</span>
        </div>
        <p className="muted">history (last 5): {this.counter.hist.history.join(", ") || "—"}</p>
        <p className="muted small">@persist createdAt: {this.createdAt}</p>
      </div>
    );
  }
}

export class Clock extends Component {
  @state time = new Date().toLocaleTimeString();
  @interval(1000)
  tick() {
    this.time = new Date().toLocaleTimeString();
  }
  render() {
    return (
      <div>
        <p className="label">@interval</p>
        <strong className="big">{this.time}</strong>
      </div>
    );
  }
}

export class Inputs extends Component {
  @state x = 0;
  @state y = 0;
  @state lastKey = "—";

  @onWindow("mousemove")
  onMove(e: MouseEvent) {
    this.x = e.clientX;
    this.y = e.clientY;
  }
  @onDocument("keydown")
  onKey(e: KeyboardEvent) {
    this.lastKey = e.key;
  }

  render() {
    return (
      <div>
        <p className="label">@onWindow (mouse) · @onDocument (keys — press any key)</p>
        <p className="muted">
          mouse: {this.x}, {this.y} &nbsp;·&nbsp; last key: <kbd>{this.lastKey}</kbd>
        </p>
      </div>
    );
  }
}

/**
 * A listener written in the markup, on the element that emits the event.
 *
 * The handler's parameter is typed from the JSX attribute, so `onmousemove` hands it a
 * `MouseEvent` — `offsetX` and `offsetY` exist because of that and not because anyone cast.
 */
export class HoverCard extends Component {
  @state hovered = false;
  @state at = "";

  onEnter() {
    this.hovered = true;
  }

  // Typed from the name — `offsetX`/`offsetY` exist because this is a MouseEvent.
  onMove(e: MouseEvent) {
    this.at = `${Math.round(e.offsetX)},${Math.round(e.offsetY)}`;
  }

  onLeave() {
    this.hovered = false;
    this.at = "";
  }

  render() {
    return (
      <div
        className={`hovercard ${this.hovered ? "on" : ""}`}
        onmouseenter={this.onEnter}
        onmousemove={this.onMove}
        onmouseleave={this.onLeave}
      >
        <div>
          <p className="label">a reactive className, and listeners in the markup (hover me)</p>
          <strong>{this.hovered ? `✨ hovered @ ${this.at}` : "hover this card"}</strong>
        </div>
      </div>
    );
  }
}

// TODO shvatio sam da nemam setovan autofix i default formatiranje koda ovde
interface DerivedSyncProps {
  source: number;
}

export class DerivedSync extends Component<DerivedSyncProps> {
  @state doubled = 0;

  @created seed() {
    this.doubled = this.props.source * 2;
  }

  @watchProp((p) => p.source) onSource([next]: [number]) {
    this.doubled = next * 2;
  }

  render() {
    return (
      <div>
        <p className="label">@watchProp · @created (seed)</p>
        <p className="muted">
          source prop: <strong>{this.props.source}</strong> → synced doubled: <strong>{this.doubled}</strong>
        </p>
      </div>
    );
  }
}

export class Toast extends Component<{ message: string }> {
  @state visible = true;

  @timeout(3000) hide() {
    this.visible = false;
  }

  @destroyed cleanup() {
    console.log("🌸 Toast destroyed — cleanup ran");
  }
  render() {
    return this.visible ? (
      <div className="toast">{this.props.message} (auto-hides in 3s)</div>
    ) : (
      <span className="muted small">toast dismissed</span>
    );
  }
}

export class LifecycleDemo extends Component {
  @created init() {
    console.log("🌸 LifecycleDemo · @created");
  }
  @mounted ready() {
    console.log("🌸 LifecycleDemo · @mounted");
  }
  @destroyed dispose() {
    console.log("🌸 LifecycleDemo · @destroyed");
  }
  render() {
    return (
      <div>
        <p className="label">@created · @mounted · @destroyed (see console; leave the page to fire @destroyed)</p>
        <strong>I am alive.</strong>
      </div>
    );
  }
}

/**
 * A style block: real CSS beside the markup, compiled before the build.
 *
 * The three things it does that a `className` cannot are all here. **The static declarations become
 * one class in the stylesheet** — however many of these are on the page, and however many pages —
 * because the class name is the hash of the block. **Each `{{ … }}` becomes a CSS custom property on
 * this element**, so a value that differs per instance costs a property rather than a rule. And the
 * whole thing is checked: a property that does not exist, and a value the property does not take,
 * are build errors with the same *did you mean* TypeScript gives any other typo.
 *
 * The nested `&:hover` is CSS's own nesting, resolved by the browser rather than by us.
 *
 * **Written as a value in braces**, which is what to reach for whenever a tag has other props: an
 * editor stops consulting syntax injections once it enters a tag's attribute list, so a bare
 * `css=@@( … )` is only coloured as the FIRST attribute on the tag name's own line. In expression
 * position there is no such limit, and nothing else about the block changes.
 */
export class StyleBlock extends Component {
  @state weight = 4;

  thicker() {
    this.weight = this.weight === 12 ? 2 : this.weight + 2;
  }

  render() {
    return (
      <div className="panel" css={@@(
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 4px 0;
        border-left: {{`${this.weight}px`}} solid #ff0055;
        padding-left: {{`${this.weight + 8}px`}};
        transition: border-left-width 150ms ease-in-out, padding-left 150ms ease-in-out;
        &:hover {
          border-left-color: #00b37e;
        }
      )}>
        <p className="label">one class, one custom property per hole</p>
        <button onclick={this.thicker}>border {this.weight}px — thicker</button>
      </div>
    );
  }
}

/**
 * A block with as much nesting as real CSS actually has.
 *
 * The one above is the shape of the feature; this one is what a component's styles look like when
 * they stop being three declarations. Everything here is CSS's own nesting, resolved by the browser
 * — the compiler writes the block through verbatim and adds nothing of its own.
 *
 * **Three levels is where natural CSS stops.** A card, a state on the card, and one element inside
 * it in that state — `&:hover { & .title { … } }` — is as deep as this gets before it is describing
 * the markup rather than styling it. Nesting further is possible and is a smell either way.
 *
 * **An at-rule nests too, in both directions.** `@media` inside a rule and a rule inside a `@media`
 * both compile, which is what lets a hover style and its reduced-motion answer sit beside each other
 * instead of in two places.
 *
 * **The hole is still one value.** `{{ … }}` is a custom property, so it works the same inside a
 * nested rule as at the top — the property is set on the ELEMENT and the nested rule reads it, which
 * is why one value can drive a colour that only appears on hover.
 */
export class StyleBlockNested extends Component {
  @state urgent = false;

  toggle() {
    this.urgent = !this.urgent;
  }

  render() {
    const accent = this.urgent ? "#ff0055" : "#10b981";

    return (
      <div className="panel" data-urgent={String(this.urgent)} css={@@(
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 4px 12px;
        align-items: center;
        padding: 12px;
        border: 1px solid #2a2a2a;
        border-radius: 8px;
        border-left: 4px solid {{accent}};
        transition: border-color 150ms ease-in-out, transform 150ms ease-in-out;

        & .title {
          font-weight: 600;
          color: #e6e6e6;
        }

        & .body {
          grid-column: 2;
          color: #9a9a9a;
        }

        &::after {
          content: "";
          grid-row: 1;
          grid-column: 1;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: {{accent}};
        }

        &[data-urgent="true"] {
          border-color: {{accent}};

          & .title {
            color: {{accent}};
          }
        }

        &:hover, &:focus-within {
          transform: translateY(-1px);

          & .title {
            text-decoration: underline;
          }
        }

        @media (min-width: 40rem) {
          padding: 16px 20px;
          gap: 6px 16px;
        }

        @media (prefers-reduced-motion: reduce) {
          transition: none;

          &:hover, &:focus-within {
            transform: none;
          }
        }
      )}>
        <p className="title" style="grid-column: 2">
          Deploy finished
        </p>
        <p className="body small">Three levels of nesting, one class, one custom property.</p>
        <button onclick={this.toggle} style="grid-column: 2; justify-self: start">
          {this.urgent ? "urgent" : "normal"} — toggle
        </button>
      </div>
    );
  }
}
