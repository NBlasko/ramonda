---
"@ramonda/core": patch
---

An error thrown by a fallback now reaches the boundary above

A fallback renders inside its own `ErrorBoundary`, so when the fallback was the thing that threw, the
error walk found that same boundary first. It set the `hasError` it had already set — no change, so
no re-render — and the walk stopped and called the error handled. The result was a page frozen on the
DOM it had before the throw, with the boundary above, whose whole job is this, never told anything
had happened.

A `catchError` may now return `false` to decline an error, and the walk carries on to the next
ancestor that has one. `ErrorBoundary` declines while it is already showing its fallback, and catches
again once it has been `reset`. Returning nothing still means handled, so a `catchError` written
before this keeps working unchanged.
