import { Component, bootstrap, state } from "@ramonda/core";
import { requestContext, requestKey } from "@ramonda/core";
import { OwnHelper } from "./own-helper";
import { requestContext as reExported } from "./re-export";

const currentUser = requestKey<string>("currentUser");

declare function fetchPosts(): Promise<string[]>;

/** ✗ The plain case: the read is under the await, so the request is already gone. */
class LateDirect extends Component {
  @state posts: string[] = [];
  async load() {
    this.posts = await fetchPosts();
    const user = requestContext().get(currentUser);
    console.log(user);
  }
  render() {
    return <p>late</p>;
  }
}

/** ✗ Taken in time, used too late. The object is a door, not a copy. */
class LateThroughLocal extends Component {
  async load() {
    const context = requestContext();
    await fetchPosts();
    console.log(context.headers.get("accept-language"));
  }
  render() {
    return <p>held</p>;
  }
}

/** ✗ `for await` yields on every step and is not an AwaitExpression. */
class LateAfterForAwait extends Component {
  async load(pages: AsyncIterable<string>) {
    for await (const page of pages) console.log(page);
    console.log(requestContext().url.pathname);
  }
  render() {
    return <p>stream</p>;
  }
}

/** ✗ A field holding an async arrow is the same body by another spelling. */
class LateInField extends Component {
  load = async () => {
    await fetchPosts();
    return requestContext().cookies.get("session");
  };
  render() {
    return <p>field</p>;
  }
}

/** ✗ The same function reached through an app's own module. */
class LateThroughAReExport extends Component {
  async load() {
    await fetchPosts();
    console.log(reExported().headers.get("accept-language"));
  }
  render() {
    return <p>re-export</p>;
  }
}

/** ✗ The held door, opened by destructuring and by a bracket rather than by a dot. */
class LateOtherSpellings extends Component {
  async load() {
    const context = requestContext();
    await fetchPosts();
    const { headers } = context;
    const cookies = context["cookies"];
    console.log(headers, cookies);
  }
  render() {
    return <p>spellings</p>;
  }
}

/** ✓ Above the await — correct, common, and the form a bad rule would punish. */
class EarlyThenFetches extends Component {
  @state user = "";
  async load() {
    this.user = requestContext().get(currentUser);
    this.posts = await fetchPosts();
  }
  render() {
    return <p>{this.user}</p>;
  }
}

/** ✓ No await anywhere: a synchronous method cannot be late. */
class Synchronous extends Component {
  render() {
    return <p>{requestContext().get(currentUser)}</p>;
  }
}

/** ✓ A nested callback is its own timeline — whether it runs before or after is dataflow. */
class NestedCallback extends Component {
  async load(names: string[]) {
    await fetchPosts();
    names.map(() => requestContext().get(currentUser));
  }
  render() {
    return <p>nested</p>;
  }
}

/**
 * ✓ Reading INSIDE the await's own operand. `await requestContext().get(key)` evaluates the read
 * first and suspends on what it returned, so the request is still installed — this is correct code
 * and the walk must descend into an await before it raises its flag.
 */
class ReadsInsideTheAwait extends Component {
  @state user = "";
  async load() {
    this.user = await requestContext().get(currentUser);
  }
  render() {
    return <p>{this.user}</p>;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <LateDirect />
        <LateThroughLocal />
        <LateAfterForAwait />
        <LateInField />
        <EarlyThenFetches />
        <Synchronous />
        <NestedCallback />
        <ReadsInsideTheAwait />
        <BothBelowReportsOnce />
        <OwnHelper />
      </div>
    );
  }
}

bootstrap(<App />, null);

/**
 * ✗ ONCE, not twice. Both the take and the use are below the await, and the take is the failure —
 * it throws on its own line, so the line under it never runs. Following the local here would put a
 * second report on dead code and send the reader to the wrong line of the two.
 */
class BothBelowReportsOnce extends Component {
  async load() {
    await fetchPosts();
    const context = requestContext();
    console.log(context.headers.get("x"));
  }
  render() {
    return <p>once</p>;
  }
}
