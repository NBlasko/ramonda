import { Component, Host, bootstrap } from "../framework";

declare const generated: string;

/**
 * The same project with ONE id this cannot read, which silences the whole family.
 *
 * A separate fixture rather than a case in the other one, because the claim is about the project
 * and a project has exactly one answer to it. An author writing `id={generated}` has said their ids
 * are built at runtime, and "nothing carries this id" stops being something anybody can prove.
 */
@Host("div")
class App extends Component {
  render() {
    return (
      <div>
        <div id={generated} />
        {/* Would be reported in any project whose ids are all readable. Here: nothing. */}
        <a href="#nowhere-at-all">Go</a>
        <label htmlFor="nothing-like-it">Name</label>
      </div>
    );
  }
}

bootstrap(<App />, null);
