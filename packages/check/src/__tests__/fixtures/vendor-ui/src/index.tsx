import { Component, Hook, createContext } from "../../framework";

export const [QueryProvider, QueryConsumer] = createContext({ client: null }, { label: "Query" });

/**
 * Internal, and in the fragment anyway.
 *
 * A summary would say "DataGrid requires Query" and the app would have to take it on trust. The
 * fragment carries this class too, so the app's report names the real path — and the name is in
 * the bundle already, so it is no secret.
 */
class PagedBody extends Component {
  q = this.use(QueryConsumer);
  render() {
    return <span>rows</span>;
  }
}

/** A hook that publishes the context for whoever uses it — the Router idiom. */
class QueryOwner extends Hook {
  p = this.use(QueryProvider);
}

class SelfBody extends Component {
  q = this.use(QueryConsumer);
  render() {
    return <span>self</span>;
  }
}

/**
 * Provides the context ITSELF, through a hook, so nothing above it has to.
 *
 * A hook is how a component publishes a context for its own subtree, and the fragment records it
 * as `uses` — the propagation is a rule, not a fact. An app that splices this in has to run that
 * rule over the spliced nodes too, or it reports a fault the package's own run does not.
 */
export class SelfServing extends Component {
  owner = this.use(QueryOwner);
  render() {
    return <SelfBody />;
  }
}

class HelperBody extends Component {
  q = this.use(QueryConsumer);
  render() {
    return <span>helped</span>;
  }
}

/** The package's own helper: a consumer reached only through a function that returns JSX. */
function helpedRow(): unknown {
  return <HelperBody />;
}

export class DataGrid extends Component {
  render() {
    return (
      <div>
        <PagedBody />
        {helpedRow()}
      </div>
    );
  }
}
