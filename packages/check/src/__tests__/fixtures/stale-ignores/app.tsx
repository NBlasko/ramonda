import { Component, bootstrap } from "@ramonda/core";

declare function open(): void;
declare const pages: Record<string, typeof Component>;

class App extends Component {
  render() {
    const Chosen = pages["/"];
    return (
      <div>
        {/* ramonda-check-ignore the keyboard path lands with the menu rewrite */}
        <div onclick={open}>Open</div>

        {/* ramonda-check-ignore a backdrop, which is not reported in the first place */}
        <div className="scrim" onclick={open} />

        <p>nothing here is reported</p>
        {/* ramonda-check-ignore left behind after the fix */}

        {/* ramonda-check-ignore the table is chosen at run time until the router owns it */}
        <Chosen />

        <p>{"// ramonda-check-ignore inside a string is text, not a directive"}</p>
        <p>{`/* ramonda-check-ignore inside a template is text too */`}</p>
      </div>
    );
  }
}

// ramonda-check-ignore a line comment over nothing
const unused = 1;

/* ramonda-check-ignore a block comment over nothing */
const alsoUnused = 2;

void unused;
void alsoUnused;

bootstrap(<App />, document.body);
