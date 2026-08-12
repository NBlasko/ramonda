import { Component, Host, list, memoizedHandler, state } from "@ramonda/core";
import { Query, QueryClientProvider, type FetchContext } from "@ramonda/query";

interface Profile {
  name: string;
  followers: number;
}

// Static data, so this may live at module scope. The request COUNTER may not —
// see `requests` below.
/** Module scope, so `each` is the SAME array every render — a fresh literal would be a new value
 *  each time and cost the list the identity it mints from its items. */
const USERS = ["ada", "grace", "alan"];

const PEOPLE: Record<string, Profile> = {
  ada: { name: "Ada Lovelace", followers: 1843 },
  grace: { name: "Grace Hopper", followers: 1906 },
  alan: { name: "Alan Turing", followers: 1912 },
};

function getProfile(id: string, { signal }: FetchContext): Promise<Profile> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(PEOPLE[id]), 400);
    // Forwarding the signal is not decoration: switching person mid-flight
    // abandons the previous request, and without this the response still arrives
    // and still costs the network.
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

interface CardProps {
  id: string;
  onRequest: () => void;
}

// One observer. `staleTime` is what makes going back to a person instant: within
// 10 seconds the cache answers and no request is made.
@Host("div")
class ProfileCard extends Component<CardProps> {
  /**
   * A bound method rather than a closure: an inline `fetch` would be a fresh function every
   * time the callback runs — every time this card's `id` moves — and RMD022 would say so once
   * it had happened a few times running. `load` reads `this.props` when it is CALLED, so there
   * is nothing to capture.
   *
   * The key needs nothing — `Query` declares it in `static StableProps`, so the framework
   * keeps one array identity while the parts are equal.
   */
  load(ctx: FetchContext) {
    this.props.onRequest();
    return getProfile(this.props.id, ctx);
  }

  private profile = this.use(Query, (self: ProfileCard) => ({
    key: ["profile", self.props.id],
    fetch: self.load,
    staleTime: 10_000,
  }));

  render() {
    if (this.profile.isPending) {
      return <p className="demo-note">loading {this.props.id}…</p>;
    }
    return (
      <p className="demo-row">
        <strong>{this.profile.data?.name}</strong>
        <span className="demo-note">{this.profile.data?.followers} followers</span>
        {this.profile.isFetching ? <span className="demo-note">refreshing…</span> : null}
      </p>
    );
  }
}

@Host("div")
export class QueryDemo extends Component {
  // The cache belongs to this tree. There is no global client to import — query
  // data is per-request state, and a module is shared by every request a server
  // handles at once.
  private query = this.use(QueryClientProvider);

  @state id = "ada";
  @state twice = false;

  /**
   * `@state`, not a module-level counter, and this page is served prerendered so
   * the difference is visible: the server fetches the profile once, so its HTML
   * says 1 — and `@state` travels in the hydration blob, so the client starts
   * from 1 too. A module counter would have reset to 0 in the browser, disagreed
   * with the served markup, and been reported as RMD007.
   */
  @state requests = 0;

  // Cached by its argument: the same button keeps the same handler across renders.
  renderChoice(id: string) {
    return (
      <button type="button" disabled={this.id === id} onClick={this.select(id)}>
        {id}
      </button>
    );
  }

  @memoizedHandler
  select(id: string) {
    return () => {
      this.id = id;
    };
  }

  toggleSecond() {
    this.twice = !this.twice;
  }

  countRequest() {
    this.requests = this.requests + 1;
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          {list(USERS, this.renderChoice)}
          <button type="button" onClick={this.toggleSecond}>
            {this.twice ? "one card" : "two cards"}
          </button>
        </p>

        <ProfileCard id={this.id} onRequest={this.countRequest} />
        {/* Two observers of the SAME key share one request — the counter below
            does not move when this appears. */}
        {this.twice ? <ProfileCard id={this.id} onRequest={this.countRequest} /> : null}

        <p className="demo-note">
          requests made: <strong>{String(this.requests)}</strong> — switch back to someone you already viewed and it
          stays put
        </p>
      </div>
    );
  }
}
