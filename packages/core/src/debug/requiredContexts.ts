import { REQUIRED_CONTEXTS } from "../helpers/constants";
import type { Context } from "../types/commonTypes";
import { diagnose } from "./diagnostics";

/** What a context's Provider/Consumer pair carries so a declaration can name it. */
export interface ContextIdentity {
  id: string | number;
  label?: string;
}

/**
 * Reports any context a class declared with `@requiresContext` that is not published above it.
 *
 * Called from the Component and Hook constructors, where the inherited context is already in hand
 * — which is the whole point of the decorator: the report lands at MOUNT, not later at the first
 * read, so a component that appears and never reads still says something is missing.
 *
 * DEV-only; the callers guard it with `__DEV__`.
 */
export function checkRequiredContexts(instance: object, context: Context): void {
  const required = (instance.constructor as { [REQUIRED_CONTEXTS]?: readonly ContextIdentity[] })[REQUIRED_CONTEXTS];
  if (!required) return;

  const published = context as Record<string | number, unknown>;
  for (const { id, label } of required) {
    if (published[id] !== undefined) continue;
    diagnose(
      "RMD003",
      `required:${id}:${instance.constructor.name}`,
      `<${instance.constructor.name} /> declares it needs the ${label ? `"${label}" ` : ""}context, ` +
        `but no Provider is mounted on any ancestor. It was reported at mount, before anything read it.`,
    );
  }
}
