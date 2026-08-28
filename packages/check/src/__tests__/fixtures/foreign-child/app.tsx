import { Component, bootstrap } from "@ramonda/core";

declare const rows: string[];

class Row extends Component {
  render() {
    return null;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ The wrapper that arrives later and quietly ends the list. */}
        <ul>
          <div>row</div>
        </ul>

        {/* ✗ A `<select>` the parser will MOVE the child out of. */}
        <select>
          <span>one</span>
        </select>

        {/* ✗ A `<table>` the same. */}
        <table>
          <div>row</div>
        </table>

        {/* ✗ A `<tr>` takes cells and nothing else. */}
        <table>
          <tr>
            <div>cell</div>
          </tr>
        </table>

        {/* ✗ Two foreign children are two reports, because each is its own line to move. */}
        <ol>
          <div>a</div>
          <span>b</span>
        </ol>

        {/* ✓ The right child. */}
        <ul>
          <li>row</li>
        </ul>

        {/* ✓ Built from data — how every real list is made, and the tag may be right. */}
        <ul>{rows.map((row) => row)}</ul>

        {/* ✗ Words written straight inside, which the content model takes no more than a tag. */}
        <ul>
          Items:
          <li>one</li>
        </ul>
        {/* ✓ The whitespace between children is a text node on every well-formed list there is. */}
        <ul>
          <li>one</li>
          <li>two</li>
        </ul>

        {/* ✓ A COMPONENT may render exactly the right tag. */}
        <ul>
          <Row />
        </ul>

        {/* ✓ The tags a container takes BESIDE its main one. */}
        <table>
          <caption>Prices</caption>
          <colgroup />
          <thead>
            <tr>
              <th scope="col">Item</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Tea</td>
            </tr>
          </tbody>
        </table>

        {/* ✓ A `<select>` takes an optgroup and an hr. */}
        <select>
          <optgroup label="Hot">
            <option>Tea</option>
          </optgroup>
          <hr />
          <option>Water</option>
        </select>

        {/* ✓ A `<dl>` takes both, and a `<div>` wrapper is allowed in one by the spec. */}
        <dl>
          <dt>Tea</dt>
          <dd>£4.50</dd>
          <div>
            <dt>Water</dt>
            <dd>Free</dd>
          </div>
        </dl>

        {/* ✓ A `<picture>` takes sources and an image. */}
        <picture>
          <source srcSet="/a.webp" />
          <img src="/a.png" alt="a cat" />
        </picture>
      </div>
    );
  }
}

bootstrap(<App />, null);
