import { Component, Host, state, effect, createSubscriptionDecorator } from "@ramonda/core";

// An external store, standing in for Zustand or anything else that hands back an
// unsubscribe function.
function createStore(initial: number) {
  let value = initial;
  const listeners = new Set<(value: number) => void>();
  return {
    get value() {
      return value;
    },
    increment() {
      value += 1;
      for (const listener of [...listeners]) listener(value);
    },
    subscribe(listener: (value: number) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

const likes = createStore(0);

// createSubscriptionDecorator turns "subscribe to X, unsubscribe when the
// component goes away" into a decorator. Write the connect — subscribe, return
// the unsubscribe — and the framework owns the teardown.
//
// The one rule: connect must return a FUNCTION or nothing. A store that hands
// back an object (`{ unsubscribe }` is a common shape) is not a cleanup, so it
// would be dropped and the subscription would outlive the component. DEV throws
// on that rather than letting it leak — wrap it: `return () => sub.unsubscribe()`.
const onStore = createSubscriptionDecorator(
  "onStore",
  (_owner, handler: (value: number) => void, store: typeof likes) => store.subscribe(handler),
);

@Host("div")
class LikeCount extends Component {
  @state count = likes.value;

  @onStore(likes)
  storeChanged(value: number) {
    this.count = value;
  }

  render() {
    return <strong>{this.count}</strong>;
  }
}

@Host("div")
export class StoreSubscription extends Component {
  @state mounted = true;
  @state listeners = 0;

  toggle() {
    this.mounted = !this.mounted;
  }

  // Read in an @effect, not in render(). render() is the BUILD phase — it runs
  // before the child below is mounted or destroyed, so a count read there is
  // always one commit stale (it showed 1 while unmounted and 0 after remounting).
  // Effects run after the DOM is committed, which is when the subscription has
  // actually been made or dropped.
  //
  // Reading `this.mounted` is what makes this re-run; writing `this.listeners`
  // is safe because the effect never reads it back.
  @effect
  countListeners() {
    void this.mounted;
    this.listeners = likes.listenerCount;
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          <button type="button" onClick={() => likes.increment()}>
            like
          </button>
          {this.mounted ? <LikeCount /> : <span className="demo-note">unmounted</span>}
          <button type="button" onClick={this.toggle}>
            {this.mounted ? "unmount it" : "mount it"}
          </button>
        </p>
        <p className="demo-note">
          store listeners: {this.listeners} — unmounting the component removes its subscription, with nothing in the
          component to remember it
        </p>
      </div>
    );
  }
}
