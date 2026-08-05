// The shape every lens example walks: a blog with posts, each with tags. Declared once, because the
// whole point of these pages is the PATH — `focusOn(state).get("posts").where(…)` — and a block that
// had to build the state first would bury it.
export {};

declare global {
  interface Post {
    id: number;
    title: string;
    draft: boolean;
    tags: string[];
    author: { name: string; city?: string };
  }
  interface BlogState {
    posts: Post[];
    home: { city: string };
    profile: { name: string; city: string };
    /** Mixed on purpose — the narrowing example proves one element is a string. */
    values: unknown[];
    users: { id: number; name: string; profile: { name: string } }[];
  }
  const state: BlogState;
  /** What an update returns — the same shape, with the untouched parts identical. */
  const next: BlogState;
}
