import { Component, Hook, createContext } from "../../framework";
import { ThemeConsumer } from "@acme/shared";

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

class ThemedBody extends Component {
  theme = this.use(ThemeConsumer);
  render() {
    return <span>themed</span>;
  }
}

/** Needs a context ANOTHER package declares — the shape that has to survive the splice. */
export class Themed extends Component {
  render() {
    return <ThemedBody />;
  }
}

declare function __h(type: unknown, props: unknown): unknown;

/**
 * Mounts whatever a METHOD is handed. `view` is a PARAMETER here, not a prop.
 *
 * The app splicing this fragment writes `<Frame view={Rogue} />`, and the two `view`s have nothing
 * to do with each other. Filling a parameter from a JSX binding would invent a mount nobody wrote
 * and judge `Rogue` against this package's providers.
 */
export class Frame extends Component {
  show(view: unknown): unknown {
    return __h(view, null);
  }
  render() {
    return <span>frame</span>;
  }
}
