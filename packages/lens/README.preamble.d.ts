// The shape the lens examples walk, the same one the docs pages use.
export {};

declare global {
  interface Post {
    id: number;
    title: string;
    draft: boolean;
    tags: string[];
    /** Optional on purpose — the create-on-write example writes into an array that is not there yet. */
    labels?: string[];
    author: { name: string; city?: string };
  }
  interface BlogState {
    posts: Post[];
    home: { city: string };
    /** A class instance on purpose — the README's point is that it survives the update. */
    settings: { theme: string; describe(): string };
    profile: { name: string; city: string };
    /** Mixed on purpose — the narrowing example proves one element is a string. */
    values: unknown[];
    users: { id: number; name: string; profile: { name: string } }[];
  }
  const state: BlogState;
  /** The reader's own diagnostics collector — a devtools panel, a test, a log shipper. */
  const myCollector: { alert(record: unknown): void };
  /** A different value, for the `set` that replaces rather than corrects. */
  const other: any;
  /** The same value rebuilt — what `keepSymbols` is told about. */
  const rebuilt: any;
  /** The reader's OWN hidden symbol, the one they ask to keep by name. */
  const MINE: unique symbol;
  /** What an update returns — the same shape, with the untouched parts identical. */
  const next: BlogState;
}
