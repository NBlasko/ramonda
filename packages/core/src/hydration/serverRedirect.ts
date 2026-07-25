import { getServerWorkCollector } from "../core/serverWork";

/**
 * Thrown by `renderToString` when the render asked to redirect the request rather
 * than produce a page — most often a route guard sending an unauthenticated
 * visitor somewhere else.
 *
 * It is a control-flow signal, not a failure: catch it at the server boundary
 * (an entry-server, say) and answer the request with a redirect status and a
 * `Location: <url>`. Left uncaught it behaves like any other throw and surfaces
 * as a 500 — which is the right outcome if nobody translated it, because a
 * redirect that never reached the transport is a bug.
 *
 * Why a throw and not a return value: a redirect is the render's *alternative*
 * outcome, and modelling it as an exception keeps the ordinary
 * `const html = await renderToString(...)` path free of a result wrapper every
 * caller would otherwise have to unpack. See `hydration/ssr.ts`.
 */
export class ServerRedirect extends Error {
  /** Where to send the request. */
  readonly url: string;
  /** The HTTP status to answer with. 302 (temporary) by default. */
  readonly status: number;

  constructor(url: string, status = 302) {
    super(`[Ramonda] Server render requested a redirect to ${url}`);
    this.name = "ServerRedirect";
    this.url = url;
    this.status = status;
  }
}

/**
 * Grabs a handle to *this* server render's redirect slot, or `undefined` when
 * there is no server render in progress — i.e. on the client, where navigation
 * just changes the URL and re-renders as usual.
 *
 * Call it once, synchronously, while the tree is being built (a field initializer
 * on a root-level hook is the intended spot): the returned function closes over
 * the render's own `ServerWork`, so it keeps working even when it is finally
 * called from an `async` `@mount` long after the synchronous mount window closed.
 *
 * First writer wins — a second redirect request in the same render is ignored, so
 * the earliest guard to fire decides where the request goes.
 */
export function captureServerRedirect(): ((url: string) => void) | undefined {
  const collector = getServerWorkCollector();
  if (!collector) return undefined;

  return (url: string) => {
    if (!collector.done && collector.redirect === undefined) {
      collector.redirect = url;
    }
  };
}
