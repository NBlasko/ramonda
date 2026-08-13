import { RAMONDA_TRANSFORM, lowersDecorators, refuse } from "./settings";

/**
 * Structural, rather than imported from `vite`, so this package's types do not make the whole of
 * Vite a dependency of anybody who only wanted the esbuild half. Vite accepts any object with a
 * `name` and hooks it recognises; these are the two it will call here.
 */
interface VitePluginLike {
  name: string;
  enforce?: "pre" | "post";
  config: (config: UserConfigLike, env: { command: string; mode: string }) => UserConfigLike | undefined;
  configResolved: (config: UserConfigLike) => void;
}

interface UserConfigLike {
  // `jsx` is Vite's own union rather than `string`, so this plugin is assignable where Vite expects
  // a plugin. Widening it type-checks here and fails at every call site, which is the wrong way round.
  esbuild?:
    | false
    | { jsx?: "automatic" | "transform" | "preserve"; jsxImportSource?: string; target?: string | string[] };
}

/**
 * The Vite plugin: an app running Ramonda adds this and configures nothing about the transform.
 *
 * ```ts
 * import { defineConfig } from "vite";
 * import { ramonda } from "@ramonda/build/vite";
 *
 * export default defineConfig({ plugins: [ramonda()] });
 * ```
 *
 * It fills in `jsx`, `jsxImportSource` and `target`. The first two are ordinary. The third is the
 * reason this package exists — see {@link lowersDecorators} for what happens without it.
 *
 * ## Why it refuses rather than corrects
 *
 * Vite merges a plugin's returned config OVER the user's, so this could quietly replace a `target`
 * an app had set and nobody would ever know. It does not. If the app named a target that leaves the
 * decorators in, the build stops and says which line. A setting that gets silently reversed is a
 * setting you cannot reason about, and the next person to write `esnext` there deserves to find out
 * from the build rather than from a browser.
 *
 * A target that is already safe is left exactly as it is, for the same reason: it was a real choice.
 */
export function ramonda(): VitePluginLike {
  return {
    name: "ramonda",

    /**
     * `pre`, so the settings are in the config before a plugin that reads them can look. Nothing
     * here transforms anything — Vite's own pipeline does that — so being early costs nothing.
     */
    enforce: "pre",

    config(config) {
      if (config.esbuild === false) throw refuse("`esbuild` in your Vite config", false);

      const target = config.esbuild?.target;
      if (target !== undefined && !lowersDecorators(target))
        throw refuse("`esbuild.target` in your Vite config", target);

      return {
        esbuild: {
          jsx: RAMONDA_TRANSFORM.jsx,
          jsxImportSource: RAMONDA_TRANSFORM.jsxImportSource,
          // Only when the app named none, so a working choice of its own survives the merge.
          ...(target === undefined ? { target: RAMONDA_TRANSFORM.target } : {}),
        },
      };
    },

    /**
     * What the config hooks agreed on, which is not the same as what this one returned: plugin order
     * decides who writes last, and this package does not control the plugin list. Read once, after
     * everyone has had their turn.
     */
    configResolved(config) {
      if (config.esbuild === false) throw refuse("the resolved Vite config", false);
      if (!lowersDecorators(config.esbuild?.target)) {
        throw refuse("the resolved Vite config's `esbuild.target`", config.esbuild?.target);
      }
    },
  };
}
