import { Component, bootstrap } from "@ramonda/core";

declare function __h(tag: unknown, props: unknown, ...children: unknown[]): never;

interface Parsed {
  t: string;
}
declare const node: Parsed;
declare const level: 1 | 2;
declare const loose: any;
declare const either: string | typeof Component;
declare const unknownTag: unknown;
declare function headingTag(): "h1" | "h2" | "h3";

class App extends Component {
  render() {
    const Heading = level === 1 ? "h1" : "h2";
    const Chosen = headingTag();
    return (
      <div>
        {__h(node.t, null)}
        {__h(headingTag(), null)}
        <Heading>title</Heading>
        <Chosen>title</Chosen>
        {__h(loose, null)}
        {__h(either, null)}
        {__h(unknownTag as never, null)}
      </div>
    );
  }
}

bootstrap(<App />, document.body);
