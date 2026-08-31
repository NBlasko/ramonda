import { Component, bootstrap, list, state } from "@ramonda/core";

const CONFIG = { dense: true };

declare const unknownThing: unknown;
declare function build(): { a: number };

class Panel extends Component<{ item: { name: string } }> {
  @state rows: string[] = [];

  render() {
    const local = { a: 1 };
    return (
      <div>
        {/* REPORTED — an object literal written straight into children. */}
        <p>{{ a: 1 }}</p>
        {/* REPORTED — the same object one line up, which is how it is usually written. */}
        <p>{local}</p>
        {/* REPORTED — a module constant is still an object among children. */}
        <p>{CONFIG}</p>
        {/* REPORTED — one arm of a branch is dropped whenever that arm is taken. */}
        <p>{this.rows.length > 0 ? CONFIG : null}</p>

        {/* Silent: a prop is not knowable from here. */}
        <p>{this.props.item}</p>
        {/* Silent: reading a field OFF the object is the whole point. */}
        <p>{this.props.item.name}</p>
        {/* Silent: an ARRAY is a group the runtime flattens, not a stray object. */}
        <p>{this.rows}</p>
        {/* Silent: a list descriptor is markup. */}
        <ul>
          {list(this.rows, (row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
        {/* Silent: a vnode. */}
        <p>{<span>ok</span>}</p>
        {/* Silent: text and numbers render. */}
        <p>{"text"}</p>
        <p>{this.rows.length}</p>
        {/* Silent: nothing this can name. */}
        <p>{unknownThing}</p>
        <p>{build()}</p>
      </div>
    );
  }
}

bootstrap(<Panel item={{ name: "a" }} />, null);
