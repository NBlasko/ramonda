import { Component, bootstrap, created, requestContext, requestKey, state } from "@ramonda/core";

const currentUser = requestKey<string>("currentUser");
declare function fetchPosts(): Promise<string[]>;
declare function track(what: unknown): void;

/** ✗ Below the await, inside a `try`. The request is gone whichever block it is in. */
class LateInATry extends Component {
  @created()
  async load() {
    try {
      await fetchPosts();
      track(requestContext().get(currentUser));
    } catch {
      track("no");
    }
  }
  render() {
    return null;
  }
}

/** ✗ In a `finally`, which is exactly where a late read hides. */
class LateInAFinally extends Component {
  @created()
  async load() {
    try {
      await fetchPosts();
    } finally {
      track(requestContext().get(currentUser));
    }
  }
  render() {
    return null;
  }
}

/** ✗ A loop body: the second turn is always below the first await. */
class LateInALoop extends Component {
  @created()
  async load() {
    for (const page of [1, 2]) {
      await fetchPosts();
      track(requestContext().get(currentUser));
      track(page);
    }
  }
  render() {
    return null;
  }
}

/** ✗ The request taken onto a FIELD before the await, and used after it. */
class LateThroughAField extends Component {
  ctx = requestContext();
  @created()
  async load() {
    await fetchPosts();
    track(this.ctx.get(currentUser));
  }
  render() {
    return null;
  }
}

/** ✓ The await is inside a NESTED function, so this body never yielded. */
class AwaitsInsideACallback extends Component {
  @created()
  load() {
    void (async () => {
      await fetchPosts();
    })();
    track(requestContext().get(currentUser));
  }
  render() {
    return null;
  }
}

/** ✓ Destructured BEFORE the await: the getter already ran, and the value is in hand. */
class TakenBeforeTheAwait extends Component {
  @state name = "";
  @created()
  async load() {
    const { headers } = requestContext();
    await fetchPosts();
    this.name = headers.get("user-agent") ?? "";
  }
  render() {
    return null;
  }
}

/** ✓ A property taken into a local before the await, read after it. */
class PropertyHeldEarly extends Component {
  @state name = "";
  @created()
  async load() {
    const who = requestContext().get(currentUser);
    await fetchPosts();
    this.name = who ?? "";
  }
  render() {
    return null;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <LateInATry />
        <LateInAFinally />
        <LateInALoop />
        <LateThroughAField />
        <AwaitsInsideACallback />
        <TakenBeforeTheAwait />
        <PropertyHeldEarly />
      </div>
    );
  }
}

bootstrap(<App />, null);
