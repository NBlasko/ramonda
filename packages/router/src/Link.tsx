import { Component, onElement, Host } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { RouteConsumer } from "./Router";
import { buildUrl, parseUrlString, sanitizeHref } from "./urlUtils";
import type { StateUpdater } from "./types";

export interface LinkProps {
  href?: string;
  replace?: boolean;
  /** Scroll to the top after navigating. Default `true` — a link is a real
   * navigation. Pass `scroll={false}` for a link that swaps a view in place
   * (e.g. tabs partway down a long page). */
  scroll?: boolean;
  /**
   * Compute the target from route state. Evaluated AT RENDER, so it must be a
   * pure function of the state it reads — the value it returns becomes the
   * anchor's real `href`, and a left click goes to that same URL. Reading the
   * freshest state on click instead would let the two disagree.
   */
  stateResolver?: StateUpdater;
  className?: string;
  children?: RamondaNode;
}

/**
 * Which clicks we let the browser handle natively instead of intercepting:
 * modified clicks (open in new tab), pure `#anchor` links (but NOT our
 * `#key=value` router hashes), and external URLs.
 */
function shouldSkipIntercept(href: string, e: MouseEvent): boolean {
  if (e.button !== 0) return true; // not a plain left click
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return true; // new-tab intent
  if (href.startsWith("#")) return !href.includes("="); // pure anchor vs router hash
  if (href.startsWith("http://") || href.startsWith("https://")) return true;
  if (href.startsWith("//") || href.startsWith("mailto:")) return true;
  return false;
}

/**
 * Declarative navigation. The component's HOST element IS the `<a>` (via @Host),
 * so there's no wrapping template — a real anchor with a proper href (SEO /
 * middle-click / open-in-new-tab) whose plain left click routes through the
 * single `updateState` channel.
 */
@Host("a", (self: Link) => ({
  href: self.currentHref,
  className: self.props.className,
}))
export class Link extends Component<LinkProps> {
  private ctx = this.use(RouteConsumer);

  /**
   * The ONE destination this link names. Both the rendered `href` attribute and
   * the click handler read it, which is what keeps them from diverging — see the
   * note in onClick.
   *
   * Note `ctx.state` is only touched when there IS a stateResolver — the context
   * subscribes per key on read, so a plain `<Link href="/x">` never subscribes to
   * route state and never re-renders on navigation.
   */
  get currentHref(): string {
    return this.props.stateResolver
      ? buildUrl(this.props.stateResolver(this.ctx.state))
      : sanitizeHref(this.props.href ?? "/");
  }

  @onElement("click")
  private onClick(e: MouseEvent): void {
    // The RENDERED href — never `props.href`. Everything that can follow this
    // link has to name one destination: the `href` attribute (middle click,
    // open-in-new-tab, crawlers, SEO) and this handler. Reading the raw prop
    // here was how the two came apart, because `currentHref` sanitizes and this
    // did not — `href="evil.com/path"` rendered as "/" but a left click resolved
    // it against the current URL and navigated to "/evil.com/path".
    const href = this.currentHref;
    if (shouldSkipIntercept(href, e)) return; // let the browser do it

    e.preventDefault();
    this.ctx.nav.updateState(() => parseUrlString(href), {
      replace: this.props.replace,
      scroll: this.props.scroll !== false,
    });
  }

  render() {
    // The host <a> is the element; just place the children inside it.
    return this.props.children;
  }
}
