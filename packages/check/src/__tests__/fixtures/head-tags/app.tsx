import { bootstrap, Component, Head } from "@ramonda/core";
import { OwnHead } from "./own-head";

/** Two `<meta name="robots">` in one call. The second wins and the first never reaches the page. */
export class TwoOfTheSameName extends Component {
  head = this.use(Head, () => ({
    meta: [
      { name: "robots", content: "index,follow" },
      { name: "robots", content: "noindex" },
    ],
  }));
  render() {
    return <p>robots</p>;
  }
}

/** The `description` shorthand and a `meta` that resolves to the same tag. */
export class ShorthandAndMeta extends Component {
  head = this.use(Head, () => ({
    description: "What the page is about.",
    meta: [{ name: "description", content: "Something else entirely." }],
  }));
  render() {
    return <p>described</p>;
  }
}

/** `property`, which is how Open Graph is written, and the same collision. */
export class TwoOfTheSameProperty extends Component {
  head = this.use(Head, () => ({
    meta: [
      { property: "og:title", content: "First" },
      { property: "og:title", content: "Second" },
    ],
  }));
  render() {
    return <p>og</p>;
  }
}

/** `httpEquiv`, the third identity. */
export class TwoOfTheSameHttpEquiv extends Component {
  head = this.use(Head, () => ({
    meta: [
      { httpEquiv: "content-security-policy", content: "default-src 'self'" },
      { httpEquiv: "content-security-policy", content: "default-src *" },
    ],
  }));
  render() {
    return <p>csp</p>;
  }
}

/** A `<link>` is identified by `rel` AND `href`, so these two are one tag and one loses its size. */
export class TwoOfTheSameLink extends Component {
  head = this.use(Head, () => ({
    link: [
      { rel: "icon", href: "/icon.png", sizes: "16x16" },
      { rel: "icon", href: "/icon.png", sizes: "32x32" },
    ],
  }));
  render() {
    return <p>icons</p>;
  }
}

/** The options written as a factory, which is the other documented spelling. */
export class ThroughAFactory extends Component {
  head = this.use(Head, () => ({
    meta: [
      { name: "robots", content: "index" },
      { name: "robots", content: "noindex" },
    ],
  }));
  render() {
    return <p>factory</p>;
  }
}

// ── everything below is CORRECT and must stay silent ─────────────────────────────────────────

/** Different names. The ordinary case, and by far the commonest. */
export class AllDifferent extends Component {
  head = this.use(Head, () => ({
    title: "A page",
    description: "About the page.",
    meta: [
      { name: "robots", content: "index" },
      { property: "og:title", content: "A page" },
      { property: "og:description", content: "About the page." },
    ],
    link: [
      { rel: "canonical", href: "/a" },
      { rel: "icon", href: "/icon.png", sizes: "16x16" },
      { rel: "icon", href: "/icon-large.png", sizes: "32x32" },
    ],
  }));
  render() {
    return <p>fine</p>;
  }
}

/**
 * `name` and `property` never collide even when they spell the same word — they are two different
 * attributes, and the document holds both.
 */
export class SameWordDifferentAttribute extends Component {
  head = this.use(Head, () => ({
    meta: [
      { name: "title", content: "A page" },
      { property: "title", content: "A page" },
    ],
  }));
  render() {
    return <p>two attributes</p>;
  }
}

/**
 * Byte for byte the same tag written twice. One is dropped and NOTHING is lost, so this is
 * redundancy rather than a fault, and the rule stays quiet.
 */
export class IdenticalTwice extends Component {
  head = this.use(Head, () => ({
    meta: [
      { name: "robots", content: "noindex" },
      { name: "robots", content: "noindex" },
    ],
  }));
  render() {
    return <p>redundant</p>;
  }
}

/** A computed identity cannot be compared with anything, so neither tag is judged. */
export class ComputedName extends Component {
  which = "robots";
  head = this.use(Head, () => ({
    meta: [
      { name: this.which, content: "index" },
      { name: this.which, content: "noindex" },
    ],
  }));
  render() {
    return <p>computed</p>;
  }
}

/** A spread may carry the very attribute that decides the identity. */
export class SpreadInTheTag extends Component {
  extra = { content: "noindex" };
  head = this.use(Head, () => ({
    meta: [
      { name: "robots", content: "index" },
      { name: "robots", ...this.extra },
    ],
  }));
  render() {
    return <p>spread</p>;
  }
}

/** The list itself is a variable, so nothing here knows what is in it. */
export class ListFromAVariable extends Component {
  tags = [{ name: "robots", content: "index" }];
  head = this.use(Head, () => ({ meta: this.tags }));
  render() {
    return <p>opaque</p>;
  }
}

export class App extends Component {
  render() {
    return (
      <main>
        <TwoOfTheSameName />
        <ShorthandAndMeta />
        <TwoOfTheSameProperty />
        <TwoOfTheSameHttpEquiv />
        <TwoOfTheSameLink />
        <ThroughAFactory />
        <AllDifferent />
        <SameWordDifferentAttribute />
        <IdenticalTwice />
        <ComputedName />
        <SpreadInTheTag />
        <ListFromAVariable />
        <OwnHead />
      </main>
    );
  }
}

bootstrap(<App />, null);
