/** A base whose helper is called ONLY from a server-only lifecycle in the subclass. */
import { Component } from "../framework";

export class ConfigBase extends Component {
  protected fromDb(): string {
    return process.env.DATABASE_URL ?? "";
  }

  /** The ECMAScript private form of the same thing — as unreachable as the TypeScript one. */
  #alsoFromDb(): string {
    return process.env.REGION ?? "";
  }

  protected region(): string {
    return this.#alsoFromDb();
  }
  render() {
    return null;
  }
}
