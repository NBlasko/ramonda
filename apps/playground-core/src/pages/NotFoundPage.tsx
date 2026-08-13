import { Component } from "@ramonda/core";
import { Anchor, Navigator } from "@ramonda/router";

export class NotFoundPage extends Component {
  route = this.use(Navigator);
  render() {
    return (
      <div className="page">
        <h2>404</h2>
        <p className="muted">
          No route for <code>{this.route.pathname}</code>.
        </p>
        <Anchor href="/" className="navlink">
          Go home
        </Anchor>
      </div>
    );
  }
}
