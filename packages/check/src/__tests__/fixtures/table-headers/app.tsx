import { Component, Host, bootstrap } from "@ramonda/core";

declare const rows: { item: string; price: string }[];

@Host("tr")
class HeaderRow extends Component {
  render() {
    return null;
  }
}

@Host("div")
class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ Written out, data rows, and not one `<th>`. */}
        <table>
          <tr>
            <td>Item</td>
            <td>Price</td>
          </tr>
          <tr>
            <td>Tea</td>
            <td>£4.50</td>
          </tr>
        </table>

        {/* ✗ The same through `<thead>`/`<tbody>`, which changes nothing about the association. */}
        <table>
          <thead>
            <tr>
              <td>Item</td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Tea</td>
            </tr>
          </tbody>
        </table>

        {/* ✓ Headers written out. */}
        <table>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Price</th>
          </tr>
          <tr>
            <td>Tea</td>
            <td>£4.50</td>
          </tr>
        </table>

        {/* ✓ A heading down the left of each row is the other half of a table that has both. */}
        <table>
          <tr>
            <th scope="row">Tea</th>
            <td>£4.50</td>
          </tr>
        </table>

        {/* ✓ Rows from data — the commonest real table, and the headers may well be in there. */}
        <table>
          {rows.map((row) => (
            <tr key={row.item}>
              <td>{row.item}</td>
            </tr>
          ))}
        </table>

        {/* ✓ A COMPONENT may be the header row. */}
        <table>
          <HeaderRow />
          <tr>
            <td>Tea</td>
          </tr>
        </table>

        {/* ✓ A LAYOUT table says so, and that is exactly what the role is for. */}
        <table role="presentation">
          <tr>
            <td>left</td>
            <td>right</td>
          </tr>
        </table>

        {/* ✓ The synonym says the same thing. */}
        <table role="none">
          <tr>
            <td>left</td>
          </tr>
        </table>

        {/* ✓ No rows at all: scaffolding rather than data. */}
        <table />

        {/* ✓ Only a caption — still nothing to announce badly. */}
        <table>
          <caption>Prices</caption>
        </table>
      </div>
    );
  }
}

bootstrap(<App />, null);
