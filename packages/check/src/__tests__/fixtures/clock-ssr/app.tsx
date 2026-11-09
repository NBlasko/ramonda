import { Component, Hook, renderPage } from "@ramonda/core";

class Seeded extends Hook<{ at: unknown }> {}

/** A server-rendered app: `renderPage` is what makes it one. */
class Page extends Component {
  once = this.use(Seeded, () => ({ at: Date.now() }));
  render() {
    return <i />;
  }
}

void renderPage(<Page />);
