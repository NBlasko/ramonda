import { kind } from "@ramonda/css/config";

/**
 * The variables the examples on this site read.
 *
 * It declares and narrows NOTHING else on purpose: every block in `content/` is checked by
 * `check-examples.mjs`, and a `properties` entry here would quietly narrow all of them — so an
 * example would start failing for a reason no page mentions.
 */
export default {
  variables: {
    color: kind("color", { accent: "#10b981", surface: "#ffffff" }),
    space: kind("length", { gutter: "16px" }),
  },
};
