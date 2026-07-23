import {
  Component,
  Hook,
  state,
  persist,
  compute,
  effect,
  create,
  mount,
  destroy,
  watchProp,
  onWindow,
  onDocument,
  onElement,
  interval,
  timeout,
  Host,
} from "@ramonda/core";

/* ── Nested hooks: CounterHook uses HistoryHook (hook-of-a-hook) ────────── */
class HistoryHook extends Hook<{ value: number }> {
  @state history: number[] = [];
  @effect track() {
    const v = this.options.value;
    this.history = [...this.history, v].slice(-5);
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
          <button onClick={this.counter.decrement}>−</button>
          <strong className="big">{this.counter.count}</strong>
          <button onClick={this.counter.increment}>+</button>
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
 * The event decorators are typed from the DOM's own maps, so the NAME decides
 * the handler's parameter: `@onElement("mousemove") (e: MouseEvent)` checks,
 * `(e: KeyboardEvent)` does not compile. Unknown names — custom events — still
 * pass and arrive as `Event`.
 *
 * A handler may also declare a supertype: "click" is a `PointerEvent`, and a
 * handler taking `MouseEvent` accepts it.
 */
@Host("div", (self: HoverCard) => ({
  className: `hovercard ${self.hovered ? "on" : ""}`,
}))
export class HoverCard extends Component {
  @state hovered = false;
  @state at = "";

  @onElement("mouseenter") onEnter() {
    this.hovered = true;
  }

  // Typed from the name — `offsetX`/`offsetY` exist because this is a MouseEvent.
  @onElement("mousemove") onMove(e: MouseEvent) {
    this.at = `${Math.round(e.offsetX)},${Math.round(e.offsetY)}`;
  }

  @onElement("mouseleave") onLeave() {
    this.hovered = false;
    this.at = "";
  }

  render() {
    return (
      <div>
        <p className="label">@Host (reactive className) · @onElement (hover me)</p>
        <strong>{this.hovered ? `✨ hovered @ ${this.at}` : "hover this card"}</strong>
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

  @create seed() {
    this.doubled = this.props.source * 2;
  }

  @watchProp((p: DerivedSyncProps) => p.source) onSource(next: number) {
    this.doubled = next * 2;
  }

  render() {
    return (
      <div>
        <p className="label">@watchProp · @create (seed)</p>
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

  @destroy cleanup() {
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
  @create init() {
    console.log("🌸 LifecycleDemo · @create");
  }
  @mount ready() {
    console.log("🌸 LifecycleDemo · @mount");
  }
  @destroy dispose() {
    console.log("🌸 LifecycleDemo · @destroy");
  }
  render() {
    return (
      <div>
        <p className="label">@create · @mount · @destroy (see console; leave the page to fire @destroy)</p>
        <strong>I am alive.</strong>
      </div>
    );
  }
}
