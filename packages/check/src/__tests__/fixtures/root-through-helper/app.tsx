import { Component, bootstrap, createContext } from "@ramonda/core";

declare function __h(tag: unknown, props: unknown, ...children: unknown[]): never;
declare function make(): never;

const [, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

class Reader extends Component {
  theme = this.use(ThemeConsumer);
  render() {
    return <p>reader</p>;
  }
}

/** A helper that returns JSX, called as the root. */
const shell = () => <Reader />;
bootstrap(shell(), document.body);

/** The shape a test helper has: the caller's tree, wrapped when the caller asks. */
export function mount(ui: unknown, wrapper?: unknown): void {
  const wrap = (node: unknown) => (wrapper ? __h(wrapper, null, node) : node);
  bootstrap(wrap(ui) as never, document.body);
}

/** A call to something that is not a helper says nothing about what it mounts. */
bootstrap(make(), document.body);

declare function mountElsewhere(node: unknown): void;

/** A component declared inside an exported function is entered through that export. */
export function host(): void {
  class Inner extends Component {
    render() {
      return <p>inner</p>;
    }
  }
  mountElsewhere(__h(Inner, null));
}

/** The same inside a function nothing publishes is still nobody's. */
function hidden(): void {
  class Lost extends Component {
    render() {
      return <p>lost</p>;
    }
  }
  mountElsewhere(__h(Lost, null));
}
void hidden;

/** And inside an exported arrow, the other way a function is published. */
export const hostArrow = (): void => {
  class InnerArrow extends Component {
    render() {
      return <p>inner</p>;
    }
  }
  mountElsewhere(__h(InnerArrow, null));
};
