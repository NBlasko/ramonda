import { Component, Host, bootstrap, list } from "../framework";

interface Row {
  id: string;
  label: string;
}

declare const rows: Row[];

const FIRST = "first";

/** The row callback extracted to a name, which is how a long row gets out of the JSX. */
const renderRow = (row: Row) => <tr>{row.label}</tr>;
const renderIndexed = (row: Row, i: number) => <tr key={i}>{row.label}</tr>;

@Host("div")
class Rows extends Component {
  render() {
    return (
      <div>
        {/* row-without-a-key */}
        <table>
          {rows.map((row) => (
            <tr>{row.label}</tr>
          ))}
        </table>
        <table>{rows.map(renderRow)}</table>
        <table>
          {list(rows, (row) => (
            <tr>{row.label}</tr>
          ))}
        </table>
        <table>{list(rows, renderRow)}</table>
        {/* Silent: the key is there. */}
        <table>
          {rows.map((row) => (
            <tr key={row.id}>{row.label}</tr>
          ))}
        </table>

        {/* index-as-key */}
        <table>
          {rows.map((row, i) => (
            <tr key={i}>{row.label}</tr>
          ))}
        </table>
        <table>
          {rows.map((row, i) => (
            <tr key={`row-${i}`}>{row.label}</tr>
          ))}
        </table>
        <table>
          {rows.map((row, i) => {
            const rowKey = `row-${i}`;
            return <tr key={rowKey}>{row.label}</tr>;
          })}
        </table>
        <table>{rows.map(renderIndexed)}</table>
        {/* Silent: the key carries an identity as well as a position. */}
        <table>
          {rows.map((row, i) => (
            <tr key={`${row.id}-${i}`}>{row.label}</tr>
          ))}
        </table>

        {/* duplicate-key-among-siblings */}
        <ul>
          <li key="first">a</li>
          <li key="first">b</li>
        </ul>
        <ul>
          <li key={FIRST}>a</li>
          <li key={FIRST}>b</li>
        </ul>
      </div>
    );
  }
}

bootstrap(<Rows />, null);
