import { Component, bootstrap } from "@ramonda/core";
import { Router } from "@ramonda/router";

declare const window: {
  location: { pathname: string };
};

/**
 * The router's own code, reading the URL.
 *
 * This is not the mistake the rule is about — it is the job. Somewhere inside the router, something
 * has to read `window.location`, or the router would have nothing to tell anybody. A rule about
 * reaching past an abstraction is always wrong about the code that implements it.
 */
class UrlUtils extends Component {
  route = this.use(Router);
  render() {
    return <span>{window.location.pathname}</span>;
  }
}

bootstrap(<UrlUtils />, null);
