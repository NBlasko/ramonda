import { Component, Host, Head, AsyncLoad } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { Link } from "./routes";
import type { PageMeta } from "./content-types";
import { pageLoaders } from "./generated/page-loaders";
import { pagePreloads } from "./generated/preloads";

interface DocPageProps {
  meta: PageMeta;
  notFound?: boolean;
}

/**
 * One documentation page: its metadata, and its content loaded as its own chunk.
 *
 * ## Why the content is lazy
 *
 * It used to be imported eagerly, so every visitor downloaded every page on the
 * site — 511 KB of client bundle at 44 pages, growing linearly with nothing to
 * stop it. Now each page is a chunk, fetched when it is first needed.
 *
 * On a prerendered site that costs the reader **nothing visible**, and this page
 * is the proof of the whole chain:
 *
 * - the server awaits the import and writes the content into the HTML;
 * - `preload` puts a `<link rel="modulepreload">` in `<head>`, so the browser
 *   fetches the chunk in parallel with the main bundle rather than after it;
 * - `AsyncLoad` defers hydration, so the client adopts the server's markup
 *   instead of replacing it with the loading fallback.
 *
 * The documentation site running its own documented features at its own scale.
 *
 * ## Why `Head` is here rather than on the layout
 *
 * This is the component that KNOWS the title. A layout could only ever set a
 * site-wide default, which is the thing that makes every page in a docs site
 * compete with itself in search results.
 */
@Host("article")
export class DocPage extends Component<DocPageProps> {
  head = this.use(Head, (self: DocPage) => ({
    title: self.props.notFound
      ? "Not found — Ramonda"
      : self.props.meta.path === "/"
        ? self.props.meta.title
        : `${self.props.meta.title} — Ramonda`,
    description: self.props.meta.description,
  }));

  render(): RamondaNode {
    if (this.props.notFound) {
      // `data-pagefind-ignore` keeps this out of the search index — it is the one
      // page whose content should never come back as a result. It renders inside
      // the normal shell, so the masthead, sidebar and search are all live: a
      // reader who lands here can navigate straight out.
      return (
        <div className="notfound" data-pagefind-ignore>
          <h1>Page not found</h1>
          <p>That page does not exist — it may have moved, or the link that brought you here was mistyped.</p>
          <p>
            <Link href="/">← Back to the documentation home</Link>
          </p>
        </div>
      );
    }

    const path = this.props.meta.path;
    return (
      <AsyncLoad
        cacheKey={`page:${path}`}
        lazy={pageLoaders[path]}
        namedExport="Page"
        preload={pagePreloads[path]}
        onLoading={<div className="page-loading" />}
        errorFallback={({ retry }) => (
          <p className="demo-error">
            This page could not be loaded.{" "}
            <button type="button" onclick={retry}>
              retry
            </button>
          </p>
        )}
      />
    );
  }
}
