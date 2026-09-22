import { Component } from "@ramonda/core";
import ConfigPlayground from "../demos/ConfigPlayground";
import { EtEtStrict } from "../demos/EtEtStrict";
import { StyleProp } from "../demos/StyleProp";
import { StyleBlock, StyleBlockComposed, StyleBlockNested } from "../demos/panels";

/**
 * Style blocks, on a page of their own.
 *
 * They were on the decorator showcase beside seven demos about something else, which made both
 * pages harder to read than either needed to be. The user's words: *"prenatrpalo se sve na jednom
 * mestu."*
 *
 * Everything here is LIVE against this project's own `ramonda.css.ts` — the variables, the units
 * and the per-property rules — so an edit to that file moves this page, and `WALKTHROUGH.md` beside
 * it is the list of edits worth trying.
 */
export class CssPage extends Component {
  render() {
    return (
      <div className="page">
        <div className="row">
          <h2>Style blocks</h2>
        </div>
        <section className="grid">
          <div className="panel">
            <StyleBlock />
            <StyleBlockNested />
            <StyleBlockComposed />
          </div>
          <StyleProp />
          <div className="panel">
            <EtEtStrict />
          </div>
          <ConfigPlayground />
        </section>
      </div>
    );
  }
}
