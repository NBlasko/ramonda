import type { RamondaNode, VNode } from "../types/vdom";
import { state, catchError } from "./decorators";
import { Component } from "./Component";

export interface ErrorBoundaryFallbackProps {
  message: string;
  err?: Error;
  reset: () => void;
}

interface Props {
  fallback: (fallbackProps: ErrorBoundaryFallbackProps) => VNode | VNode[];
  children: RamondaNode;
}

export class ErrorBoundary extends Component<Props> {
  @state hasError = false;
  @state message = "";
  @state err: Error | undefined = undefined;

  @catchError handleFailure(e: unknown) {
    /**
     * Already showing the fallback, so this error came FROM the fallback — the
     * only thing left rendering in here. Catching it again would write the same
     * `hasError` and change nothing, and the walk would stop at a boundary that
     * cannot do anything about it: the page would keep the DOM it had before the
     * throw, and the boundary above would never be told.
     *
     * Declining passes it up. A boundary that has been `reset` is healthy again
     * and catches as before.
     */
    if (this.hasError) return false;

    this.hasError = true;
    if (e instanceof Error) {
      this.message = e.message;
      this.err = e;
      return true;
    }
    this.message = "unknown Error";
    return true;
  }

  handleReset() {
    this.hasError = false;
    this.message = "";
    this.err = undefined;
  }

  render() {
    if (this.hasError)
      return this.props.fallback({
        message: this.message,
        err: this.err,
        reset: this.handleReset,
      });

    return this.props.children;
  }
}
