import { Component, Host, bootstrap, list } from "../framework";

declare const rows: { id: string; label: string }[];
declare const wide: boolean;

@Host("div")
class Panel extends Component {
  render() {
    return <span />;
  }
}

@Host("div")
class Rows extends Component {
  render() {
    return (
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
    );
  }
}

@Host("div")
class Styles extends Component {
  render() {
    return (
      <div>
        {/* REPORTED — Ramonda reads className. */}
        <span class="muted">styled by nothing</span>
        {/* Not reported. */}
        <span className="muted">styled</span>
        {/* Not reported: on a component, `class` is a prop that component declared. */}
        <Panel class="muted" />
      </div>
    );
  }
}

bootstrap(<Rows />, null);
bootstrap(<Styles />, null);
