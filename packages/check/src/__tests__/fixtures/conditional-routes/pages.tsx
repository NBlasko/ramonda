import { Component } from "@ramonda/core";
import { Link } from "@ramonda/router";

export class Home extends Component {
  render() {
    return <p>home</p>;
  }
}

/** Silent: a debug page linking to another one — it is only ever rendered where they exist. */
export class DebugPage extends Component {
  render() {
    return <Link href="/debug/cache">cache</Link>;
  }
}

export class DebugCache extends Component {
  render() {
    return <p>cache</p>;
  }
}

export class AdminPage extends Component {
  render() {
    return <p>admin</p>;
  }
}
