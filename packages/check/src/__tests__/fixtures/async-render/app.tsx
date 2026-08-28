import { Component, Host, bootstrap, fetch } from "@ramonda/core";

/**
 * `async render()`, in both spellings, beside the shapes that are correct.
 *
 * The fixture writes them without a cast because `framework.ts` declares `render(): unknown` — the
 * point of the rule is not that the type refuses it, it is that a `@ts-ignore` or a loosened base
 * class gets past a type that does. The rule reads the `async` keyword and nothing else.
 */
class Feed extends Component {
  /* REPORTED — the method spelling. */
  async render() {
    const rows = await fetch("/api/rows");
    return (
      <div>
        <ul>{String(rows)}</ul>
      </div>
    );
  }
}

@Host("div")
class Sidebar extends Component {
  /* REPORTED — the field spelling, which is the one an inferred type is likelier to wave through. */
  render = async () => {
    const rows = await fetch("/api/rows");
    return <aside>{String(rows)}</aside>;
  };
}

class Panel extends Component {
  /* Not reported: an async method that is not the render. */
  async load() {
    return fetch("/api/rows");
  }
  /* Not reported: an ordinary render, which is every render there is. */
  render() {
    return (
      <div>
        <div>fine</div>
      </div>
    );
  }
}

bootstrap(<Feed />, null);
bootstrap(<Sidebar />, null);
bootstrap(<Panel />, null);
