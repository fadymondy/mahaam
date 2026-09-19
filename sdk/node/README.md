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
