/**
 * The serialized shape of a rendered markdown page.
 *
 * Short keys on purpose: this tree ships in the client bundle for every page on
 * the site, and `t`/`a`/`c` against `tag`/`attributes`/`children` is a few
 * percent of the payload for no loss of clarity — the type says what they mean.
 */
export type ContentNode =
  | string
  | {
      /** Tag name, or `"demo"` for a live example resolved from the registry. */
      t: string;
      /** Attributes, already renamed for JSX (`class` → `className`). */
      a?: Record<string, string>;
      c?: ContentNode[];
    };

/**
 * A page's metadata, without its content.
 *
 * Separate from the content on purpose: this is what the route table and the
 * sidebar need, and it is small enough that every visitor can have all of it.
 * The trees are one chunk per page — see scripts/build-content.mjs.
 */
export interface PageMeta {
  /** Route path: `/`, `/guide/installation`. */
  path: string;
  /** `<title>` and sidebar label. Required — the build fails without it. */
  title: string;
  /** `<meta name="description">`. */
  description: string;
  /** Sidebar grouping. Empty means top level. */
  section: string;
  /** Sort order within a section. */
  order: number;
}
