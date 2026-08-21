declare const name: string;

/** A literal path. The bundler reads it, splits it, and this is the shape the rule exists to keep. */
export const known = () => import("./heavy");

/** A path the bundler cannot read. Nothing splits here and nothing said so — the fault. */
export const guessed = () => import(name);

/**
 * Built from a template, and NOT a fault — measured with Vite 7 rather than assumed.
 *
 * A relative head and a suffix make this a pattern the bundler reads: it emitted a chunk per
 * matching file, two of them in the probe. Reporting it was reporting a documented feature working
 * exactly as documented.
 */
export const built = () => import(`./pages/${name}.js`);

/**
 * The two halves of that, each on its own — and neither splits. One module transformed, no chunk
 * emitted, both measured.
 */
export const noSuffix = () => import(`./pages/${name}`);
export const notRelative = () => import(`pages/${name}.js`);

/**
 * The bundler's own marker: it warned, and the author answered. The premise of the rule — that
 * nothing tells you — is not true at this site, so it is left alone.
 */
export const deliberate = () => import(/* @vite-ignore */ name);

// ramonda-check-ignore the panel's specifier is built so the build cannot follow it
export const annotated = () => import(name);

// ramonda-check-ignore
export const silent = () => import(name);
