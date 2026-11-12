import { Component, list, list as each, state } from "@ramonda/core";

const COLUMNS = ["rank", "name", "points"] as const;

/** Reported: the trial's shape — a closure that builds a heading, called once per column. */
export class Standings extends Component {
  @state sorted = "rank";
  render() {
    const head = (key: string) => <th aria-sort={this.sorted === key ? "ascending" : "none"}>{key}</th>;
    return (
      <table>
        <tr>
          {head("rank")}
          {head("name")}
        </tr>
      </table>
    );
  }
}

/** Reported: a `function` declaration with a block body, and a function expression. */
export class Shapes extends Component {
  render() {
    function badge(text: string) {
      if (text === "") return null;
      return <span>{text}</span>;
    }
    const chip = function (text: string) {
      return <b>{text}</b>;
    };
    return (
      <p>
        {badge("new")}
        {chip("hot")}
      </p>
    );
  }
}

/** Reported: declared inside a row callback, still built on every render, per row. */
export class PerRow extends Component {
  render() {
    return (
      <ul>
        {list(COLUMNS, (column) => {
          const cell = (text: string) => <em>{text}</em>;
          return <li>{cell(column)}</li>;
        })}
      </ul>
    );
  }
}

/** Silent: the row callback is HANDED to `list`, inline or lifted into a local. */
export class Handed extends Component {
  render() {
    const row = (column: string) => <li>{column}</li>;
    return (
      <div>
        <ul>{list(COLUMNS, row)}</ul>
        <ul>
          {list(COLUMNS, (column) => (
            <li>{column}</li>
          ))}
        </ul>
        <ol>
          {COLUMNS.map((column) => (
            <li>{column}</li>
          ))}
        </ol>
      </div>
    );
  }
}

/** Silent: called AND handed over — the handed half is another rule's. */
export class Mixed extends Component {
  render() {
    const item = (column: string) => <li>{column}</li>;
    return (
      <ul>
        {item("first")}
        {list(COLUMNS, item)}
      </ul>
    );
  }
}

/** Silent: a helper that returns no markup, and the fix itself — a method. */
export class Fixed extends Component {
  columnHead(key: string) {
    return <th>{key}</th>;
  }
  render() {
    const label = (key: string) => key.toUpperCase();
    return <tr>{this.columnHead(label("rank"))}</tr>;
  }
}

/** Silent: a closure built in ANOTHER method — only `render()` runs on every render. */
export class OtherMethod extends Component {
  rows() {
    const cell = (text: string) => <td>{text}</td>;
    return <tr>{cell("x")}</tr>;
  }
  render() {
    return <table>{this.rows()}</table>;
  }
}

/** Reported: the markup is in a row callback inside the helper — it still returns rows. */
export class RowsHelper extends Component {
  render() {
    const rowsOf = (columns: string[]) => list(columns, (column) => <li>{column}</li>);
    return <ul>{rowsOf(["a", "b"])}</ul>;
  }
}

/** Silent: built inside a click handler — once per click, not once per render. Found by review. */
export class InAHandler extends Component {
  shown: unknown = null;
  render() {
    return (
      <button
        type="button"
        onclick={() => {
          const toast = () => <b>Saved</b>;
          this.shown = toast();
        }}
      >
        Save
      </button>
    );
  }
}

/** Silent: in a callback that runs LATER — a timer, a promise. Found by review. */
export class Later extends Component {
  shown: unknown = null;
  ready = Promise.resolve();
  render() {
    setTimeout(() => {
      const toast = () => <b>Saved</b>;
      this.shown = toast();
    }, 0);
    this.ready.then(() => {
      const note = () => <i>Ready</i>;
      this.shown = note();
    });
    return <p>later</p>;
  }
}

/** Reported: inside a function called right there, which runs with the render. */
export class Immediately extends Component {
  render() {
    return (
      <tr>
        {(() => {
          const cell = (key: string) => <td>{key}</td>;
          return cell("a");
        })()}
      </tr>
    );
  }
}

/** Reported: in a row callback `Array.from` or an aliased `list` runs right there. */
export class OtherRunners extends Component {
  render() {
    return (
      <div>
        {Array.from(COLUMNS, (column) => {
          const cell = (text: string) => <em>{text}</em>;
          return cell(column);
        })}
        {each(COLUMNS, (column) => {
          const tag = (text: string) => <b>{text}</b>;
          return <li>{tag(column)}</li>;
        })}
      </div>
    );
  }
}
