import { Component } from "../framework";

/**
 * The app's OWN function, carrying the framework's exact name — which is the only way to test that
 * identity comes from the import specifier rather than from the name. It is in its own file
 * because the page beside it imports the real one, and two bindings cannot share a name.
 */
function requestContext() {
  return { get: (key: unknown) => String(key) };
}

declare function fetchPosts(): Promise<string[]>;

export class OwnHelper extends Component {
  async load() {
    await fetchPosts();
    console.log(requestContext().get("anything"));
  }
  render() {
    return <p>own</p>;
  }
}
