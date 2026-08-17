declare const name: string;

/** A literal path. The bundler reads it, splits it, and this is the shape the rule exists to keep. */
export const known = () => import("./heavy");

/** A path the bundler cannot read. Nothing splits here and nothing said so — the fault. */
export const guessed = () => import(name);

/** Built from a template, which is the same fault wearing a different spelling. */
export const built = () => import(`./pages/${name}.js`);

/**
 * The bundler's own marker: it warned, and the author answered. The premise of the rule — that
 * nothing tells you — is not true at this site, so it is left alone.
 */
export const deliberate = () => import(/* @vite-ignore */ name);

// ramonda-check-ignore the panel's specifier is built so the build cannot follow it
export const annotated = () => import(name);

// ramonda-check-ignore
export const silent = () => import(name);
