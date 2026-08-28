import { Component, bootstrap, list } from "@ramonda/core";

declare const rows: { id: string; label: string }[];
declare const wide: boolean;

class Panel extends Component {
  render() {
    return (
      <div>
        <span />
      </div>
    );
  }
}

class Rows extends Component {
  render() {
    return (
      <div>
        <div>
          {/* REPORTED — from a map, so there is no identity at all. */}
          <ul>
            {rows.map((row) => (
              <li>{row.label}</li>
            ))}
          </ul>
          {/* Not reported. */}
          <ul>
            {rows.map((row) => (
              <li key={row.id}>{row.label}</li>
            ))}
          </ul>

          {/* REPORTED — from a list, so the identity is inferred rather than chosen. */}
          <ul>
            {list(rows, (row) => (
              <li>{row.label}</li>
            ))}
          </ul>
          {/* Not reported. */}
          <ul>
            {list(rows, (row) => (
              <li key={row.id}>{row.label}</li>
            ))}
          </ul>

          {/* REPORTED once — the <tr> is the row, the <td> inside it is not. */}
          <table>
            <tbody>
              {rows.map((row) => (
                <tr>
                  <td>{row.label}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* REPORTED twice — both branches are rows. */}
          <ul>{rows.map((row) => (wide ? <li>{row.label}</li> : <li>{row.id}</li>))}</ul>

          {/* REPORTED — a component row needs a key exactly as much as a tag does. */}
          <div>
            {list(rows, () => (
              <Panel />
            ))}
          </div>

          {/* Not reported: not built from data at all. */}
          <li>a lone item</li>
        </div>
      </div>
    );
  }
}

class Styles extends Component {
  render() {
    return (
      <div>
        <div>
          {/* REPORTED — renamed to className, so the source does not say what the element gets. */}
          <span class="muted">styled by nothing</span>
          {/* Not reported. */}
          <span className="muted">styled</span>
          {/* REPORTED, and the sharp one — `className` wins and this `class` is dropped. */}
          <span class="muted" className="loud">
            one of these two
          </span>
          {/* REPORTED — a component is renamed too, so a `class` prop it declared reads undefined. */}
          <Panel class="muted" />
        </div>
      </div>
    );
  }
}

bootstrap(<Rows />, null);
bootstrap(<Styles />, null);

class Sibling extends Component {
  render() {
    return (
      <ul>
        <ul>
          {/* Not reported: the first of each key. */}
          <li key="a">one</li>
          {/* REPORTED — a sibling already claims "a". */}
          <li key="a">two</li>
          {/* Not reported: a key of its own. */}
          <li key="b">three</li>
          {/* REPORTED — numbers compare too. */}
          <li key={1}>four</li>
          <li key={1}>five</li>
          {/* Not reported: nothing here can read either of these. */}
          <li key={rows[0].id}>six</li>
          <li key={rows[1].id}>seven</li>
          {/* Not reported: the same key under a DIFFERENT parent is a different key. */}
          <li key="c">
            <ul>
              <li key="a">nested</li>
            </ul>
          </li>
        </ul>
      </ul>
    );
  }
}

bootstrap(<Sibling />, null);
