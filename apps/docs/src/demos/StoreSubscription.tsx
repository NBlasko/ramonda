import { Component, Host, createSubscriptionDecorator, mounted, state, updated } from "@ramonda/core";

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

  // Read AFTER the render, not in render(). render() is the build phase — it runs
  // before the child below is mounted or destroyed, so a count read there is always
  // one commit stale (it showed 1 while unmounted and 0 after remounting).
  //
  // @mounted for the first count, @updated for every one after it: @updated runs once
  // the commit is done, which is when the subscription has actually been made or
  // dropped. Writing state from it is safe here because the value converges — the
  // same count is not a change, so it schedules nothing.
  @mounted
  countOnMount() {
    this.listeners = likes.listenerCount;
  }

  @updated
  countAfterCommit() {
    this.listeners = likes.listenerCount;
  }

  like() {
    likes.increment();
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          <button type="button" onclick={this.like}>
            like
          </button>
          {this.mounted ? <LikeCount /> : <span className="demo-note">unmounted</span>}
          <button type="button" onclick={this.toggle}>
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
