import { Component, Host, list, state, watchProp, memoized } from "@ramonda/core";

/** Module scope, so `each` is the SAME array every render — a fresh literal would be a new value
 *  each time and cost the list the identity it mints from its items. */
const USERS = ["ada", "grace", "alan"];

// @watchProp reacts to one prop changing, BEFORE the render — so derived state is
// already correct when render() runs, with no second pass. An effect would work
// too, but it runs after the commit and its write causes another render.
//
// Type it by annotating the SELECTOR's parameter. That fills in both the props
// type and the value type by inference; an explicit generic cannot, because
// TypeScript has no partial inference and naming one would drop the other.
@Host("div")
class Profile extends Component<{ userId: string }> {
  @state loadedFor = "—";
  @state loads = 0;

  @watchProp((props) => props.userId)
  reload([next]: [string], [previous]: [string]) {
    this.loadedFor = `${previous} → ${next}`;
    this.loads = this.loads + 1;
  }

  render() {
    return (
      <p className="demo-row">
        <span>
          showing <strong>{this.props.userId}</strong>
        </span>
        <span className="demo-note">
          {this.loads === 0
            ? "no change yet — @watchProp does not fire on mount"
            : `${this.loadedFor} (${this.loads} reloads)`}
        </span>
      </p>
    );
  }
}

@Host("div")
export class WatchPropDemo extends Component {
  @state userId = "ada";

  // Cached by its argument, so the buttons keep their handlers across renders.
  renderChoice(id: string) {
    return (
      <button type="button" disabled={this.userId === id} onclick={this.select(id)}>
        {id}
      </button>
    );
  }

  @memoized
  select(id: string) {
    return () => {
      this.userId = id;
    };
  }

  render() {
    return (
      <div>
        <p className="demo-row">{list(USERS, this.renderChoice)}</p>
        <Profile userId={this.userId} />
      </div>
    );
  }
}
