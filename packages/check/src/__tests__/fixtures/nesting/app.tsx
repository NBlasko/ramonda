import { Component, Host, bootstrap } from "../framework";

declare const rows: { id: string }[];

/** A component, so the rules have something they must stay quiet about. */
@Host("tbody")
class Body extends Component {
  render() {
    return <span />;
  }
}

@Host("div")
class Tables extends Component {
  render() {
    return (
      <div>
        {/* REPORTED — a row outside any table. */}
        <tr />
        {/* Not reported: where it belongs. */}
        <table>
          <tbody>
            <tr />
          </tbody>
        </table>
        {/* Not reported: the callback renders where it sits, and that is inside a tbody. */}
        <table>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} />
            ))}
          </tbody>
        </table>
        {/* REPORTED — the same callback shape, in the wrong parent. */}
        <div>
          {rows.map((row) => (
            <tr key={row.id} />
          ))}
        </div>
        {/* REPORTED — an option with no select above it. */}
        <option>One</option>
        {/* Not reported. */}
        <details>
          <summary>More</summary>
        </details>
        {/* Not reported: what <Body /> renders is decided inside it. */}
        <Body>
          <tr />
        </Body>
      </div>
    );
  }
}

@Host("div")
class Controls extends Component {
  render() {
    return (
      <div>
        {/* REPORTED — a link inside a link. */}
        <a href="/a">
          <a href="/b">inner</a>
        </a>
        {/* REPORTED — the same, with a wrapper in between. */}
        <a href="/c">
          <span>
            <a href="/d">inner</a>
          </span>
        </a>
        {/* Not reported: side by side. */}
        <div>
          <button type="button">one</button>
          <button type="button">two</button>
        </div>
        {/* Not reported: a component in the way. */}
        <button type="button">
          <Body />
        </button>
      </div>
    );
  }
}

bootstrap(<Tables />, null);
bootstrap(<Controls />, null);
