import type { RamondaNode, VNode } from "../types/vdom";
import { state } from "./decorators";
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

  catchError(e: unknown) {
    this.hasError = true;
    if (e instanceof Error) {
      this.message = e.message;
      this.err = e;
      return;
    }
    this.message = "unknown Error";
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
