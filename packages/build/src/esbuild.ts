import { RAMONDA_TRANSFORM, lowersDecorators, refuse } from "./settings";

/**
 * Structural, for the same reason as the Vite half: naming esbuild's own types here would make it a
 * dependency of everyone who installs this package.
 */
interface EsbuildOptionsLike {
  jsx?: string;
  jsxImportSource?: string;
  target?: string | string[];
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
      const target = options.target;
      if (target !== undefined && !lowersDecorators(target)) throw refuse("this esbuild build's `target`", target);

      options.jsx ??= RAMONDA_TRANSFORM.jsx;
      options.jsxImportSource ??= RAMONDA_TRANSFORM.jsxImportSource;
      options.target ??= RAMONDA_TRANSFORM.target;
    },
  };
}
