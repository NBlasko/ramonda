import { Component, Host, state } from "@ramonda/core";
import { Router, RouteOutlet, Navigator, Link, createRoutes } from "@ramonda/router";

/**
 * Deliberately small. This app exists to answer questions a jsdom test cannot:
 * does a REAL server render the page the URL asks for, and does a REAL browser
 * adopt that markup instead of rebuilding it.
 */

@Host("div")
class Counter extends Component {
  @state clicks = 0;
  bump() {
    this.clicks++;
  }
  render() {
    return (
      <p>
        {/* Rendered on the server as 0, then interactive after hydration. */}
        <button id="bump" onClick={this.bump}>
          clicked {this.clicks} times
        </button>
      </p>
    );
  }
}

@Host("div")
class HomePage extends Component {
  render() {
    return (
      <div className="page">
        <h2>Home</h2>
        <p>Rendered on the server, then hydrated.</p>
        <Counter />
      </div>
    );
  }
}

@Host("div")
class AboutPage extends Component {
  render() {
    return (
      <div className="page">
        <h2>About</h2>
        <p>A second route, so the server has to choose.</p>
      </div>
    );
  }
}

@Host("div")
class UserPage extends Component {
  route = this.use(Navigator);
  render() {
    const id = this.route.params<{ id: string }>().id;
    return (
      <div className="page">
        <h2>User {id}</h2>
        <p>The id came out of the URL — on the server.</p>
      </div>
    );
  }
}

@Host("div")
class NotFoundPage extends Component {
  route = this.use(Navigator);
  render() {
    return (
      <div className="page">
        <h2>404</h2>
        <p>No route for {this.route.pathname}.</p>
      </div>
    );
  }
}

const routes = createRoutes({
  "/": <HomePage />,
  "/about": <AboutPage />,
  "/users/:id": <UserPage />,
  "*": <NotFoundPage />,
});

@Host("div")
export class App extends Component {
  router = this.use(Router);
  route = this.use(Navigator);
  render() {
    return (
      <div className="app">
        <nav>
          <Link href="/">Home</Link>
          <Link href="/about">About</Link>
          <Link href="/users/42">User 42</Link>
          <Link href="/nope">Missing</Link>
        </nav>
        <code id="path">{this.route.pathname}</code>
        <RouteOutlet routes={routes} />
      </div>
    );
  }
}
