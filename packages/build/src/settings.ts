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
 * A target may also be a list (`["es2022", "chrome100"]`). esbuild compiles down to whatever the
 * STRICTEST entry needs, so the rule is: a list lowers if even one entry is something other than
 * `esnext`. Only a bare `esnext`, or a list of nothing but `esnext`, leaves the decorators in.
 *
 * `esbuild: false` — the transform switched off altogether — is not a target and is not asked here.
 * Both adapters catch that first, and answer it with {@link refuseOff}.
 */
export function lowersDecorators(target: string | readonly string[] | undefined): boolean {
  if (target === undefined) return false;
  const list = typeof target === "string" ? [target] : target;
  if (list.length === 0) return false;
  return list.some((entry) => entry.toLowerCase() !== "esnext");
}

/** What a transform can be told, in the shape both adapters share. */
interface Told {
  jsx?: string;
  jsxImportSource?: string;
  target?: string | readonly string[];
}

/** The two names with exactly one right answer, as opposed to `target`, which has many. */
const EXACT = ["jsx", "jsxImportSource"] as const;

/**
 * Refuses anything the caller named that disagrees.
 *
 * Both adapters call this, which is the point: they drifted apart once — the Vite half replaced a
 * disagreeing value and the esbuild half kept it, so the same config got opposite treatment
 * depending on which bundler read it, and neither said a word.
 */
export function check(where: string, told: Told | undefined): void {
  for (const name of EXACT) {
    const actual = told?.[name];
    if (actual !== undefined && actual !== RAMONDA_TRANSFORM[name]) throw refuseSetting(where, name, actual);
  }
}

/**
 * Only what the caller left unsaid.
 *
 * Everything here has already been through {@link check}, so anything still set is a value that
 * agrees — and re-stating it would replace the caller's own line for no gain. On Vite it would do
 * more than that: a plugin's config is merged OVER the user's, so returning a key is how you take
 * it away from them.
 */
export function fillIn(told: Told | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of EXACT) if (told?.[name] === undefined) out[name] = RAMONDA_TRANSFORM[name];
  if (told?.target === undefined) out.target = RAMONDA_TRANSFORM.target;
  return out;
}

/**
 * The refusal for `jsx` and `jsxImportSource`.
 *
 * A different fault from the target and so a different sentence: nothing here is silently
 * unparseable, it simply does not compile — but it is refused for the same reason, and the two
 * adapters have to answer it the same way. They did not, at first: the Vite half overrode a value
 * the app had set and the esbuild half kept it, so the same config got opposite treatment depending
 * on which bundler read it.
 */
export function refuseSetting(where: string, name: "jsx" | "jsxImportSource", actual: unknown): Error {
  return new Error(
    `[ramonda] ${where} sets \`${name}\` to ${JSON.stringify(actual)}, and Ramonda needs ` +
      `${JSON.stringify(RAMONDA_TRANSFORM[name])}.\n\n` +
      `JSX compiles through Ramonda's automatic runtime: every file imports what it needs from\n` +
      `\`@ramonda/core/jsx-runtime\` itself. Both halves of that have to say the same thing, and they\n` +
      `have to agree with \`jsx\` and \`jsxImportSource\` in your tsconfig.json as well.\n\n` +
      `Remove it and let this plugin set it.\n\n` +
      `This is refused rather than corrected because you asked for something specific, and the line\n` +
      `you asked it on is the one that has to change.`,
  );
}

/** Why a surviving decorator is fatal — the half of the refusal that does not depend on the cause. */
const WHY =
  `\`@state\`, \`@compute\` and the rest are TC39 decorators. No engine can parse them, so they have\n` +
  `to be compiled away — and esbuild does that for every target except \`esnext\`, which is also its\n` +
  `default. A build configured this way succeeds, warns about nothing, and emits a file that dies\n` +
  `with \`SyntaxError: Invalid or unexpected token\` on the first page load.`;

/** The last line of every refusal here, so there is one wording of it to keep true. */
const WHY_NOT_CORRECTED =
  `This is refused rather than corrected because you asked for something specific, and the line\n` +
  `you asked it on is the one that has to change.`;

/** A `target` that leaves the decorators in. */
export function refuse(where: string, target: string | readonly string[] | undefined): Error {
  return new Error(
    `[ramonda] ${where} has \`${JSON.stringify(target)}\`, and that leaves Ramonda's decorators in ` +
      `the output.\n\n${WHY}\n\n` +
      `Set it to \`${RAMONDA_TRANSFORM.target}\`, or remove it and let this plugin do it.\n\n` +
      WHY_NOT_CORRECTED,
  );
}

/**
 * The transform switched off entirely (`esbuild: false`).
 *
 * Its own function rather than a branch inside {@link refuse}, because the only useful sentence —
 * what to do about it — is different. The shared version said "set it to `es2022`", which is not
 * something you can do to a line that reads `esbuild: false`.
 */
export function refuseOff(where: string): Error {
  return new Error(
    `[ramonda] ${where} turns the esbuild transform off entirely, and that leaves Ramonda's ` +
      `decorators in the output.\n\n${WHY}\n\n` +
      `Remove that line. There is no target to set while the transform is off, and this plugin\n` +
      `cannot put one anywhere it would be read.\n\n` +
      WHY_NOT_CORRECTED,
  );
}
