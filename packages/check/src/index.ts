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
