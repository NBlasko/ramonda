import { Component, Host, state } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { Router, RouteOutlet, RouteHook, Link } from "@ramonda/router";
import { routes, pages } from "./routes";
import { Search } from "./Search";

interface SidebarProps {
  /** Called when a link inside is clicked, so the mobile drawer can close. */
  onNavigate?: () => void;
}

/** Sidebar entries grouped by their frontmatter `section`. */
const grouped = (() => {
  const groups = new Map<string, (typeof pages)[number][]>();
  for (const page of pages) {
    const key = page.section || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(page);
  }
  return [...groups.entries()];
})();

@Host("nav")
class Sidebar extends Component<SidebarProps> {
  route = this.use(RouteHook);

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

  render(): RamondaNode {
    return [
      <button type="button" className="drawer-close" onClick={this.close} aria-label="Close navigation">
        ✕
      </button>,
      <div className="sidebar-inner" data-pagefind-ignore onClick={this.onClick}>
        {grouped.map(([section, items]) => (
          <div className="sidebar-group">
            {section ? <h4>{section}</h4> : null}
            <ul>
              {items.map((page) => (
                <li>
                  <Link href={page.path} className={this.route.pathname === page.path ? "link active" : "link"}>
                    {page.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>,
    ] as RamondaNode;
  }
}

/**
 * The site shell.
 *
 * `Router` is a hook on the root, so the shell stays a single element and the
 * sidebar — which sits BESIDE the outlet, not inside it — keeps its state across
 * navigation instead of being rebuilt on every route change.
 */
@Host("div")
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
      <div className="layout">
        <header className="masthead" data-pagefind-ignore>
          <button
            type="button"
            className="nav-toggle"
            onClick={this.toggleMenu}
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
          {this.menuOpen ? <div className="sidebar-backdrop" onClick={this.closeMenu} /> : null}
        </div>
      </div>
    );
  }
}
