import { hydrateRoot } from "@ramonda/core";
import { App } from "./App";

const root = document.querySelector<HTMLDivElement>("#app");
if (root) hydrateRoot(<App />, root);

/**
 * The devtools panel — the flower badge, or Alt+D.
 *
 * The app has to import it, and that surprised me here too. Core loads it itself in a
 * development build, but through a dynamic import whose specifier is a VARIABLE and marked
 * `@vite-ignore` — deliberately, so `@ramonda/core` does not make `@ramonda/devtools` a
 * resolution requirement for every project that type-checks it. A bundler therefore leaves the
 * string alone, the browser tries to fetch `@ramonda/devtools` as a URL, and core's `.catch()`
 * swallows the failure because the panel is genuinely optional. The result is silence: the
 * package is installed, aliased, bundled — and no badge appears.
 *
 * One line fixes it, and it belongs in the app: the app is what knows the panel is there. The
 * same fix went into `create-ramonda`, which had shipped the same silence.
 */
if (__DEV__) void import("@ramonda/devtools");
