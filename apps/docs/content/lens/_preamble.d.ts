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
    /** Optional on purpose — the create-on-write examples write where nothing is yet. */
    labels?: string[];
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
  /** A post to add — the sharing page pushes it, correctly and incorrectly. */
  const newPost: Post;
  /** The same post, corrected — what a `set` is handed when it means "this one, updated". */
  const edited: Post;
  /** A DIFFERENT post — what the same call means when it does not. */
  const otherPost: Post;
  /** A post rebuilt from scratch, every field possibly new: the case `SAME_ITEM` is for. */
  const fromTheForm: Post;
  /** What an update returns — the same shape, with the untouched parts identical. */
  const next: BlogState;
}
