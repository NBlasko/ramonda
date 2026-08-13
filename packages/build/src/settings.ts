/**
 * The three settings a Ramonda app needs from its bundler, and the rule that decides whether one of
 * them is right.
 *
 * Kept apart from the plugins because it is the only part with an opinion in it. The plugins are
 * plumbing — each one puts these values where its own bundler reads them.
 */

/**
 * What every Ramonda app has to tell esbuild.
 *
 * `jsx` and `jsxImportSource` are the ordinary pair: JSX compiles through the automatic runtime, so
 * each file imports what it needs from `@ramonda/core/jsx-runtime` and there is no factory to name.
 *
 * `target` is the one nobody would guess. See {@link lowersDecorators}.
 */
export const RAMONDA_TRANSFORM = {
  jsx: "automatic",
  jsxImportSource: "@ramonda/core",
  target: "es2022",
} as const;

/**
 * Whether esbuild, told to hit this target, will rewrite decorators into something an engine can
 * read.
 *
 * `@state`, `@compute` and the rest are TC39 decorators, and no engine implements them. `esnext`
 * means "assume the engine implements everything", so at `esnext` esbuild leaves them exactly as
 * written — and the file it emits dies with `SyntaxError: Invalid or unexpected token` the first
 * time a browser reads it. Every other target lowers them into helper calls.
 *
 * Two things make that worse than an ordinary misconfiguration. `esnext` is esbuild's DEFAULT, so
 * saying nothing is the same as saying the wrong thing. And nothing complains: the build succeeds,
 * emits no warning, and the failure waits for the first page load.
 *
 * A target may also be a list (`["es2022", "chrome100"]`), in which case esbuild lowers to whatever
 * the strictest entry needs — so one `esnext` among them still leaves the rest to decide, but an
 * all-`esnext` list does not, and neither does a bare `esnext`.
 */
export function lowersDecorators(target: string | readonly string[] | undefined | false): boolean {
  if (target === undefined || target === false) return false;
  const list = typeof target === "string" ? [target] : target;
  if (list.length === 0) return false;
  return list.some((entry) => entry.toLowerCase() !== "esnext");
}

/** The sentence both plugins fail with, so there is one wording of this to keep true. */
export function refuse(where: string, target: string | readonly string[] | false | undefined): Error {
  const said = target === false ? "the transform turned off entirely" : `\`${JSON.stringify(target)}\``;
  return new Error(
    `[ramonda] ${where} has ${said}, and that leaves Ramonda's decorators in the output.\n\n` +
      `\`@state\`, \`@compute\` and the rest are TC39 decorators. No engine can parse them, so they have\n` +
      `to be compiled away — and esbuild does that for every target except \`esnext\`, which is also its\n` +
      `default. A build configured this way succeeds, warns about nothing, and emits a file that dies\n` +
      `with \`SyntaxError: Invalid or unexpected token\` on the first page load.\n\n` +
      `Set it to \`${RAMONDA_TRANSFORM.target}\`, or remove it and let this plugin do it.\n\n` +
      `This is refused rather than corrected because you asked for something specific, and the line\n` +
      `you asked it on is the one that has to change.`,
  );
}
