/**
 * Whether the installed `typescript` is one this package can read source with.
 *
 * **TypeScript 7 has no JavaScript API.** Its package exports `version` and nothing else, so every
 * `ts.createSourceFile` here reads a property of `undefined`. Measured on 7.0.2: the CLI and a build
 * with a `ramonda.css.ts` both stopped on *Cannot read properties of undefined*, which names neither
 * TypeScript nor a fix. 6.0.3 type-checks and builds the same project cleanly.
 *
 * The peer range says `<7` too, and npm refuses the install on it — but pnpm and yarn only warn,
 * so the run still has to say it.
 */
export function withoutItsApi(ts: { version?: string; createProgram?: unknown }): string | undefined {
  if (typeof ts.createProgram === "function") return undefined;
  return (
    `TypeScript ${ts.version ?? "(unknown version)"} is installed, and it has no JavaScript API to read your source with. ` +
    "Install TypeScript 5 or 6: `npm install -D typescript@5`."
  );
}

/** For a plugin, where a throw is how the bundler reports it. */
export function requireItsApi(ts: { version?: string; createProgram?: unknown }): void {
  const refusal = withoutItsApi(ts);
  if (refusal !== undefined) throw new Error(`[ramonda-css] ${refusal}`);
}
