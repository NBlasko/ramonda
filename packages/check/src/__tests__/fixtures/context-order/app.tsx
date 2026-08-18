import { bootstrap, Component, createContext } from "@ramonda/core";
import {
  SizeConsumer,
  SizeProvider,
  ThemeConsumer,
  ThemeConsumer as Reads,
  ThemeProvider,
  ThemeProvider as Publishes,
} from "./theme";

/** The fault: the consumer resolves before this component's own provider exists. */
export class ConsumerFirst extends Component {
  outer = this.use(ThemeConsumer);
  own = this.use(ThemeProvider, () => ({ color: "amber" }));
  render() {
    return <p>consumer first</p>;
  }
}

/** The same, with something harmless between them — the order is what matters, not adjacency. */
export class WithAFieldBetween extends Component {
  outer = this.use(SizeConsumer);
  label = "in between";
  own = this.use(SizeProvider, () => ({ size: "l" }));
  render() {
    return <p>separated</p>;
  }
}

/** Renamed on import. The pair is known by where it was declared, not by what it is called here. */
export class RenamedBindings extends Component {
  reader = this.use(Reads);
  writer = this.use(Publishes, () => ({ color: "rose" }));
  render() {
    return <p>renamed</p>;
  }
}

// ── everything below is CORRECT and must stay silent ─────────────────────────────────────────

/**
 * Provider first. This is `this.use(QueryClientProvider)` followed by `this.use(Query, …)` — mount a
 * client, then query on it — and it is the arrangement the packages are built around.
 */
export class ProviderFirst extends Component {
  own = this.use(ThemeProvider, () => ({ color: "amber" }));
  mine = this.use(ThemeConsumer);
  render() {
    return <p>provider first</p>;
  }
}

/** Only a consumer. Whatever is above it is above it, and this rule has nothing to say. */
export class OnlyAConsumer extends Component {
  outer = this.use(ThemeConsumer);
  render() {
    return <p>consumer only</p>;
  }
}

/** Only a provider. */
export class OnlyAProvider extends Component {
  own = this.use(ThemeProvider, () => ({ color: "amber" }));
  render() {
    return <p>provider only</p>;
  }
}

/** Two DIFFERENT contexts. Consuming one above providing the other is not one context at all. */
export class TwoDifferentContexts extends Component {
  theme = this.use(ThemeConsumer);
  size = this.use(SizeProvider, () => ({ size: "l" }));
  render() {
    return <p>two contexts</p>;
  }
}

/**
 * A pair the rule cannot resolve to binding elements, so it says nothing.
 *
 * `createContext` is called and held whole, and the halves are reached by index. Nothing here proves
 * which element is which — the rule going quiet is the contract, not a gap.
 */
const pair = createContext({ color: "slate" }, { label: "Held" });
export class ReachedByIndex extends Component {
  outer = this.use(pair[1]);
  own = this.use(pair[0], () => ({ color: "amber" }));
  render() {
    return <p>by index</p>;
  }
}

export class App extends Component {
  render() {
    return (
      <main>
        <ConsumerFirst />
        <WithAFieldBetween />
        <RenamedBindings />
        <ProviderFirst />
        <OnlyAConsumer />
        <OnlyAProvider />
        <TwoDifferentContexts />
        <ReachedByIndex />
      </main>
    );
  }
}

bootstrap(<App />, null);
