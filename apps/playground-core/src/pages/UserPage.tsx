import { Component } from "@ramonda/core";
import { Anchor, Navigator } from "@ramonda/router";

export class UserPage extends Component {
  route = this.use(Navigator);
  render() {
    const id = this.route.params<{ id: string }>().id;
    return (
      <div className="page">
        <h2>User Profile</h2>
        <p className="muted">
          Route param <code>:id</code> = <strong>{id}</strong>
          &nbsp;(from &lt;Router&gt; match → Navigator.params)
        </p>
        <div className="row">
          <Anchor href="/users/7" className="navlink">
            User 7
          </Anchor>
          <Anchor href="/users/99" className="navlink">
            User 99
          </Anchor>
        </div>
      </div>
    );
  }
}
