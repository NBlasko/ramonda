import { Component, bootstrap, createContext, type ComponentClassKind, type RamondaNode } from "@ramonda/core";

const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

class Reader extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>x</span>;
  }
}

class Plain extends Component {
  render() {
    return <span>y</span>;
  }
}

interface SlotProps {
  view: ComponentClassKind;
  spec: {
    toolbar: { right: { inner: ComponentClassKind } };
    columns: { cell: ComponentClassKind }[];
  };
  /** Not a slot: a node the caller already wrote, not one this component fills. */
  children: unknown;
  /** Also not a slot, and the harder half — a NODE carries a component class inside it. */
  banner: RamondaNode;
}

/** The caller decides what this mounts, so nothing in this class can say. */
class Slot extends Component<SlotProps> {
  render() {
    const View = this.props.view;
    return <View />;
  }
}

/** The other spelling, with the prop named in the tag. */
class DirectSlot extends Component<{ view: ComponentClassKind }> {
  render() {
    return <this.props.view />;
  }
}

const SPEC = {
  toolbar: { right: { inner: Plain } },
  columns: [{ cell: Plain }],
};

class Covered extends Component {
  p = this.use(ThemeProvider);
  render() {
    return <Slot view={Reader} spec={{ toolbar: { right: { inner: Plain } }, columns: [{ cell: Plain }] }} />;
  }
}

class Bare extends Component {
  render() {
    return <Slot view={Reader} spec={SPEC} />;
  }
}

class Either extends Component {
  render() {
    return <DirectSlot view={Plain ? Plain : Reader} />;
  }
}

/**
 * Two constants that name each other: a runtime error, and ordinary syntax.
 *
 * Following one into the other with the depth unchanged recursed until the stack gave out, so the
 * whole run died with a trace instead of reporting anything.
 */
const LOOP_A = LOOP_B;
const LOOP_B = LOOP_A;

class Looping extends Component {
  render() {
    return <Slot view={LOOP_A} spec={SPEC} />;
  }
}

class Leaf extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>leaf</span>;
  }
}

/**
 * A tree renderer: it mounts whatever it is handed, and mounts ITSELF with something else handed
 * over. Keyed on the node alone, the second arrival was read as a cycle and `Leaf` was never
 * judged.
 */
class Tree extends Component {
  render() {
    return (
      <div>
        <this.props.cell />
        <Tree cell={Leaf} />
      </div>
    );
  }
}

class Grove extends Component {
  render() {
    return <Tree cell={Plain} />;
  }
}

class App extends Component {
  p = this.use(ThemeProvider);
  render() {
    return (
      <div>
        <Covered />
        <Either />
      </div>
    );
  }
}

class Shell extends Component {
  render() {
    return (
      <div>
        <Bare />
        <Grove />
      </div>
    );
  }
}

bootstrap(<App />, null);
bootstrap(<Shell />, null);
