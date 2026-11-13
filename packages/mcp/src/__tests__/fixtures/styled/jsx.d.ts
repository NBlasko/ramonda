declare namespace JSX {
  interface IntrinsicElements {
    div: { id?: string; className?: string; children?: unknown };
  }
  interface Element {
    readonly _brand: unique symbol;
  }
}
