// An issue in its own document window (Open in New Window, like a note in Zekra or a message in
// Mail): the issue view alone, full-window. Following a link to anything else — the project, another
// view — hands it to the main window rather than turning this one into a second app.
import { useEffect } from "react";

import type { Route } from "../../shared/types";
import { useApp } from "@/lib/app";
import { desktop } from "@/lib/bridge";
import { RouterProvider, useRouter } from "@/lib/router";
import { IssueView } from "@/views/Issue";
import { SignIn } from "@/views/SignIn";

export function IssueWindow() {
  const { session } = useApp();
  const key = new URLSearchParams(location.search).get("key") ?? "";
  if (!session?.workspace) return <SignIn />;
  return (
    <RouterProvider start={{ name: "issue", key }} persist={false}>
      <Doc home={key} />
    </RouterProvider>
  );
}

function Doc({ home }: { home: string }) {
  const { route, navigate } = useRouter();
  useEffect(() => {
    if (route.name === "issue") {
      document.title = route.key;
      return;
    }
    void desktop.openMain(route as Route);
    navigate({ name: "issue", key: home }, { replace: true });
  }, [route, navigate, home]);
  return (
    <main className="flex h-full min-w-0 flex-col bg-background" data-route="issue" data-issue-window>
      {route.name === "issue" ? <IssueView key={route.key} issueKey={route.key} /> : null}
    </main>
  );
}
