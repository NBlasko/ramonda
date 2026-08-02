import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RoutePlan } from "./server";

/**
 * The ISR cache — the piece that makes `revalidate: 60` mean the same thing on the second
 * server as on the first.
 *
 * ## Why this is not a `Map` in your server file
 *
 * It was, and for one process a `Map` is correct. It stops being correct the moment there are
 * two: each instance caches independently, so a visitor bounces between a copy baked ten
 * seconds ago and one baked ten minutes ago depending on which one answers — with no way to
 * tell from the outside which they got. A restart empties it, so every ISR route renders cold
 * again, and a rolling deploy makes that happen repeatedly.
 *
 * So the CACHE is a store you provide (`memoryStore`, `fileStore`, or your own over Redis or
 * whatever you already run), and the POLICY — fresh / stale-while-revalidate / cold — lives
 * here, once, instead of being re-typed in every app's server file.
 *
 * ## What is cached, and what can never be
 *
 * An ISR page is SHARED: one bake is served to everyone until it is rebaked. So it is rendered
 * with the request context poisoned, exactly like a static build — a route that reads a cookie
 * or a header cannot be an ISR route, and the render throws rather than baking one visitor's
 * data into a page served to the next. That guard is in the renderer (`renderStatic`), not
 * here; this module only ever stores what the renderer agreed to hand it.
 *
 * ## Why the package now has Node types
 *
 * `fileStore` reads and writes files, so `@types/node` is in the router's tsconfig. It types the
 * whole package, so it is not what keeps Node out of the client — that is the bundle boundary,
 * unchanged: a client bundler resolves `@ramonda/router/server` to `server.browser.ts`, which
 * throws, and `index.ts` imports nothing from here.
 */

/** One baked page. Plain data, because a store may write it to disk or to another machine. */
export interface IsrEntry {
  /** The rendered HTML. */
  html: string;
  /** When it was baked, as `Date.now()` on the machine that baked it. */
  at: number;
}

/**
 * Where baked pages live. Two methods, both async so a network store fits without pretending
 * to be synchronous.
 *
 * A store may lose an entry at any time — expiry, eviction, a cleared directory. That is not an
 * error: a missing entry is a cold render, which is always correct, only slower.
 */
export interface IsrStore {
  get(key: string): Promise<IsrEntry | undefined>;
  set(key: string, entry: IsrEntry): Promise<void>;
}

/** Which of the three answers a request got. Sent as `X-Ramonda-Mode`, and useful in a log. */
export type IsrMode = "isr-hit" | "isr-stale" | "isr-cold";

export interface IsrPage {
  html: string;
  mode: IsrMode;
}

export interface IsrCacheOptions {
  /** From `routePlan(server)` — the ISR paths and their revalidate windows. */
  plan: Pick<RoutePlan, "isr">;
  /** Where baked pages are kept. `memoryStore()` for one process, `fileStore()` for more. */
  store: IsrStore;
  /**
   * Bakes one path. This must be the SHARED render (request context poisoned) — the same call
   * the static build uses — never a per-request one.
   */
  render(path: string): Promise<string>;
  /**
   * Called when a BACKGROUND rebake fails. The visitor already has the stale page by then, so
   * the failure has no other way to be seen. Default: log to stderr.
   */
  onError?(path: string, error: unknown): void;
  /** Test seam. */
  now?(): number;
}

export interface IsrCache {
  /**
   * The page for `path`, or `undefined` when it is not an ISR route — so a server can write
   * `const page = await isr.serve(path); if (page) …` and fall through to its own dynamic path.
   *
   * Fresh → the cached copy. Stale → the cached copy NOW, with a rebake started behind it.
   * Nothing cached → renders inline and waits, because there is nothing else to send.
   */
  serve(path: string): Promise<IsrPage | undefined>;
}

function defaultOnError(path: string, error: unknown): void {
  /**
   * `%s`, not an interpolated path, because `console.error` treats its FIRST argument as a format
   * string. A path containing `%s` would consume the `error` argument into the message, and the
   * reason the rebake failed — the only thing this callback exists to deliver — would vanish:
   *
   *   of /about%s failed:  →  "of /aboutupstream down failed:"   (no error printed)
   *
   * A route key comes from the app's own table, so nothing hostile reaches here. It costs nothing
   * to be right anyway, and the placeholder form is what Node's own logging expects.
   */
  console.error("[ramonda:isr] background rebake of %s failed:", path, error);
}

export function createIsrCache(options: IsrCacheOptions): IsrCache {
  const { plan, store, render, onError = defaultOnError, now = Date.now } = options;

  const windowMs = new Map(plan.isr.map((route) => [route.path, route.revalidate * 1000]));

  /**
   * Rebakes in progress, so a stale page under load starts ONE render rather than one per
   * request. Without it a slow page plus real traffic is a self-inflicted stampede: every
   * request that arrives during the rebake sees the same stale entry and starts its own.
   *
   * Per process, which is all an in-process map can promise. Across instances the stored `at`
   * bounds the damage — each instance rebakes at most once per window — but two instances can
   * still bake the same page at the same moment. That is wasted work, never a wrong answer:
   * both renders produce the same shared page, and the later write wins.
   */
  const inFlight = new Map<string, Promise<string>>();

  function bake(path: string): Promise<string> {
    const running = inFlight.get(path);
    if (running) return running;

    const work = render(path)
      .then(async (html) => {
        await store.set(path, { html, at: now() });
        return html;
      })
      .finally(() => {
        inFlight.delete(path);
      });

    inFlight.set(path, work);
    return work;
  }

  return {
    async serve(path: string): Promise<IsrPage | undefined> {
      const ttl = windowMs.get(path);
      if (ttl === undefined) return undefined;

      const cached = await store.get(path);

      if (cached !== undefined && now() - cached.at < ttl) {
        return { html: cached.html, mode: "isr-hit" };
      }

      if (cached !== undefined) {
        // Stale-while-revalidate: the visitor waits for nothing. `catch` rather than `await`
        // — a failed rebake must not turn a servable stale page into a 500.
        void bake(path).catch((error: unknown) => onError(path, error));
        return { html: cached.html, mode: "isr-stale" };
      }

      // Cold: there is no previous copy, so this one request pays for the render. It throws on
      // failure, and should — there is nothing to send instead.
      return { html: await bake(path), mode: "isr-cold" };
    },
  };
}

/**
 * Keeps baked pages in this process.
 *
 * Right for a single instance, and for development. Not right for more than one: two processes
 * hold two independent caches, so which copy a visitor gets depends on which one answered, and
 * a restart starts over. Bounded by the number of ISR routes, so it cannot grow on its own.
 */
export function memoryStore(): IsrStore {
  const entries = new Map<string, IsrEntry>();
  return {
    async get(key) {
      return entries.get(key);
    },
    async set(key, entry) {
      entries.set(key, entry);
    },
  };
}

export interface FileStoreOptions {
  /** Directory to keep baked pages in. Created on first write. */
  dir: string;
}

/**
 * Keeps baked pages in a directory.
 *
 * Survives a restart, and is shared by every instance that mounts the same directory — a
 * shared volume, or simply several processes on one machine. For instances that share nothing,
 * write an `IsrStore` over whatever they DO share (Redis, Memcached, a database table); the
 * interface is two methods on purpose.
 *
 * Writes are atomic: the page goes to a temporary file and is renamed into place, so a reader
 * never sees half of one. A read that fails for any reason — missing, truncated, not JSON —
 * answers `undefined`, which is a cold render rather than a broken page.
 */
export function fileStore(options: FileStoreOptions): IsrStore {
  const { dir } = options;

  // One flat directory: a path is a filename, with the slashes encoded. `/` becomes `%2F`,
  // which is why no nested directories have to be created or cleaned up.
  const fileFor = (key: string) => join(dir, `${encodeURIComponent(key)}.json`);

  return {
    async get(key) {
      try {
        const raw = await readFile(fileFor(key), "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          typeof (parsed as IsrEntry).html !== "string" ||
          typeof (parsed as IsrEntry).at !== "number"
        ) {
          return undefined;
        }
        return parsed as IsrEntry;
      } catch {
        return undefined;
      }
    },

    async set(key, entry) {
      await mkdir(dir, { recursive: true });
      const file = fileFor(key);
      // The suffix has to be unique: two instances writing the same page at the same moment
      // would otherwise share one temporary file and rename a half-written one into place.
      const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      try {
        await writeFile(temp, JSON.stringify(entry), "utf8");
        await rename(temp, file);
      } catch (error) {
        await unlink(temp).catch(() => {});
        throw error;
      }
    },
  };
}
