# @mahaam/feedback

```bash
npm i @mahaam/feedback   # env: MAHAAM_FEEDBACK_KEY, MAHAAM_URL, MAHAAM_APP_URL
```

```ts
import { expressMiddleware, report, installExceptionHook } from "@mahaam/feedback";
app.use(expressMiddleware());   // injects the widget into HTML responses
installExceptionHook();         // reports uncaught exceptions and unhandled rejections
await report({ title: "Payment failed", body: err.stack, type: "bug", priority: "high" }); // resolves to "MG-12"
```

React or Next.js (App Router: put it in the root layout; the component is client-only):

```tsx
"use client";
import { MahaamFeedback } from "@mahaam/feedback/react";
export default function Feedback() {
  return <MahaamFeedback publicKey={process.env.NEXT_PUBLIC_MAHAAM_FEEDBACK_KEY} locale="en" />;
}
```

The prop is `publicKey` because React reserves `key`.

`scriptTag(opts)` returns the escaped `<script>` HTML. Server-side reports send no `Origin` header, so set `MAHAAM_APP_URL` (or `appUrl`) to a URL on one of the key's allowed origins. It is sent as `page_url`. Zero runtime dependencies, Node 18 or later, ESM and CJS.

## Error monitoring (separate from the widget above)

`@mahaam/feedback/monitor` is Sentry-shaped: a DSN, not a `pfk_` key, and it reports to the
project's board as an issue instead of the "report a problem" intake. Get a DSN from a project's
Settings → Monitoring in Mahaam.

```ts
import { Monitor, installMonitorHook, expressErrorHandler } from "@mahaam/feedback/monitor";

const monitor = new Monitor({ environment: "production" }); // reads MAHAAM_DSN
installMonitorHook(monitor); // uncaught exceptions / unhandled rejections

// Express: mount LAST, after your routes — Express only calls a 4-arg middleware on next(err)
// or a thrown error. It reports, then always calls next(err), so your own error page still runs.
app.use(expressErrorHandler(monitor));
```

Report anything else directly: `await monitor.capture({ message: "queue backed up", level: "warning", tags: { queue: "emails" } })`.

A repeated fault (same exception type + top stack frame) updates the existing open issue's
occurrence count instead of filing a new one every time it fires. A `Monitor` built with no DSN
(or `MAHAAM_DSN` unset) is inert — every method a safe no-op, so it's fine to construct
unconditionally and just leave it unset in development.
