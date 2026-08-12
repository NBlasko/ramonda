export { analyzeProject } from "./analyze";
// Every issue `AnalyzeResult` carries, nameable. Two of the four were missing, so a script written
// against `analyzeProject` — which the reference tells people to write — could type a variable holding a
// context issue but not one holding a duplicate decorator.
export type {
  AnalyzeResult,
  ArrowFieldIssue,
  ContextIssue,
  DuplicateDecoratorIssue,
  UnwatchedFieldIssue,
} from "./analyze";
// The composition graph the issues are computed from. A FORMAT rather than an API: it is versioned
// by `schema` and there is no second consumer yet, so nothing here is documented for one.
export type { ComponentGraph, GraphEdge, GraphNode, Where } from "./graph";
