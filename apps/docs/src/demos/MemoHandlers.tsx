import { Component, Host, state, memoizedHandler, list } from "@ramonda/core";

// @memoizedHandler caches a function by its arguments, per instance. Ask for
// `this.remove("a")` twice and you get the SAME function both times.
//
// That matters because a fresh closure per render is a changing prop: the diff
// sees a new value and re-applies the listener on every row, every render. With
// the cache the identity is stable, so nothing downstream is touched.
//
// Entries whose arguments were not requested this render are dropped, so the
// cache tracks the list rather than growing with every value ever seen.
@Host("div")
export class MemoHandlers extends Component {
  @state items = ["apples", "bread", "coffee"];
  @state lastIdentityCheck = "—";

  // `list()`, not `items.map(...)`: this list has items REMOVED from the middle,
  // which is exactly where matching by position moves a row's state to its
  // neighbour. The rows here carry no state of their own, but a demo is code
  // people copy, and the version worth copying is the one that stays correct
  // when the row gains state later.

  @memoizedHandler
  remove(name: string) {
    return () => {
      this.items = this.items.filter((item) => item !== name);
    };
  }

  compareIdentity() {
    const first = this.remove("apples");
    const second = this.remove("apples");
    this.lastIdentityCheck = first === second ? "same function ✓" : "different function ✗";
  }

  render() {
    return (
      <div>
        <ul className="demo-log">
          {list(this.items, (name: string) => (
              <li>
                {name}{" "}
                <button type="button" onClick={this.remove(name)}>
                  remove
                </button>
              </li>
            ))}
        </ul>
        <p className="demo-row">
          <button type="button" onClick={this.compareIdentity}>
            this.remove("apples") twice →
          </button>
          <span className="demo-note">{this.lastIdentityCheck}</span>
        </p>
      </div>
    );
  }
}
