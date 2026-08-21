import { Component, Host, bootstrap, created, state } from "@ramonda/core";

declare const __DEV__: boolean;
declare function publish(what: string): void;
declare function displayName(of: unknown): string;
declare const ready: boolean;

@Host("div")
class Guards extends Component {
  @state n = 0;

  @created
  start() {
    // ✗ A statement, and `if (__DEV__)` does the same thing.
    __DEV__ && publish("started");
    // ✗ The ternary spelling of one.
    __DEV__ ? publish("again") : undefined;

    // ✓ Annotated: the reason travels into `annotated` and is printed on every run.
    // ramonda-check-ignore the panel handshake has to be one expression for the bundler to fold it
    __DEV__ && publish("annotated");

    // ✓ The shape being asked for.
    if (__DEV__) {
      publish("properly");
    }
    // ✓ A conjunction INSIDE the `if` is the shape being asked for, not an instance of the fault.
    if (__DEV__ && ready) {
      publish("conditionally");
    }
  }

  render() {
    // ✓ The VALUE is used, and an `if` produces none — advice that does not fit the site would be
    // the rule earning its way out of a project.
    const label = __DEV__ ? displayName(this) : "";
    const armed = __DEV__ && this.n > 0;
    return (
      <div>
        {label}
        {/* ✓ A JSX child is a value too. */}
        {__DEV__ && <span>dev</span>}
        {armed}
      </div>
    );
  }
}

bootstrap(<Guards />, null);
