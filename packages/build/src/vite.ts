import { PUBLIC_ENV_PREFIX, check, fillIn, lowersDecorators, refuse, refuseEnvPrefix, refuseOff } from "./settings";

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
  /** Which variables reach the browser. See `PUBLIC_ENV_PREFIX`. */
  envPrefix?: string | string[];
  // `jsx` is Vite's own union rather than `string`, so this plugin is assignable where Vite expects
  // a plugin. Widening it type-checks here and fails at every call site, which is the wrong way round.
  esbuild?:
    | false
    | { jsx?: "automatic" | "transform" | "preserve"; jsxImportSource?: string; target?: string | string[] };
}

/**
 * Whether a prefix setting is the one Ramonda needs — as the bare string, or as a one-entry list,
 * because Vite accepts both spellings and an app writing the array form did not mean anything
 * different by it.
 */
function samePrefix(prefix: string | string[] | undefined): boolean {
  if (prefix === undefined) return false;
  const list = typeof prefix === "string" ? [prefix] : prefix;
  return list.length === 1 && list[0] === PUBLIC_ENV_PREFIX;
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
 * It fills in `jsx`, `jsxImportSource`, `target` and `envPrefix`. The first two are ordinary. The third
 * is the reason this package exists — see {@link lowersDecorators} for what happens without it. The
 * fourth decides which environment variables reach the browser — see {@link PUBLIC_ENV_PREFIX}.
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
     * `pre` puts this FIRST, which — since Vite merges each plugin's config over the one before —
     * makes it the easiest of them to overrule, not the hardest. That is the intended side: this
     * package exists so a transform setting cannot be reversed in silence, and quietly outranking
     * whatever an app added deliberately would be the same fault pointed the other way.
     *
     * So it goes first, states the settings, and lets `configResolved` be the place where being
     * overruled is discovered — and reported with the value that actually won.
     */
    enforce: "pre",

    config(config) {
      if (config.esbuild === false) throw refuseOff("`esbuild` in your Vite config");
      check("your Vite config", config.esbuild);

      const target = config.esbuild?.target;
      if (target !== undefined && !lowersDecorators(target))
        throw refuse("`esbuild.target` in your Vite config", target);

      if (config.envPrefix !== undefined && !samePrefix(config.envPrefix)) {
        throw refuseEnvPrefix("your Vite config", config.envPrefix);
      }

      // Every setting the app did not name, and only those, so a choice of its own survives the
      // merge — Vite applies this OVER the user's config, so returning one would replace it.
      return {
        esbuild: fillIn(config.esbuild),
        ...(config.envPrefix === undefined ? { envPrefix: PUBLIC_ENV_PREFIX } : {}),
      };
    },

    /**
     * What the config hooks agreed on, which is not the same as what this one returned: plugin order
     * decides who writes last, and this package does not control the plugin list. Read once, after
     * everyone has had their turn.
     */
    configResolved(config) {
      if (config.esbuild === false) throw refuseOff("the resolved Vite config");
      check("the resolved Vite config", config.esbuild);
      if (!lowersDecorators(config.esbuild?.target)) {
        throw refuse("the resolved Vite config's `esbuild.target`", config.esbuild?.target);
      }
      // Checked here as well as above for the reason this hook exists: another plugin merges after
      // this one, and exposing a wider set of variables than the app asked for is the one mistake in
      // this area nobody can walk back once a page has shipped.
      if (!samePrefix(config.envPrefix)) {
        throw refuseEnvPrefix("the resolved Vite config", config.envPrefix);
      }
    },
  };
}
