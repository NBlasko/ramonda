import { Component, bootstrap } from "@ramonda/core";

declare function t(key: string): string;

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ An inline icon that MEANS something, announced as an image with no name. */}
        <svg role="img" />

        {/* ✗ The same on any tag: `alt` does not exist there, so nothing can fall back. */}
        <div role="img" />

        {/* ✓ Named, which is the only way for these two. */}
        <svg role="img" aria-label="A cat" />
        <div role="img" aria-labelledby="caption" />
        <span role="img" title="A cat" />

        {/* ✓ A name this cannot READ is somebody naming it. */}
        <svg role="img" aria-label={t("cat")} />

        {/* ✓ A decorative icon says so, and is not an image in the tree at all. */}
        <svg aria-hidden="true" />

        {/* ✓ No role: an `<svg>` on its own is not declared to be anything. */}
        <svg />

        {/* ✓ The tag-based half is unchanged. */}
        <img src="/x.png" alt="A cat" />
        <img src="/x.png" />
      </div>
    );
  }
}

bootstrap(<App />, null);
