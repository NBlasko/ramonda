import { Component, Host } from "@ramonda/core";
import { RouteHook, Link } from "@ramonda/router";

// A live one: this page is served by a Ramonda router, so the hook below is
// reading the real navigation state of the site you are on. Click the links and
// watch it change without a page load.
//
// `RouteHook` is a hook, not a component, so it adds no element — it just gives
// the component the current route.
@Host("div")
export class RouteInfo extends Component {
  route = this.use(RouteHook);

  render() {
    const query = Object.entries(this.route.searchParams);

    return (
      <div>
        <p className="demo-row">
          <code>pathname</code>
          <strong>{this.route.pathname}</strong>
        </p>
        <p className="demo-row">
          <code>searchParams</code>
          <span className="demo-note">{query.length ? query.map(([k, v]) => `${k}=${v}`).join(" · ") : "(none)"}</span>
        </p>
        <p className="demo-row">
          <Link href="/concepts/state" className="link">
            → State
          </Link>
          <Link href="/lists" className="link">
            → Lists
          </Link>
          <Link href="/routing?from=demo" className="link">
            → back here, with a query
          </Link>
          <button type="button" onClick={this.route.back}>
            ← back
          </button>
        </p>
        <p className="demo-note">
          Reads are per key: a component reading only <code>pathname</code> is not re-rendered when the query changes.
        </p>
      </div>
    );
  }
}
