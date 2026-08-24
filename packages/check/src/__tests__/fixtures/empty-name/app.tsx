import { Component, Host, bootstrap } from "@ramonda/core";

declare function t(key: string): string;

@Host("div")
class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ An empty `aria-labelledby` names nothing, and used to answer for the name it lacks. */}
        <input type="text" aria-labelledby="" />

        {/* ✗ The same for the other two spellings. */}
        <input type="text" aria-label="" />
        <input type="text" title="" />

        {/* ✗ Whitespace is not a name either. */}
        <input type="text" aria-label="   " />

        {/* ✓ A name this cannot READ is somebody naming it. */}
        <input type="text" aria-label={t("email")} />

        {/* ✓ A real name. */}
        <input type="text" aria-label="Email" />

        {/* ✓ Named the ordinary way. */}
        <label htmlFor="phone">Phone</label>
        <input id="phone" type="text" />
      </div>
    );
  }
}

bootstrap(<App />, null);
