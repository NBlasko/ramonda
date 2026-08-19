import { RAMONDA_TRANSFORM, check, envDefines, fillIn, lowersDecorators, refuse } from "./settings";

/**
 * Structural, for the same reason as the Vite half: naming esbuild's own types here would make it a
 * dependency of everyone who installs this package.
 */
interface EsbuildOptionsLike {
  jsx?: string;
  jsxImportSource?: string;
  target?: string | string[];
  define?: Record<string, string>;
  platform?: string;
}

interface EsbuildPluginLike {
  name: string;
  setup: (build: { initialOptions: EsbuildOptionsLike }) => void;
}

/**
 * The three settings, ready to spread into a build.
 *
 * ```ts
 * import { build } from "esbuild";
 * import { ramondaOptions } from "@ramonda/build/esbuild";
 *
 * await build({ ...ramondaOptions, entryPoints: ["src/entry-client.tsx"], bundle: true });
 * ```
 *
 * This is the form to reach for when the build is a script, because spreading it is one thing to get
 * right instead of three — and because the alternative is three flags on a command line, kept in
 * step by hand, in every app.
 *
 * Left to infer its literal types rather than annotated with {@link EsbuildOptionsLike}: esbuild's
 * own `jsx` is a union of exact strings, and widening these to `string` would make the spread above
 * fail to type-check in the one place it is meant to be used.
 */
export const ramondaOptions = RAMONDA_TRANSFORM;

/**
 * The `define` entries a build needs, merged with your own.
 *
 * ```ts
 * await build({ ...ramondaOptions, define: ramondaDefine({ __DEV__: "false" }) });
 * ```
 *
 * ## Why this is a function and not a key on `ramondaOptions`
 *
 * `ramondaOptions` is spread, and a spread cannot refuse anything. A build that writes its own
 * `define` after the spread — which is what every build does, because `__DEV__` lives there —
 * would silently replace the env entries and every `import.meta.env.RAMONDA_PUBLIC_…` read would
 * become a live reference that throws in a browser. A key that is lost by writing the obvious thing
 * is worse than no key, so this asks to be called instead.
 *
 * The plugin form does not need it: it runs after the options are assembled, so it can merge into
 * whatever is there.
 *
 * Reads `process.env` at BUILD time, which is when the values exist and when they can be baked in.
 * Only `RAMONDA_PUBLIC_*` is read — see `publicEnv`.
 */
export function ramondaDefine(own: Record<string, string> = {}): Record<string, string> {
  // `ssr` is not knowable here — this is called before the build object exists — so it defaults to
  // `false` and a server build that cares says `"import.meta.env.SSR": "true"` in `own`, which wins.
  return { ...envDefines(process.env), ...own };
}

/**
 * The same settings as a plugin, for a build whose options are assembled somewhere you cannot reach
 * — a tool that calls esbuild for you and takes plugins.
 *
 * It fills in anything the build did not set, and **refuses** a target that would leave Ramonda's
 * decorators in the output rather than overriding it. See {@link lowersDecorators} for what that
 * target does, and the Vite plugin's note for why refusing is the right answer.
 *
 * There is one asymmetry with Vite worth knowing: esbuild's default target is `esnext`, so a build
 * that never mentions a target has already chosen the broken one. That is why an unset target here
 * is filled in rather than left alone.
 */
export function ramonda(): EsbuildPluginLike {
  return {
    name: "ramonda",
    setup(build) {
      const options = build.initialOptions;

      // The same refusal the Vite half makes, from the same helper. These two drifted apart once —
      // this side kept a disagreeing value with `??=` while the other silently replaced it — and a
      // package whose whole point is that config cannot be got wrong quietly cannot afford that.
      check("this esbuild build", options);

      const target = options.target;
      if (target !== undefined && !lowersDecorators(target)) throw refuse("this esbuild build's `target`", target);

      Object.assign(options, fillIn(options));

      /**
       * Merged UNDER whatever the build already said, so a build that defines a name itself keeps its
       * own value — and merged rather than assigned, because replacing `define` would take away
       * `__DEV__` and everything else a build depends on.
       */
      // `platform` is the only place `import.meta.env.SSR` can be read from honestly, and the plugin is
      // the one form that gets to see it.
      options.define = { ...envDefines(process.env, { ssr: options.platform === "node" }), ...options.define };
    },
  };
}
