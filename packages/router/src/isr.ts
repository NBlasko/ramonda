import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { matchParams } from "./match";
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
  /**
   * Drops one entry. Required, and it exists because a `:param` route has no fixed number of pages:
   * `/products/:id` is one route and as many pages as there are products, so the cache has to be able
   * to give one back.
   *
   * Deleting a key that is not there is not an error — a store may have lost it already, and a missing
   * entry is a cold render, which is always correct and only slower.
   */
  delete(key: string): Promise<void>;
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
  /**
   * How many pages this cache may hold before it starts giving one back. **Required when any ISR
   * route takes a `:param`**, and refused otherwise as a number with nothing to bound.
   *
   * A route without params has one page, so the old cache could not grow: the count was the number of
   * routes. `/products/:id` is one route and as many pages as there are products, and a crawler
   * walking `/products/1`…`/products/100000` would otherwise fill a disk with pages nobody asked for.
   *
   * ## Least RECENTLY used, not least often
   *
   * Evicting the fewest hits is the intuitive rule and it does the opposite of what it looks like.
   * Counts accumulate, so a product that was popular last week keeps its ten thousand and a page that
   * went viral an hour ago has three — and a brand new entry always has the fewest, so it is always
   * the first one thrown out. Fixing that needs the counters to decay, which needs a clock, which
   * needs a test that depends on one.
   *
   * Recency needs none of it and adapts by itself: whatever is being asked for keeps moving to the
   * back of the queue. A JavaScript `Map` iterates in insertion order, so the whole policy is a
   * delete-and-set on a hit and one `keys().next()` on an eviction.
   *
   * And the TTL is why the policy matters less than the CAP: every entry dies after `revalidate`
   * seconds anyway, so this is never choosing between a fresh page and an ancient one — it is choosing
   * among pages that are all at most one window old. The bound is protection from BREADTH in a single
   * window, and against breadth any eviction works.
   *
   * ## What it does not promise
   *
   * The count is per PROCESS. Two instances over one `fileStore` directory each bound their own view,
   * so what is on disk can be up to twice this. That is honest rather than fixed: making it exact means
   * the store owning the bound and enumerating itself, which is a different design and not one this
   * needed yet.
   */
  maxPages?: number;
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

/**
 * A plain log line, and this package has no diagnostic prefix of its own for the reason: a rebake
 * that fails is an operational event — a slow origin, a 500, a timeout — not a mistake in the
 * caller's code, so there is no fix to write beside it. It belongs in a server log next to the
 * request it failed, which is where it goes.
 */
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
  const { plan, store, render, onError = defaultOnError, maxPages, now = Date.now } = options;

  /**
   * A route with no params is one page, so its window is found by its own name.
   *
   * Asked FIRST, and not only for speed: a literal route and a pattern can both match one path —
   * `/products/new` and `/products/:id` — and the literal one is the page somebody wrote.
   */
  const exact = new Map(
    plan.isr.filter((route) => !route.path.includes(":")).map((route) => [route.path, route.revalidate * 1000]),
  );

  /**
   * A route WITH params, in table order, because that is the order the router itself matches in.
   *
   * This is the half that was missing: `plan.isr` carried `/products/:id` and the window map was keyed
   * by that string, so a request for `/products/7` looked up `/products/7`, found nothing, and the
   * caller fell through to its dynamic branch — rendering per request with the real request context,
   * which is the opposite of what `revalidate` asks for. Measured, and silent.
   */
  const patterned = plan.isr
    .filter((route) => route.path.includes(":"))
    .map((route) => ({ pattern: route.path, ttl: route.revalidate * 1000 }));

  if (patterned.length > 0 && (maxPages === undefined || maxPages < 1)) {
    throw new Error(
      `[Ramonda] ${patterned.map((route) => `\`${route.pattern}\``).join(", ")} ${
        patterned.length === 1 ? "is an ISR route that takes" : "are ISR routes that take"
      } a \`:param\`, so the number of pages is the number of items — pass \`maxPages\` to ` +
        `createIsrCache to say how many may be held at once. Without it one crawler walking the ids ` +
        `fills the store with pages nobody asked for.`,
    );
  }
  if (patterned.length === 0 && maxPages !== undefined) {
    throw new Error(
      "[Ramonda] `maxPages` was given but no ISR route takes a `:param`, so the number of pages is " +
        "already the number of routes and there is nothing to bound. Remove it.",
    );
  }

  const ttlFor = (path: string): number | undefined => {
    const literal = exact.get(path);
    if (literal !== undefined) return literal;
    for (const route of patterned) if (matchParams(path, route.pattern) !== null) return route.ttl;
    return undefined;
  };

  /**
   * What this process has written, in the order it was last WANTED — the whole of the LRU.
   *
   * A `Map` iterates in insertion order, so `delete` then `set` on a hit moves a key to the back and
   * `keys().next()` on an eviction gives the one nobody has asked for longest. The value is unused;
   * only the order is.
   */
  const held = new Map<string, true>();

  const touch = (path: string): void => {
    held.delete(path);
    held.set(path, true);
  };

  /** Called after a write, so the cap counts what is actually stored. */
  const evictDownTo = async (): Promise<void> => {
    if (maxPages === undefined) return;
    while (held.size > maxPages) {
      const oldest = held.keys().next();
      if (oldest.done) return;
      held.delete(oldest.value);
      // A store may have lost it already; `delete` is documented not to mind.
      await store.delete(oldest.value);
    }
  };

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
      const ttl = ttlFor(path);
      if (ttl === undefined) return undefined;

      // Before the read, and for every answer below: asking for a page is what makes it recent,
      // whether it turns out to be fresh, stale or cold.
      touch(path);

      const cached = await store.get(path);

      if (cached !== undefined && now() - cached.at < ttl) {
        return { html: cached.html, mode: "isr-hit" };
      }

      if (cached !== undefined) {
        // Stale-while-revalidate: the visitor waits for nothing. `catch` rather than `await`
        // — a failed rebake must not turn a servable stale page into a 500.
        void bake(path)
          .then(evictDownTo)
          .catch((error: unknown) => onError(path, error));
        return { html: cached.html, mode: "isr-stale" };
      }

      // Cold: there is no previous copy, so this one request pays for the render. It throws on
      // failure, and should — there is nothing to send instead.
      const html = await bake(path);
      await evictDownTo();
      return { html, mode: "isr-cold" };
    },
  };
}

/**
 * Keeps baked pages in this process.
 *
 * Right for a single instance, and for development. Not right for more than one: two processes
 * hold two independent caches, so which copy a visitor gets depends on which one answered, and
 * a restart starts over.
 *
 * It used to say it "cannot grow on its own", because it was bounded by the number of ISR routes. That
 * stopped being true when a `:param` route became cacheable — one route, as many pages as there are
 * items — so the bound moved to `maxPages` on the cache, which is required for exactly those routes.
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
    async delete(key) {
      entries.delete(key);
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

    async delete(key) {
      // A missing file is the state this asks for, so `ENOENT` is success. Anything else — a
      // permission, a read-only mount — is swallowed too, deliberately: an eviction that cannot happen
      // must not turn a served page into a 500, and the entry it failed to drop expires on its own.
      await unlink(fileFor(key)).catch(() => {});
    },
  };
}
