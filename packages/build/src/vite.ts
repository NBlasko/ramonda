import {
  PUBLIC_ENV_PREFIX,
  RAMONDA_TRANSFORM,
  check,
  fillIn,
  lowersDecorators,
  refuse,
  refuseEnvPrefix,
  refuseOff,
} from "./settings";

/**
 * Structural, rather than imported from `vite`, so this package's types do not make the whole of
 * Vite a dependency of anybody who only wanted the esbuild half. Vite accepts any object with a
 * `name` and hooks it recognises; these are the three it will call here.
 */
interface VitePluginLike {
  name: string;
  enforce?: "pre" | "post";
  config: (
    this: ConfigContextLike | void,
    config: UserConfigLike,
    env: { command: string; mode: string },
  ) => UserConfigLike | undefined;
  configResolved: (config: UserConfigLike) => void;
  transform: {
    order: "post";
    handler: (this: unknown, code: string, id: string) => Promise<{ code: string; map: string } | null>;
  };
}

/** What Vite hands the `config` hook as `this`: the one thing read from it is which Vite is running. */
interface ConfigContextLike {
  meta?: { viteVersion?: string };
}

/** Oxc's JSX settings, in the two shapes Vite 8 accepts. */
type OxcJsxLike = "preserve" | { runtime?: "classic" | "automatic"; importSource?: string };

interface UserConfigLike {
  /** Which variables reach the browser. See `PUBLIC_ENV_PREFIX`. */
  envPrefix?: string | string[];
  // `jsx` is Vite's own union rather than `string`, so this plugin is assignable where Vite expects
  // a plugin. Widening it type-checks here and fails at every call site, which is the wrong way round.
  esbuild?:
    | false
    | { jsx?: "automatic" | "transform" | "preserve"; jsxImportSource?: string; target?: string | string[] };
  /** Vite 8's transform. See {@link ramonda} for why it is told only about JSX. */
  oxc?: false | { jsx?: OxcJsxLike };
}

/**
 * Whether this is Vite 8 or later, which transforms with Oxc instead of esbuild.
 *
 * Asked of `this.meta.viteVersion`, which Vite 7 and 8 both set. Nothing that runs the hook outside
 * Vite sets it, so an unknown version is answered the way Vite 7 is — the arrangement this package
 * shipped with.
 */
function transformsWithOxc(context: ConfigContextLike | void): boolean {
  const version = context?.meta?.viteVersion;
  if (version === undefined) return false;
  return Number.parseInt(version, 10) >= 8;
}

/**
 * The refusal for an Oxc JSX setting that is not Ramonda's — the same sentence `check` gives for
 * esbuild's two names, because it is the same mistake on the transform Vite 8 uses.
 */
function checkOxc(where: string, oxc: UserConfigLike["oxc"]): void {
  if (oxc === false) throw refuseOff(`${where}, as \`oxc: false\`,`);
  const jsx = oxc?.jsx;
  if (jsx === undefined) return;
  const told = jsx === "preserve" ? { jsx: "preserve" } : { jsx: jsx.runtime, jsxImportSource: jsx.importSource };
  check(`${where}'s \`oxc\``, told);
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
 *
 * ## Vite 8 transforms with Oxc, and Oxc cannot lower a decorator
 *
 * Measured on Vite 8.3.4: Oxc lowers only the legacy, `experimentalDecorators` kind, and leaves a
 * TC39 decorator exactly as written whatever target it is given. Vite still reads an `esbuild` block
 * there, but only to translate it into Oxc's settings, with a warning — so the target that saves the
 * decorators on Vite 7 reaches nothing on Vite 8, and the build is green with a bundle that dies on
 * the first page load.
 *
 * So on Vite 8 this plugin tells Oxc only about JSX, and lowers the decorators itself: a `post`
 * transform runs esbuild over each module after Oxc has stripped the types and compiled the JSX.
 * After, not before, because the module is plain JavaScript by then — esbuild has nothing to parse
 * but the decorators, and a plugin that rewrites a file's syntax first, such as a style block's, has
 * already run whatever order the app listed the plugins in.
 */
export function ramonda(): VitePluginLike {
  /** Decided in `config`, the first hook Vite calls, and read by the two that follow. */
  let oxc = false;

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
      oxc = transformsWithOxc(this);

      if (config.esbuild === false) throw refuseOff("`esbuild` in your Vite config");
      check("your Vite config", config.esbuild);

      const target = config.esbuild?.target;
      if (target !== undefined && !lowersDecorators(target))
        throw refuse("`esbuild.target` in your Vite config", target);

      if (config.envPrefix !== undefined && !samePrefix(config.envPrefix)) {
        throw refuseEnvPrefix("your Vite config", config.envPrefix);
      }
      const envPrefix = config.envPrefix === undefined ? { envPrefix: PUBLIC_ENV_PREFIX } : {};

      if (oxc) {
        checkOxc("your Vite config", config.oxc);
        // `jsx` as a whole or not at all: Oxc's object replaces Vite's default rather than merging
        // into it, and an app that wrote one has already been checked above.
        const jsx = config.oxc === undefined || (config.oxc !== false && config.oxc.jsx === undefined);
        return {
          ...(jsx
            ? { oxc: { jsx: { runtime: RAMONDA_TRANSFORM.jsx, importSource: RAMONDA_TRANSFORM.jsxImportSource } } }
            : {}),
          ...envPrefix,
        };
      }

      // Every setting the app did not name, and only those, so a choice of its own survives the
      // merge — Vite applies this OVER the user's config, so returning one would replace it.
      return { esbuild: fillIn(config.esbuild), ...envPrefix };
    },

    /**
     * What the config hooks agreed on, which is not the same as what this one returned: plugin order
     * decides who writes last, and this package does not control the plugin list. Read once, after
     * everyone has had their turn.
     */
    configResolved(config) {
      if (oxc) {
        // The decorators are this plugin's own transform below, so there is no target to be overruled.
        checkOxc("the resolved Vite config", config.oxc);
      } else {
        if (config.esbuild === false) throw refuseOff("the resolved Vite config");
        check("the resolved Vite config", config.esbuild);
        if (!lowersDecorators(config.esbuild?.target)) {
          throw refuse("the resolved Vite config's `esbuild.target`", config.esbuild?.target);
        }
      }
      // Checked here as well as above for the reason this hook exists: another plugin merges after
      // this one, and exposing a wider set of variables than the app asked for is the one mistake in
      // this area nobody can walk back once a page has shipped.
      if (!samePrefix(config.envPrefix)) {
        throw refuseEnvPrefix("the resolved Vite config", config.envPrefix);
      }
    },

    /**
     * The decorators, lowered on Vite 8 — see the note on {@link ramonda}. On Vite 7 esbuild is Vite's
     * own transform and has already done it, so this returns at once.
     *
     * Every module of the app's own, after Oxc: a dependency is published compiled, and a file with
     * no `@` in it has no decorator to lower. `esbuild` is imported here rather than at the top so
     * that a Vite 7 build, and the esbuild half of this package, never load it twice.
     */
    transform: {
      order: "post",
      async handler(code, id) {
        if (!oxc || id.startsWith("\0") || !code.includes("@")) return null;
        const file = id.split("?")[0] ?? id;
        if (!SCRIPT.test(file) || file.includes("/node_modules/")) return null;

        const { transform } = await import("esbuild");
        const result = await transform(code, {
          loader: "js",
          target: RAMONDA_TRANSFORM.target,
          sourcemap: "external",
          sourcefile: file,
        });
        return { code: result.code, map: result.map };
      },
    },
  };
}

/** A module Oxc has turned into JavaScript: what a decorator can be written in. */
const SCRIPT = /\.[cm]?[jt]sx?$/;
