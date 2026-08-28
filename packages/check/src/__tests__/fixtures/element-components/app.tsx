import { Component, Select, TextArea, bootstrap } from "@ramonda/core";
import { Select as Chooser } from "@ramonda/core";

declare const value: string;

/*
  The holes this fixture reports are the FAKE framework's, not the rules': it declares `Select` and
  `TextArea` as consts, the way it declares everything, so the graph cannot follow them to a class.
  The real package declares them as classes and an application sees no hole. Element rules are not
  suppressed by one, which is what this fixture is here to measure.
*/

/** An application's OWN component of the same name is its own business. */
const TextArea2 = (props: { value: string }) => props.value;

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ Unlabelled, hidden while focusable, and a dead attribute name. */}
        <Select value={value} aria-hidden="true" httpEquiv="refresh">
          <option value="a">A</option>
        </Select>
        {/* ✗ The same, on the other one. */}
        <TextArea value={value} aria-hidden="true" httpEquiv="refresh" />
        {/* ✗ And core's, under an ALIAS — identity is the name core exports it under. */}
        <Chooser value={value} aria-hidden="true">
          <option value="a">A</option>
        </Chooser>

        {/* ✓ Named, and nothing else wrong with them. */}
        <Select value={value} aria-label="Pick one">
          <option value="a">A</option>
        </Select>
        <TextArea value={value} aria-label="Notes" />

        {/* ✓ An application's own component is not core's element. */}
        <TextArea2 value={value} />
      </div>
    );
  }
}

bootstrap(<App />, null);
