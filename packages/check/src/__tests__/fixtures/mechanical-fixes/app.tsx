import { Component, bootstrap } from "@ramonda/core";

const NO = "false";

/** A component that declares a `class` prop, which is why the rename cannot be applied at a call site. */
class Panel extends Component<{ class?: string }> {
  render() {
    return null;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        {/* ✎ FIXED — one answer, and `className` is the one word this framework reads. */}
        <div class="card">rename</div>
        {/* ✗ reported, ✎ NOT fixed — which of the two they meant to keep is not written down. */}
        <div class="a" className="b">
          ambiguous
        </div>
        {/* ✗ reported, ✎ NOT fixed — the rename reaches the PROP, and that is another file. */}
        <Panel class="x" />

        {/* ✎ FIXED — a name HTML spells with a dash. */}
        <meta httpEquiv="refresh" />
        {/* ✗ reported, ✎ NOT fixed — "put it in the children" is a shape, not a span. */}
        <div innerHTML="<b>x</b>">no name to write instead</div>

        {/* ✎ FIXED — the right name in the wrong case, and SVG does not lowercase it for you. */}
        <svg aria-labelledBy="h" role="img" aria-label="x" />
        {/* ✗ reported, ✎ NOT fixed — one edit from a real name is a GUESS, and says so. */}
        <span aria-requred="true">a guess</span>

        {/* ✎ FIXED — the boolean is what removes the attribute, which is how HTML turns one off. */}
        <button type="button" disabled="false">
          Save
        </button>
        {/* ✗ reported, ✎ NOT fixed — the answer is somewhere else in the file. */}
        <input type="text" aria-label="A" required={NO} />
      </div>
    );
  }
}

bootstrap(<App />, null);
