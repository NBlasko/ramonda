import {
  Component,
  Hook,
  StableProps,
  StableProps as Stable,
  bootstrap,
  state,
  watchProp,
  watchProp as onPropChange,
} from "@ramonda/core";

interface Props {
  userId: string;
}

/** Written plainly. */
@StableProps("conf")
class Plain extends Component<Props> {
  @state n = 0;

  @watchProp((p: Props) => p.nope)
  onNope() {}

  render() {
    return (
      <div>
        <div>{this.n}</div>
      </div>
    );
  }
}

/** The same, with every decorator imported under another name. */
@Element("div")
@Stable("conf")
class Aliased extends Component<Props> {
  @state n = 0;

  @onPropChange((p: Props) => p.nope)
  onNope() {}

  render() {
    return <div>{this.n}</div>;
  }
}

/**
 * A child that declares `conf` STABLE through an aliased `@StableProps`.
 *
 * Reporting `conf={{…}}` on it would be reporting the fix — the declaration is what makes the
 * literal safe.
 */
@Stable("conf")
class AliasedStableChild extends Component<{ conf: unknown }> {
  render() {
    return <p>child</p>;
  }
}

class HandsAStableProp extends Component {
  render() {
    return (
      <div>
        <AliasedStableChild conf={{ dense: true }} />
      </div>
    );
  }
}

void Hook;

bootstrap(<Plain />, null);
bootstrap(<HandsAStableProp />, null);
bootstrap(<Aliased />, null);
