// The `browser`-condition build of `@ramonda/router/server`. A client bundler resolves the
// server entry to THIS file, so importing server route config from client code fails at BUILD
// (or at import in the browser) rather than silently shipping loaders / secrets to the client.
//
// The types still come from the real `server.ts` (the exports map points `types` there), so a
// server module keeps full type-checking; only the runtime a browser would load is this stub.

const message =
  "[Ramonda Router] `@ramonda/router/server` was imported into a client bundle. Server route " +
  "config (rendering modes, loaders, and anything they touch) must stay on the server — keep it " +
  "under your app's `server/` folder and never import it from client code.";

function forbidden(): never {
  throw new Error(message);
}

export const defineServer = forbidden;
export const routePlan = forbidden;
export const createIsrCache = forbidden;
export const memoryStore = forbidden;
export const fileStore = forbidden;

// Throw even on a bare `import "@ramonda/router/server"` for side effect.
throw new Error(message);
