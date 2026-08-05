// The imaginary `@ramonda/sockets` package the "adding a tab" page teaches with: a library of your
// own that has state worth showing, and the values its rows are built from.
export {};

declare global {
  /** The value the inspector page opens in its tree. */
  interface Basket {
    total: number;
    items: { id: string; price: number }[];
  }
  /** The two halves of a tab, named in the prose above the block that registers one. */
  const snapshot: () => any;
  const run: (rowId: string, actionId: string) => string | undefined;

  const __DEV__: boolean;

  interface Socket {
    close(): void;
  }
  const sockets: Map<string, Socket>;
  const lastFrame: unknown;
  const frameCount: number;

  interface Line {
    id: string;
    text: string;
  }
}
