import type { MaybeComponent } from "../types/vdom";
import { COMPONENT_RUNTIME } from "./runtime";

export function errorHandler(e: unknown, placeholderComponent: MaybeComponent) {
  let errorCatcherComponent = placeholderComponent;
  let isErrorHandled = false;

  while (errorCatcherComponent) {
    const catchError = errorCatcherComponent.catchError;
    if (catchError) {
      catchError(e);
      isErrorHandled = true;
      break;
    }

    errorCatcherComponent = errorCatcherComponent[COMPONENT_RUNTIME].parent;
  }

  if (!isErrorHandled) throw e;
}
