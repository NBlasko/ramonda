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
  onMove(e: Event) {
    const m = e as MouseEvent;
    this.x = m.clientX;
    this.y = m.clientY;
  }
  @onDocument("keydown")
  onKey(e: Event) {
    this.lastKey = (e as KeyboardEvent).key;
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
