/** A base whose helper is called ONLY from a server-only lifecycle in the subclass. */
import { Component } from "../framework";

export class ConfigBase extends Component {
  protected fromDb(): string {
    return process.env.DATABASE_URL ?? "";
  }
  render() {
    return null;
  }
}
