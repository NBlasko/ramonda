import { Component, createContext } from "../../framework";

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

export class DataGrid extends Component {
  render() {
    return <PagedBody />;
  }
}
