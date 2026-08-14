import { Component } from "../../framework";

/** The kit's members, as the package writes them before it publishes a `.d.ts`. */
export class Router extends Component {
  render() {
    return <div>router</div>;
  }
}
export class RouteOutlet extends Component {
  render() {
    return <div>outlet</div>;
  }
}
export class Link extends Component {
  render() {
    return <a>link</a>;
  }
}

export function createRouter(_routes: unknown) {
  return { Router, RouteOutlet, Link, route: (p: string) => p };
}
