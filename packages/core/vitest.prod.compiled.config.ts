import base from "./vitest.prod.config";
import { compiledVariant } from "./compiled-variant";

/**
 * The production suite again, through the JSX compiler — what a production build of an app ships, with
 * `__DEV__` false and every tree it can take a template. Beside `vitest.compiled.config.ts`, which is the
 * same for the development suite.
 */
export default compiledVariant(base, "vitest.prod.compiled.config.ts");
