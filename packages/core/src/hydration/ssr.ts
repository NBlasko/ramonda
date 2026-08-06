import { mountNode } from "../core/DiffAndMerge";
import { ServerRedirect } from "./serverRedirect";
import { setRenderEnv } from "../core/renderEnv";
import { flushTaskQueue } from "../core/Task";
import { serializeComponentToJSON } from "./serialize";
import { STATE_ATTR, HEAD_ATTR, REQUEST_ATTR } from "../helpers/constants";
import { flushPostCommit } from "../core/commit";
import { resetHeadRegistry } from "../base/Head";
import {
  createServerWork,
  finishServerWork,
  setServerWorkCollector,
  takeServerWork,
  type ServerWork,
} from "../core/serverWork";
import type { ComponentChild } from "../types/vdom";
import {
  collectExposedRequest,
  createRequestScope,
  getBuildRead,
  RequestReadDuringBuild,
  setRequestScope,
} from "./requestContext";

/** What `createRequestScope` hands back — opaque here; only requestContext.ts reads inside it. */
type RequestScopeHandle = ReturnType<typeof createRequestScope> | undefined;

/**
 * How many times a server render will wait for async work before giving up.
 *
 * Deliberately small, and much smaller than the render-loop bounds elsewhere in
 * the framework, because these are **network round trips** rather than renders.
 * A page needing ten sequential ones has a waterfall — one fetch whose result
 * decides the next — and that is a problem to surface, not one to absorb into a
 * response time nobody can explain.
 */
const MAX_SERVER_ROUNDS = 10;

/**
 * Waits for everything the render started, and for everything THAT starts.
 *
 * One pass is not enough: a resolved fetch writes state, which schedules a
 * render, which builds components, whose `@mount`s fetch again. So it alternates
 * — settle the renders already scheduled, take whatever async work they queued,
 * await it, commit — until a round produces nothing new.
 *
 * `allSettled`, not `all`: a failed fetch is one component's problem to render,
 * and must not cost the page. The rejection still surfaces wherever the app
 * awaited it, and `errorFallback`-style UI renders on the next round.
 */
async function drainServerWork(work: ServerWork): Promise<void> {
  for (let round = 0; round < MAX_SERVER_ROUNDS; round++) {
    // Renders scheduled by the last batch, and the mounts they queue — which is
    // where the next round's work gets registered.
    await flushTaskQueue();

    // A guard already decided this request is going elsewhere; the page about to
    // be built will be thrown away for a 302, so stop draining work for it.
    if (work.redirect !== undefined) return;

    const pending = takeServerWork(work);
    if (pending.length === 0) return;

    await Promise.allSettled(pending);
    flushPostCommit();
  }

  throw new Error(
    `[Ramonda] renderToString gave up after ${MAX_SERVER_ROUNDS} rounds of async work: ` +
      `every time it waited, the result started more. That is a fetch waterfall — a request whose ` +
      `response decides the next — and it has to be flattened in the app, because the server cannot ` +
      `know how deep it goes. Load what a page needs in one place and pass it down, rather than ` +
      `letting each component fetch what the one above it just learned.`,
  );
}

/** Stamps each carrier element with its component's serialized state blob. */
function stampBlobs(node: Node): void {
  const el = node as { _componentInstance?: object } & Element;
  if (el._componentInstance && typeof el.setAttribute === "function") {
    el.setAttribute(STATE_ATTR, serializeComponentToJSON(el._componentInstance));
  }
  node.childNodes.forEach(stampBlobs);
}

/**
 * Renders an app to an HTML string on the server (under a DOM shim). Runs
 * `server` + `shared` lifecycle (skips `client`), never runs effects, drains
 * pending updates, then stamps each carrier with its state blob so the client
 * can restore it via `hydrateRoot`.
 *
 * The returned markup has NO inter-node whitespace (built via createElement),
 * which is what keeps hydration's position matching aligned.
 *
 * It does NOT preserve text-node boundaries — `<span>Hello {name}!</span>` is
 * three text nodes here but serializes to one run of characters, and parsing it
 * back yields a single node. Rather than spend bytes on separator comments the
 * way React does, hydration splits the run apart again; see hydrateText.
 */
/** Per-request data for a server render, so `requestContext()` returns real values. */
export interface ServerRequestInit {
  /** The request URL — also what the router reads as the current page. */
  url: URL;
  /** Request cookies. */
  cookies?: Map<string, string>;
  /** Request headers. */
  headers?: Headers;
  /** Pre-resolved per-request values keyed by a `requestKey`'s label — e.g. the signed-in user. */
  values?: Map<string, unknown>;
}

export interface RenderToStringOptions {
  /** When present, this render is per-request: `requestContext()` reads return these values. */
  request?: ServerRequestInit;
}

export async function renderToString(vnode: ComponentChild, opts?: RenderToStringOptions): Promise<string> {
  const container = document.createElement("div");

  // The module-level env is only live across this synchronous mount — no await
  // in between, so no other render can observe or clobber it. Every component
  // created here records "server" on its own runtime and passes it to its
  // children, so the updates drained below stay on the server side even though
  // the flag is already back to "client". See renderEnv.ts.
  // One collector per render, reached by every component in it through the same
  // inheritance `env` uses. Not a module-level list: two concurrent requests
  // must not wait on — or serialize — each other's work. See core/serverWork.ts.
  const work = createServerWork();

  // A per-request render (`opts.request`) makes `requestContext()` return real values. Set
  // ONLY for the synchronous section — the same window, and the same concurrency reasoning, as
  // `renderEnv`: two concurrent requests must not share it across an `await`. So the rule is
  // read `requestContext()` SYNCHRONOUSLY (in render / @create / before the first `await` in an
  // @mount) — after a yield the scope is already cleared. `renderStatic` passes no `opts` and
  // manages its own build-mode scope (kept live across the sequential build), so this leaves it
  // untouched.
  const request = opts?.request;
  const requestScope = request
    ? createRequestScope({
        mode: "server",
        url: request.url,
        cookies: request.cookies,
        headers: request.headers,
        values: request.values,
      })
    : undefined;
  if (requestScope) setRequestScope(requestScope);

  setRenderEnv("server");
  setServerWorkCollector(work);
  try {
    mountNode(vnode, undefined, container);
    // Inside the server env, and before the task drain: a server @mount may
    // write state, and those updates must be drained before serializing — which
    // is exactly what flushTaskQueue below is for.
    flushPostCommit();
  } finally {
    setRenderEnv("client");
    setServerWorkCollector(undefined);
    if (request) setRequestScope(undefined);
  }

  try {
    await drainServerWork(work);
  } finally {
    // Whether it drained or gave up: this render is over, so anything still in
    // flight must not schedule renders into a tree that will never be served.
    finishServerWork(work);
  }

  // A guard asked to send the request elsewhere. The markup built above is for the
  // wrong URL, so it is discarded: throw instead of returning it, and let the
  // server boundary translate that into a redirect response. See serverRedirect.ts.
  if (work.redirect !== undefined) {
    throw new ServerRedirect(work.redirect);
  }

  stampBlobs(container);
  stampExposedRequest(container, requestScope);
  return container.innerHTML;
}

/**
 * Puts the values the server chose to EXPOSE on the root element, so the browser can read them
 * back through `requestContext()`. One blob per page — a request is one thing, not a per-component
 * one — and it carries only keys declared with `exposeToClient`. Nothing is written when nothing
 * opted in, which is the default.
 *
 * It rides an attribute for the same reason the state blob does: attribute serialization escapes
 * the value, so there is no way for the content to break out into markup.
 */
function stampExposedRequest(container: HTMLElement, scope: RequestScopeHandle): void {
  const exposed = collectExposedRequest(scope);
  if (!exposed) return;
  container.firstElementChild?.setAttribute(REQUEST_ATTR, JSON.stringify(exposed));
}

/** The outcome of a static (build-time) render: markup to bake, or the reason it can't be. */
export interface StaticRender {
  /** The baked HTML — present only when the route read nothing per-request. */
  html?: string;
  /**
   * Set when the render touched per-request data (a cookie, a header, a seeded value), naming
   * the field. The route CANNOT be prerendered — bake it and one visitor's data would be served
   * to everyone — so the build must fail or fall the route back to per-request rendering.
   */
  blockedBy?: string;
}

/**
 * Renders a route at BUILD time with the request context POISONED: any per-request read is
 * recorded (and throws), so the result reports `blockedBy` instead of markup. This is what
 * PROVES a baked page holds no per-request data.
 *
 * It keeps the poisoned scope live across the whole render — including the async drain — which
 * is safe ONLY because a build is SEQUENTIAL (one page at a time). Do NOT use it to serve
 * concurrent requests: a live request would race the module-level scope. Point `url` at the
 * path being baked (it stays readable — the URL is the page identity, not per-request data).
 */
export async function renderStatic(vnode: ComponentChild, url: URL): Promise<StaticRender> {
  const scope = createRequestScope({ mode: "build", url });
  setRequestScope(scope);
  try {
    const html = await renderToString(vnode);
    // A read inside an async @mount throws into the drain's allSettled and is swallowed, so the
    // recorded field — not the throw — is the authority here.
    const blockedBy = getBuildRead(scope);
    return blockedBy !== undefined ? { blockedBy } : { html };
  } catch (e) {
    // A synchronous read (render / @create / sync @mount) throws straight out.
    if (e instanceof RequestReadDuringBuild) return { blockedBy: e.field };
    throw e; // a ServerRedirect or a genuine error is the caller's to handle.
  } finally {
    setRequestScope(undefined);
  }
}

/** What one page's render produced: its body, and the head that goes with it. */
export interface RenderedPage {
  /** The app's markup, exactly what `renderToString` returns. */
  body: string;
  /** The `<title>` text. Empty when no `Head` hook set one. */
  title: string;
  /** Serialized `<meta>` / `<link>` tags, ready to drop into a `<head>`. */
  head: string;
}

/**
 * Renders one page: the body, plus whatever the tree's `Head` hooks put in the
 * document head.
 *
 * This is the entry point a static build wants. `renderToString` returns the app
 * markup alone, which is enough to hydrate but not enough to *rank* — a set of
 * pages sharing one title and no description competes with itself in search, and
 * the crawlers that do not run JavaScript (which is most of them, including the
 * ones feeding AI assistants) see only what is in the served HTML.
 *
 * **The head is reset on both sides of the render, and they do different jobs.**
 * `Head` writes into the real `document.head`, and a build loop renders many
 * pages into one DOM, so something has to keep page two from inheriting page
 * one's tags.
 *
 * - The reset **after** is what does that in a `renderPage` loop.
 * - The reset **before** makes one call independent of everything else that has
 *   touched the head. Measured: a bare `renderToString` leaves its tags behind
 *   (it has no reset of its own), so a `renderToString` followed by a
 *   `renderPage` would otherwise ship the first page's description on the second.
 *
 * A render that **throws** needs neither, which was worth measuring rather than
 * assuming: the failed-build teardown runs the tree's `@destroy` callbacks, and
 * `Head`'s removes its own tags — so after a thrown render the head is already
 * empty and the title already restored. An earlier version of this comment
 * claimed the before-reset was what covered that case. It is not.
 */
export async function renderPage(vnode: ComponentChild): Promise<RenderedPage> {
  resetHead();

  try {
    const body = await renderToString(vnode);

    const tags = Array.from(document.head.querySelectorAll(`[${HEAD_ATTR}]`));
    return {
      body,
      title: document.title,
      head: tags.map((tag) => tag.outerHTML).join(""),
    };
  } finally {
    // Cleared once the markup is safely captured — and in a `finally` so a render
    // that redirects (a thrown `ServerRedirect`, whose tree was NOT torn down and
    // so left its head tags behind) does not leak them into the next request. The
    // reset above is the one that guarantees correctness; this keeps a long-lived
    // server process from carrying a rendered page's tags between requests.
    resetHead();
  }
}

/** Clears the tags a previous `Head` left behind, and the title with them. */
function resetHead(): void {
  for (const tag of Array.from(document.head.querySelectorAll(`[${HEAD_ATTR}]`))) {
    tag.remove();
  }
  document.title = "";
  // The registry goes with the tags: it holds the elements just removed and the
  // title to go back to, both of which belong to the request that is ending.
  resetHeadRegistry();
}
