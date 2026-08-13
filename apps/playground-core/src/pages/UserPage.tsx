import { Component } from "@ramonda/core";
import { Link, Navigator } from "@ramonda/router";

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
          <Link href="/users/7" className="navlink">
            User 7
          </Link>
          <Link href="/users/99" className="navlink">
            User 99
          </Link>
        </div>
      </div>
    );
  }
}
