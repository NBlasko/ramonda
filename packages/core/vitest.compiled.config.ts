import base from "./vite.config";
import { compiledVariant } from "./compiled-variant";

/**
 * The whole suite again, with every JSX tree the compiler can take built as a template and holes (see
 * `@ramonda/build`'s `compile.ts`) — part of `test`, beside the suite as the runtime is written.
 */
export default compiledVariant(base, "vitest.compiled.config.ts");
