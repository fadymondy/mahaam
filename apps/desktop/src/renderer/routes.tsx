// Route → view. Each view owns its own file under views/.
import { useEffect } from "react";

import type { Route } from "../shared/types";
import { desktop } from "./lib/bridge";
import { useRouter } from "./lib/router";
import { InboxView } from "./views/Inbox";
import { IssueView } from "./views/Issue";
import { MyIssuesView } from "./views/MyIssues";
import { ProjectView } from "./views/Project";
import { ProjectsView } from "./views/Projects";
import { TimeView } from "./views/Time";

export function View({ route }: { route: Route }) {
  switch (route.name) {
    case "inbox":
      return <InboxView />;
    case "my-issues":
      return <MyIssuesView />;
    case "projects":
      return <ProjectsView />;
    case "project":
      return <ProjectView key={route.id} id={route.id} view={route.view} />;
    case "issue":
      return <IssueView key={route.key} issueKey={route.key} />;
    case "time":
      return <TimeView />;
    case "settings":
      // Settings is its own window (⌘,); a link or an old saved route here opens that instead.
      return <OpenSettingsWindow section={route.section} />;
  }
}

function OpenSettingsWindow({ section }: { section?: string }) {
  const { navigate } = useRouter();
  useEffect(() => {
    void desktop.openSettings(section);
    navigate({ name: "inbox" });
  }, [section, navigate]);
  return null;
}
