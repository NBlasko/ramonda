import { Component, list, state } from "@ramonda/core";
import type { RamondaNode, VNode } from "@ramonda/core";
import { Router, RouteOutlet } from "@ramonda/router";
import { Navigator, Link, routes, pages } from "./routes";
import { Search } from "./Search";

interface SidebarProps {
  /** Called when a link inside is clicked, so the mobile drawer can close. */
  onNavigate?: () => void;
}

/**
 * Sidebar entries grouped by their frontmatter `section`.
 *
 * A page may opt out with `nav: false`, and 158 of them do — the generated rules and diagnostics.
 * They are reached from their index, from a report that named one, or from search; nobody scrolls a
 * list of 158 names looking for `RMD047`. Measured while they were still listed: the sidebar was
 * **83% of every page's HTML**, repeated across all 252 pages.
 */
const grouped = (() => {
  const groups = new Map<string, (typeof pages)[number][]>();
  for (const page of pages) {
    // `in` rather than a property read: `pages` is `as const`, so the union's members only carry
    // the keys they were written with, and most were written without this one.
    if ("nav" in page && page.nav === false) continue;
    const key = page.section || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(page);
  }
  return [...groups.entries()];
})();

class Sidebar extends Component<SidebarProps> {
  route = this.use(Navigator);

  /**
   * On mobile the sidebar is a drawer over the page, so a followed link has to
   * close it. Delegated here rather than on each `Link` — one handler, and it
   * only fires when the click landed on an actual link, not the padding.
   */
  onClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest("a")) this.props.onNavigate?.();
  }

  /** The drawer's explicit dismiss — shown only at the mobile breakpoint. */
  close(): void {
    this.props.onNavigate?.();
  }

  renderPage(page: (typeof pages)[number]): VNode {
    return (
      <li>
        <Link href={page.path} className={this.route.pathname === page.path ? "link active" : "link"}>
          {page.title}
        </Link>
      </li>
    );
  }

  /**
   * Whether the page being read is in this group — which is the one that opens.
   *
   * The second test is for the pages the sidebar does NOT list: a reader on
   * `/rules/row-without-a-key` should find Reference open, because `/rules` is the entry that
   * would have taken them there. Without it the accordion is shut on exactly the pages a reader
   * most needs to get out of.
   */
  holdsTheReader(items: readonly { path: string }[]): boolean {
    const here = this.route.pathname;
    return items.some((page) => here === page.path || here.startsWith(`${page.path}/`));
  }

  /**
   * A group is `<details>`, and that is a decision rather than a default.
   *
   * The links inside a CLOSED one are still in the HTML, so a crawler reaches every page whatever
   * the reader has open — which a sidebar that drew its items on click would not. It is also the
   * accessible control for this without writing one: a summary is a button, it takes the keyboard,
   * and it announces its own state.
   */
  renderGroup([section, items]: (typeof grouped)[number]): VNode {
    if (!section) {
      return (
        <div className="sidebar-group">
          <ul>{list(items, this.renderPage)}</ul>
        </div>
      );
    }
    return (
      <details className="sidebar-group" open={this.holdsTheReader(items)}>
        <summary>{section}</summary>
        <ul>{list(items, this.renderPage)}</ul>
      </details>
    );
  }

  render(): RamondaNode {
    return (
      <nav>
        <button type="button" className="drawer-close" onclick={this.close} aria-label="Close navigation">
          ✕
        </button>
        <div className="sidebar-inner" data-pagefind-ignore onclick={this.onClick}>
          {list(grouped, this.renderGroup)}
        </div>
      </nav>
    );
  }
}

/**
 * The site shell.
 *
 * `Router` is a hook on the root, so the shell stays a single element and the
 * sidebar — which sits BESIDE the outlet, not inside it — keeps its state across
 * navigation instead of being rebuilt on every route change.
 */
export class App extends Component {
  router = this.use(Router);

  /** Drawer state. Only meaningful below the layout breakpoint (see site.css). */
  @state menuOpen = false;

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  render(): RamondaNode {
    return (
      <div>
        <div className="layout">
          <header className="masthead" data-pagefind-ignore>
            <button
              type="button"
              className="nav-toggle"
              onclick={this.toggleMenu}
              aria-label="Toggle navigation"
              aria-expanded={this.menuOpen ? "true" : "false"}
            >
              ☰
            </button>
            <Link href="/" className="brand">
              <img className="brand-mark" src="/favicon.svg" width="24" height="24" alt="" />
              Ramonda
            </Link>
            <Search />
          </header>
          <div className={this.menuOpen ? "body nav-open" : "body"}>
            <Sidebar onNavigate={this.closeMenu} />
            {/*
              `data-pagefind-body` scopes the search index to the article. Without
              it Pagefind indexes the whole page, so every result would match on
              the sidebar — which lists all 46 page titles and is identical on
              every page.
            */}
            <main className="content" data-pagefind-body>
              <RouteOutlet routes={routes} />
            </main>
            {/* Tap-outside to dismiss the drawer; only rendered while it is open. */}
            {this.menuOpen ? <div className="sidebar-backdrop" onclick={this.closeMenu} /> : null}
          </div>
        </div>
      </div>
    );
  }
}
