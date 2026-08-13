import { Component } from "@ramonda/core";
import { Anchor } from "@ramonda/router";

export class HomePage extends Component {
  render() {
    return (
      <div className="page">
        <h2>Ramonda Router 🌸</h2>
        <p className="muted">
          State-first, race-free routing. Click the links, use the browser's Back/Forward, or open a link in a new tab
          (real <code>&lt;a href&gt;</code> via <code>@Host("a")</code>).
        </p>
        <ul>
          <li>
            <Anchor href="/showcase">→ Decorator showcase</Anchor>
          </li>
          <li>
            <Anchor href="/users/123">→ User 123 (route :param)</Anchor>
          </li>
          <li>
            <Anchor href="/table">→ Lists and tables</Anchor>
          </li>
          <li>
            <Anchor href="/slots">→ Slots and their edge cases</Anchor>
          </li>
          <li>
            <Anchor href="/async">→ AsyncLoad (code splitting)</Anchor>
          </li>
          <li>
            <Anchor href="/about">→ About</Anchor>
          </li>
        </ul>
      </div>
    );
  }
}
