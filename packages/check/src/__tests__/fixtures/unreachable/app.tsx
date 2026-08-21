import { Component, Hook, bootstrap } from "@ramonda/core";

class Mounted extends Component {
  render() {
    return <span>mounted</span>;
  }
}

/** Used by a component the root reaches — a hook mounts nothing, so only `uses` reaches it. */
class Counter extends Hook {
  n = 0;
}

/** Nothing mounts this, and nothing outside this file can even name it. */
class Orphan extends Component {
  render() {
    return <span>orphan</span>;
  }
}

/** Nor this: a helper nobody calls, and not exported, so nothing outside can call it either. */
function unusedRow(): unknown {
  return <Mounted />;
}

/** Exported, so it is a way IN — an SSR entry is called by the server, not by this program. */
export function renderOne(): unknown {
  return <Mounted />;
}

class App extends Component {
  counter = this.use(Counter);
  render() {
    return <Mounted />;
  }
}

bootstrap(<App />, null);
