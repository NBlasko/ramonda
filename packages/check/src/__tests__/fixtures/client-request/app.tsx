import { Component, bootstrap, state } from "@ramonda/core";
import {
  created,
  deferHydration,
  interval,
  mounted,
  onWindow,
  requestContext,
  requestKey,
  updated,
} from "@ramonda/core";

/** Not exposed — the default, and what makes a browser read provably empty. */
const currentUser = requestKey<string>("currentUser");
/** Exposed on purpose. Whether the server SEEDED it is a runtime fact, so it is never reported. */
const publicRole = requestKey<string>("publicRole", { exposeToClient: true });
/** Written as `false`, which is a decided answer rather than an unknown one. */
const secret = requestKey<string>("secret", { exposeToClient: false });

declare function track(what: unknown): void;

/** ✗ A key that cannot travel, read from an effect-backed listener. */
export class ListenerRead extends Component {
  @onWindow("click")
  onClick() {
    track(requestContext().get(currentUser));
  }
  render() {
    return <button type="button">click</button>;
  }
}

/** A read narrowed to the server, inside a member that otherwise only the browser runs. */
export class GuardedInAListener extends Component {
  @onWindow("click")
  onClick() {
    if (typeof window === "undefined") track(requestContext().cookies.get("session"));
  }
  render() {
    return <button type="button">click</button>;
  }
}

/** ✗ Cookies, which are never sent to the browser whatever any key says. */
export class CookieInAnInterval extends Component {
  @interval("5s")
  poll() {
    track(requestContext().cookies.get("session"));
  }
  render() {
    return <p>poll</p>;
  }
}

/** ✗ `cookies.has` is the same question with a different answer type. */
export class CookieHasOnWindow extends Component {
  @onWindow("resize")
  onResize() {
    track(requestContext().cookies.has("session"));
  }
  render() {
    return <p>resize</p>;
  }
}

/** ✗ Headers, from `@updated` — which the commit skips for a server render. */
export class HeadersInUpdated extends Component {
  @updated
  afterCommit() {
    track(requestContext().headers.get("user-agent"));
  }
  render() {
    return <p>updated</p>;
  }
}

/** ✗ A lifecycle narrowed to the client by its own option. */
export class ClientOnlyCreated extends Component {
  @created({ env: "client" })
  init() {
    track(requestContext().get(currentUser));
  }
  render() {
    return <p>client created</p>;
  }
}

/** ✗ Hydration only ever happens in a browser. */
export class DeferredRead extends Component {
  @deferHydration
  wait() {
    return requestContext().get(currentUser) === undefined ? undefined : Promise.resolve();
  }
  render() {
    return <p>deferred</p>;
  }
}

/** ✗ A method reached ONLY from a JSX event attribute — 26C's measured shape. */
export class HandlerMethod extends Component {
  save() {
    track(requestContext().get(currentUser));
  }
  render() {
    return (
      <button type="button" onclick={this.save}>
        save
      </button>
    );
  }
}

/** ✗ An arrow written inside the attribute. `render` runs on both sides; this does not. */
export class InlineHandler extends Component {
  render() {
    return (
      <button type="button" onclick={() => track(requestContext().cookies.get("session"))}>
        inline
      </button>
    );
  }
}

/** ✗ A key declared `exposeToClient: false`, which is decided rather than unknown. */
export class ExplicitlyNotExposed extends Component {
  @onWindow("click")
  onClick() {
    track(requestContext().get(secret));
  }
  render() {
    return <button type="button">secret</button>;
  }
}

// ── everything below is CORRECT and must stay silent ─────────────────────────────────────────

/** `@created` defaults to `shared`, so this runs during the server render. The documented way. */
export class SharedCreated extends Component {
  @state user = "";
  @created()
  seed() {
    this.user = requestContext().get(currentUser);
  }
  render() {
    return <p>{this.user}</p>;
  }
}

/** A bare `@mounted` is `shared` too — no options is not the same as `{ env: "client" }`. */
export class SharedMounted extends Component {
  @mounted()
  measure() {
    track(requestContext().get(currentUser));
  }
  render() {
    return <p>mounted</p>;
  }
}

/** Explicitly server-only. */
export class ServerCreated extends Component {
  @created({ env: "server" })
  seed() {
    track(requestContext().get(currentUser));
  }
  render() {
    return <p>server</p>;
  }
}

/** An EXPOSED key. Whether the server seeded it is runtime, so nothing is claimed. */
export class ExposedKey extends Component {
  @onWindow("click")
  onClick() {
    track(requestContext().get(publicRole));
  }
  render() {
    return <button type="button">role</button>;
  }
}

/** `url` is read live from `location` in the browser and is always right. */
export class UrlInAHandler extends Component {
  @onWindow("popstate")
  onPop() {
    track(requestContext().url.pathname);
  }
  render() {
    return <p>url</p>;
  }
}

/** Read in `render()`, which runs on both sides. */
export class ReadInRender extends Component {
  render() {
    return <p>{requestContext().get(currentUser)}</p>;
  }
}

/**
 * A handler that is ALSO called from a shared lifecycle. One of its callers runs on the server, so
 * this rule says nothing — which is the difference between it and a guess about which caller wins.
 */
export class HandlerAlsoCalledOnTheServer extends Component {
  @created()
  seed() {
    this.refresh();
  }
  refresh() {
    track(requestContext().get(currentUser));
  }
  render() {
    return (
      <button type="button" onclick={this.refresh}>
        refresh
      </button>
    );
  }
}

/** A key this cannot resolve to a `requestKey` declaration. Unresolved is not the same as unexposed. */
declare const opaqueKey: ReturnType<typeof requestKey<string>>;
export class OpaqueKey extends Component {
  @onWindow("click")
  onClick() {
    track(requestContext().get(opaqueKey));
  }
  render() {
    return <button type="button">opaque</button>;
  }
}

export class App extends Component {
  render() {
    return (
      <main>
        <ListenerRead />
        <CookieInAnInterval />
        <CookieHasOnWindow />
        <HeadersInUpdated />
        <ClientOnlyCreated />
        <DeferredRead />
        <HandlerMethod />
        <InlineHandler />
        <ExplicitlyNotExposed />
        <SharedCreated />
        <SharedMounted />
        <ServerCreated />
        <ExposedKey />
        <UrlInAHandler />
        <ReadInRender />
        <HandlerAlsoCalledOnTheServer />
        <OpaqueKey />
      </main>
    );
  }
}

bootstrap(<App />, null);
