import type { MaybeComponent } from "../types/vdom";
import { COMPONENT_RUNTIME } from "./runtime";

export function errorHandler(e: unknown, placeholderComponent: MaybeComponent) {
  let errorCatcherComponent = placeholderComponent;
  let isErrorHandled = false;

  while (errorCatcherComponent) {
    const catchError = errorCatcherComponent[COMPONENT_RUNTIME].catchError;
    if (catchError) {
      /**
       * `false` means "not mine" and the walk goes on, which is what lets a
       * boundary DECLINE the error it cannot do anything about.
       *
       * A fallback renders inside its own boundary, so when the fallback is what
       * threw, the first ancestor found here is the boundary already showing it.
       * It would set the same `hasError` it set before — no change, so no
       * re-render — and the walk would stop and call the error handled, leaving
       * the page on the DOM from before the throw while the boundary above,
       * whose whole job is this, never heard about it.
       *
       * Anything else, `undefined` included, means handled — so a handler that
       * just sets state and returns nothing is the ordinary case, and declining
       * has to be written on purpose.
       */
      if (catchError(e) !== false) {
        isErrorHandled = true;
        break;
      }
    }

    errorCatcherComponent = errorCatcherComponent[COMPONENT_RUNTIME].parent;
  }

  if (!isErrorHandled) throw e;
}
