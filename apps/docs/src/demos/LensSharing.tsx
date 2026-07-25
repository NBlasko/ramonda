import { Component, Host, state, list } from "@ramonda/core";
import { focusOn } from "@ramonda/lens";

// Structural sharing is invisible in the rendered output — every version of the
// state renders the same way. The only way to SEE it is to compare references,
// which is exactly what a consumer doing a shallow compare does. So that is what
// this demo shows: after each edit, which objects are new and which are the very
// same ones as before.

interface Post {
  id: number;
  title: string;
  tags: string[];
}

interface AppState {
  users: { id: number; name: string }[];
  posts: Post[];
}

const initial = (): AppState => ({
  users: [{ id: 1, name: "Nikola" }],
  posts: [
    { id: 101, title: "First post", tags: ["js", "web"] },
    { id: 102, title: "Second post", tags: ["ssr", "draft"] },
  ],
});

interface Row {
  path: string;
  fresh: boolean;
}

/** The paths worth watching, read off both versions at once. */
function compare(before: AppState, after: AppState): Row[] {
  return [
    { path: "state", fresh: before !== after },
    { path: "state.users", fresh: before.users !== after.users },
    { path: "state.posts", fresh: before.posts !== after.posts },
    { path: "state.posts[0]", fresh: before.posts[0] !== after.posts[0] },
    { path: "state.posts[1]", fresh: before.posts[1] !== after.posts[1] },
    {
      path: "state.posts[1].tags",
      fresh: before.posts[1].tags !== after.posts[1].tags,
    },
  ];
}

@Host("li")
class PathRow extends Component<{ item: Row }> {
  render() {
    const { path, fresh } = this.props.item;
    return (
      <span>
        <code>{path}</code>{" "}
        <strong className={fresh ? "lens-fresh" : "lens-shared"}>{fresh ? "new object" : "same object"}</strong>
      </span>
    );
  }
}

@Host("div")
export class LensSharing extends Component {
  @state data: AppState = initial();
  @state rows: Row[] = [];
  @state lastAction = "nothing yet";

  private apply(label: string, next: AppState) {
    this.rows = compare(this.data, next);
    this.data = next;
    this.lastAction = label;
  }

  rename() {
    const title = `Second post (${this.data.posts[1].title.length})`;
    this.apply(
      `get("posts").where(id === 102).get("title").set("${title}")`,
      focusOn(this.data)
        .get("posts")
        .where((post) => post.id === 102)
        .get("title")
        .set(title),
    );
  }

  addTag() {
    const tag = `tag${this.data.posts[1].tags.length}`;
    this.apply(
      `get("posts").where(id === 102).get("tags").push("${tag}")`,
      focusOn(this.data)
        .get("posts")
        .where((post) => post.id === 102)
        .get("tags")
        .push(tag),
    );
  }

  fork() {
    // One walk, two edits. Everything above the fork is copied once.
    this.apply(
      ".and(rename, push) — one walk, two edits",
      focusOn(this.data)
        .get("posts")
        .where((post) => post.id === 102)
        .and(
          (post) => post.get("title").set("Renamed by a fork"),
          (post) => post.get("tags").push("forked"),
        ),
    );
  }

  writeSameValue() {
    // The identity guarantee in the other direction: a write whose value is
    // already there produces no copies at all.
    this.apply(
      "set() to the value it already has",
      focusOn(this.data)
        .get("posts")
        .where((post) => post.id === 102)
        .get("title")
        .set(this.data.posts[1].title),
    );
  }

  reset() {
    this.rows = [];
    this.data = initial();
    this.lastAction = "nothing yet";
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          <button type="button" onClick={this.rename}>
            rename post 102
          </button>
          <button type="button" onClick={this.addTag}>
            add a tag
          </button>
          <button type="button" onClick={this.fork}>
            both, with .and()
          </button>
          <button type="button" onClick={this.writeSameValue}>
            write the same value
          </button>
          <button type="button" onClick={this.reset}>
            reset
          </button>
        </p>

        <p className="demo-note">
          last: <code>{this.lastAction}</code>
        </p>

        <ul className="demo-log">{list({ each: this.rows, as: PathRow })}</ul>

        <p className="demo-note">
          Only what is ON the path gets a new object. `state.users` and `state.posts[0]` come out of every edit as the
          very same objects, so a shallow compare rejects those branches without looking inside them — which is what
          makes the diff cheap. Write a value that is already there and nothing is copied at all, not even the root.
        </p>
      </div>
    );
  }
}
