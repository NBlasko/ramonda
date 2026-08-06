---
"@ramonda/core": minor
---

**Breaking:** catching an error is declared with `@catchError`, not by naming a method `catchError`

```diff
 @Host("div")
 class Panel extends Component {
   @state failed = "";
-  catchError(e: unknown) {
+  @catchError whenSomethingBreaks(e: unknown) {
     this.failed = (e as Error).message;
   }
   render() { … }
 }
```

It was the last capability handed out by NAME: the error walk called `component.catchError` on
whichever ancestor had one, so a component that defined a method by that name for its own reasons
silently became an error boundary and swallowed its subtree's failures. That is the footgun
`@deferHydration`, `@ShouldUpdateOnPropsChange` and `@StableProps` all exist to avoid — "a framework
that reserves a name on every class changes behaviour silently" — and error catching was the one
place still doing it. A plain method called `catchError` now means nothing to the framework.

It stays a METHOD decorator, unlike the props gate, because handling an error is behaviour a subclass
will want to extend: a boundary that reports to Sentry *and* does what the base did is the ordinary
case, and that wants `super`. It is dispatched by name, so overriding the method without
re-decorating works. Returning `false` still declines the error and passes it to the next handler
above.

`ErrorBoundary`'s own handler moved with it: the method is now `handleFailure`, declared with
`@catchError`. A subclass that overrode `catchError` must override `handleFailure` instead — which is
the pattern this form exists for, since `super.handleFailure(e)` lets a specialised boundary report
*and* fall back:

```tsx
class ReportingBoundary extends ErrorBoundary {
  override handleFailure(e: unknown) {
    report(e);
    return super.handleFailure(e);
  }
}
```

New **RMD032** reports two `@catchError` declarations on one class, where the last silently wins. A
subclass declaring its own is an override, not a duplicate, and is not reported.
