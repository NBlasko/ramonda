import { Component, list, memoized, state } from "@ramonda/core";
import { Link } from "../routes";
import { Mutation, Query, QueryClientAccess, type FetchContext, type QueryEntry } from "@ramonda/query";

/** Module scope, so `each` is the same array every render — a fresh literal would be a new value
 *  each time and cost the list the identity it mints from its items. */
const PEOPLE_IDS = ["ada", "grace", "alan"];

/* ── A stand-in for a server ────────────────────────────────────────────── */

interface Profile {
  name: string;
  followers: number;
}

const PEOPLE: Record<string, Profile> = {
  ada: { name: "Ada Lovelace", followers: 1843 },
  grace: { name: "Grace Hopper", followers: 1906 },
  alan: { name: "Alan Turing", followers: 1912 },
};

/** Every call, so the page can show what the cache saved. Reset by the buttons. */
const log: string[] = [];
function note(line: string): void {
  log.unshift(`${new Date().toISOString().slice(14, 22)} ${line}`);
  log.length = Math.min(log.length, 12);
}

function getProfile(id: string, { signal }: FetchContext, delay = 700): Promise<Profile> {
  note(`GET /profile/${id}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      note(`  ← 200 /profile/${id}`);
      resolve(PEOPLE[id]);
    }, delay);

    // Forwarding the signal is the whole reason an abandoned request stops
    // costing the network. Switch person mid-flight and watch the log.
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      note(`  ✕ aborted /profile/${id}`);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

let failuresLeft = 0;
function getFlaky(): Promise<string> {
  note(`GET /flaky (${failuresLeft} failures left)`);
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (failuresLeft > 0) {
        failuresLeft--;
        note("  ← 503 /flaky");
        reject(new Error("503 service unavailable"));
        return;
      }
      note("  ← 200 /flaky");
      resolve(`ok at ${new Date().toISOString().slice(17, 23)}`);
    }, 300);
  });
}

let todos = ["read the docs"];
function loadTodos(): Promise<string[]> {
  note("GET /todos");
  return new Promise((resolve) => setTimeout(() => resolve([...todos]), 400));
}
function createTodo(title: string): Promise<string> {
  note(`POST /todos "${title}"`);
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (todos.includes(title)) {
        note("  ← 409 conflict");
        reject(new Error(`"${title}" is already there`));
        return;
      }
      todos = [...todos, title];
      note("  ← 201 created");
      resolve(title);
    }, 600);
  });
}

/* ── 1. Cache, dedup, and a key that moves ──────────────────────────────── */

class ProfileCard extends Component<{ id: string; label: string }> {
  private profile = this.use(Query<Profile>, (self: ProfileCard) => ({
    key: ["profile", self.props.id],
    // A bound method, not a closure: a fresh function is a changed prop (RMD022) every time
    // the callback runs. `load` reads `this.props` when it is CALLED, so there is nothing to
    // capture and the identity never moves.
    fetch: self.load,
    staleTime: 10_000,
  }));

  load(ctx: FetchContext) {
    return getProfile(this.props.id, ctx);
  }

  refresh() {
    void this.profile.refetch();
  }

  render() {
    const p = this.profile;
    return (
      <div className="panel">
        <p className="label">{this.props.label}</p>
        {p.isPending ? (
          <p className="muted">loading {this.props.id}…</p>
        ) : (
          <p>
            <strong>{p.data?.name}</strong>
            <span className="muted small">
              {" "}
              · {p.data?.followers} followers{p.isFetching ? " · refreshing…" : ""}
            </span>
          </p>
        )}
        <p className="muted small">
          status <code>{p.status}</code> · fetch <code>{p.fetchStatus}</code>
          {p.isRestored ? " · from the server" : ""}
        </p>
        <button onclick={this.refresh}>refetch (ignores staleTime)</button>
      </div>
    );
  }
}

/* ── 2. Failure, retry, and data that survives it ───────────────────────── */

class FlakyCard extends Component {
  // Nothing in this bag depends on props or state, and the callback costs nothing for saying so:
  // one that reads no signal is called once, at mount, so `fetch` and `retryDelay` keep the identity
  // they were built with. Rebuilding — the churn RMD022 reports — needs a signal to read.
  private flaky = this.use(Query<string>, () => ({
    key: ["flaky"],
    fetch: () => getFlaky(),
    staleTime: 30_000,
    retry: 2,
    // Short, so the backoff is watchable rather than a wait.
    retryDelay: (failureCount) => failureCount * 400,
  }));

  @memoized
  arm(count: number) {
    return () => {
      failuresLeft = count;
      void this.flaky.refetch();
    };
  }

  render() {
    const q = this.flaky;
    return (
      <div className="panel">
        <p className="label">retry + backoff</p>
        <p>
          {q.data ? <strong>{q.data}</strong> : <span className="muted">no data yet</span>}
          {q.isFetching ? <span className="muted small"> · fetching…</span> : null}
        </p>
        {q.isError ? (
          <p className="muted small">
            error: {(q.error as Error).message} — and the last good value above is still there, because a failed refresh
            does not make it wrong, only unconfirmed
          </p>
        ) : null}
        <p className="muted small">
          failures so far: <strong>{String(q.failureCount)}</strong>
        </p>
        <div className="row">
          <button onclick={this.arm(1)}>fail once, then recover</button>
          <button onclick={this.arm(9)}>fail past the retry limit</button>
        </div>
      </div>
    );
  }
}

/* ── 3. A mutation, optimistically ──────────────────────────────────────── */

class TodoPanel extends Component {
  @state draft = "";

  private list = this.use(Query<string[]>, () => ({
    key: ["todos"],
    fetch: () => loadTodos(),
    staleTime: 30_000,
  }));

  private add = this.use(Mutation<string, string>, () => ({
    mutate: (title) => createTodo(title),
    // What this returns IS the rollback — the same contract `createSubscriptionDecorator`
    // uses — and it runs only if the write fails.
    onMutate: (title, { client }) => {
      const previous = client.peek<string[]>(["todos"])?.data;
      client.setData<string[]>(["todos"], (list) => [...(list ?? []), `${title} (saving…)`]);
      return () => client.setData<string[]>(["todos"], previous ?? []);
    },
    invalidates: [["todos"]],
  }));

  typed(event: Event) {
    this.draft = (event.target as HTMLInputElement).value;
  }

  submit() {
    const title = this.draft.trim();
    if (!title) return;
    this.draft = "";
    // Never rejects: the failure is this.add.error, so a click handler does not
    // have to catch.
    this.add.mutate(title);
  }

  renderTodo(title: string) {
    return <li>{title}</li>;
  }

  render() {
    return (
      <div className="panel">
        <p className="label">optimistic write + rollback</p>
        {/* `each` takes null/undefined, so there is no `?? []` rebuilt every render. */}
        <ul>{list(this.list.data, this.renderTodo)}</ul>
        <div className="row">
          <input value={this.draft} aria-label="New todo" placeholder="new todo" oninput={this.typed} />
          <button disabled={this.add.isPending} onclick={this.submit}>
            {this.add.isPending ? "saving…" : "add"}
          </button>
        </div>
        <p className="muted small">
          {this.add.isError
            ? `rejected: ${(this.add.error as Error).message} — the optimistic row is gone again`
            : 'add "read the docs" twice to see the rollback'}
        </p>
      </div>
    );
  }
}

/* ── The page ───────────────────────────────────────────────────────────── */

export class QueryPage extends Component {
  private queries = this.use(QueryClientAccess);

  @state id = "ada";
  @state second = false;
  @state pollMs = 0;
  /**
   * Bumped to schedule a render after the log is emptied.
   *
   * A counter, because assigning a field its own value would not do it: `State`
   * compares with `!==` and returns early when nothing moved, so a "write" of the
   * same value schedules no render at all. The log itself lives at module scope —
   * it belongs to the fake server, not to this page.
   */
  @state logCleared = 0;

  renderPerson(id: string) {
    return (
      <button disabled={this.id === id} onclick={this.select(id)}>
        {id}
      </button>
    );
  }

  @memoized
  select(id: string) {
    return () => {
      this.id = id;
    };
  }

  toggleSecond() {
    this.second = !this.second;
  }

  togglePolling() {
    this.pollMs = this.pollMs ? 0 : 2000;
  }

  invalidateProfiles() {
    this.queries.client.invalidate(["profile"]);
  }

  clearLog() {
    log.length = 0;
    this.logCleared = this.logCleared + 1;
  }

  signOut() {
    // What `remove` is for. Marking stale would not do: stale data is still
    // shown while it refreshes, and the next visitor to this tab must not see
    // the last one's. Live observers are told, so they start over.
    this.queries.client.remove();
    note("client.remove() — cache dropped");
  }

  renderCacheRow(entry: QueryEntry) {
    return (
      <tr>
        <td>
          <code>{JSON.stringify(entry.key)}</code>
        </td>
        <td>{entry.status}</td>
        <td>{entry.fetchStatus}</td>
        <td>{String(entry.observers.size)}</td>
        <td className="muted small">{entry.updatedAt ? new Date(entry.updatedAt).toISOString().slice(14, 22) : "—"}</td>
      </tr>
    );
  }

  render() {
    const entries = this.queries.client.all();

    return (
      <div className="page">
        <h2>@ramonda/query</h2>
        <p className="muted">
          One request per key, cached, race-free. The provider is on the app root (<code>main.tsx</code>), so the cache
          belongs to this tree and reaches every page through context — there is no client to import from module scope.
        </p>

        <section className="slotcase">
          <div className="row">
            <h3>1 · cache, dedup, and a key that moves</h3>
            {list(PEOPLE_IDS, this.renderPerson)}
            <button onclick={this.toggleSecond}>{this.second ? "one observer" : "two observers"}</button>
          </div>
          <p className="muted small">
            Switch person and come back: within <code>staleTime</code> (10s) the cache answers and the log stays quiet.
            Add a second observer of the same key and there is still one request. Switch DURING a load and the previous
            request is aborted, not just ignored.
          </p>
          <div className="grid">
            <ProfileCard id={this.id} label="observer A" />
            {this.second ? <ProfileCard id={this.id} label="observer B (same key)" /> : null}
          </div>
        </section>

        <section className="slotcase">
          <h3>2 · failure, retry, and what stays on screen</h3>
          <div className="grid">
            <FlakyCard />
          </div>
        </section>

        <section className="slotcase">
          <h3>3 · a mutation</h3>
          <div className="grid">
            <TodoPanel />
          </div>
        </section>

        <section className="slotcase">
          <div className="row">
            <h3>4 · triggers</h3>
            <button onclick={this.togglePolling}>{this.pollMs ? "stop polling" : "poll every 2s"}</button>
            <button onclick={this.invalidateProfiles}>invalidate ["profile"]</button>
            <button onclick={this.signOut}>sign out (client.remove)</button>
          </div>
          <p className="muted small">
            Click away from this window and back: a STALE query refreshes on focus, a fresh one does not — so an alt-tab
            inside <code>staleTime</code> costs nothing. Polling ignores staleness, because an interval <em>is</em> the
            freshness policy.{" "}
            <Link href="/about" className="navlink">
              Navigate to About
            </Link>{" "}
            and come back: the page remounts, the cache still has the data (<code>gcTime</code> is 5 minutes), so it
            paints filled in.
          </p>
          {this.pollMs ? <PolledCard every={this.pollMs} /> : null}
        </section>

        <section className="slotcase">
          <div className="row">
            <h3>5 · the cache, as it is right now</h3>
            <button onclick={this.clearLog}>clear the log</button>
          </div>
          <table className="grid-table">
            <thead>
              <tr>
                <th>key</th>
                <th>status</th>
                <th>fetch</th>
                <th>observers</th>
                <th>updated</th>
              </tr>
            </thead>
            <tbody>{list(entries, this.renderCacheRow)}</tbody>
          </table>
          <p className="muted small">
            Rendered from <code>client.all()</code>, so it is one render behind whatever just happened — it is a
            snapshot, not a subscription.
          </p>

          <p className="label">request log</p>
          <pre className="muted small">{log.join("\n") || "—"}</pre>
        </section>

        <section className="slotcase">
          <h3>notes</h3>
          <ul className="muted small">
            <li>
              <code>Query</code> and <code>Mutation</code> are hooks, so they add no element — which is what lets a
              query live inside a <code>&lt;tr&gt;</code> or a <code>&lt;select&gt;</code>, where an extra node is
              illegal HTML.
            </li>
            <li>
              Keys are compared by value and their object properties are sorted before hashing, so{" "}
              <code>{'{ page: 1, tag: "a" }'}</code> and <code>{'{ tag: "a", page: 1 }'}</code> are one query. Building
              the array fresh on every render is expected.
            </li>
            <li>
              A key must be JSON-serializable — it is part of what crosses the wire during hydration. A function in one
              is reported as <code>RMQ001</code>, because <code>JSON.stringify</code> drops it and two different queries
              would then share one entry.
            </li>
            <li>
              <code>setData</code> abandons a fetch already in flight: an explicit write is newer information than a
              request made before it, so an optimistic update cannot be undone by a response that was already on its
              way.
            </li>
            <li>
              Every reaction here is named for what it does. The key change is a <code>@watchProp</code> (before the
              render, so the request is in flight while the loading state paints), the poll interval is a{" "}
              <code>@created</code> + <code>@watchProp</code> + <code>@destroyed</code> trio, and focus/reconnect are{" "}
              <code>@onWindow</code>.
            </li>
          </ul>
        </section>
      </div>
    );
  }
}

/** Mounted only while polling, so the interval's lifetime is visible. */
class PolledCard extends Component<{ every: number }> {
  private clock = this.use(Query<string>, (self: PolledCard) => ({
    key: ["clock"],
    fetch: self.tick,
    refetchInterval: self.props.every,
    staleTime: Number.POSITIVE_INFINITY,
  }));

  async tick(): Promise<string> {
    note("GET /clock");
    return new Date().toISOString().slice(17, 23);
  }

  render() {
    return (
      <p className="muted small">
        polled value: <strong>{this.clock.data ?? "…"}</strong> — <code>staleTime</code> is Infinity here, and it still
        refetches: polling is not a staleness check
      </p>
    );
  }
}
