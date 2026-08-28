import { Component } from "@ramonda/core";
import { Link } from "../routes";

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
            <Link href="/showcase">→ Decorator showcase</Link>
          </li>
          <li>
            <Link href="/users/123">→ User 123 (route :param)</Link>
          </li>
          <li>
            <Link href="/table">→ Lists and tables</Link>
          </li>
          <li>
            <Link href="/slots">→ Slots and their edge cases</Link>
          </li>
          <li>
            <Link href="/caret">→ The caret in a controlled field</Link>
          </li>
          <li>
            <Link href="/async">→ AsyncLoad (code splitting)</Link>
          </li>
          <li>
            <Link href="/about">→ About</Link>
          </li>
        </ul>
      </div>
    );
  }
}
