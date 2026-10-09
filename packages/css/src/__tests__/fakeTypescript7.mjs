/**
 * Run with `node --import` so that `typescript` resolves to what TypeScript 7's package exports:
 * its version, and no API. Measured on 7.0.2 — `lib/version.cjs` is the whole of its main entry.
 */
import { register } from "node:module";

const fake =
  "export const version = '7.0.2'; export const versionMajorMinor = '7.0'; export default { version, versionMajorMinor };";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      if (specifier === "typescript") {
        return { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(fake)}`)}, shortCircuit: true };
      }
      return next(specifier, context);
    }
  `)}`,
);
