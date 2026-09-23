// Route → view. Each view owns its own file under views/.
import type { Route } from "../shared/types";
import { InboxView } from "./views/Inbox";
import { IssueView } from "./views/Issue";
import { MyIssuesView } from "./views/MyIssues";
import { ProjectView } from "./views/Project";
import { ProjectsView } from "./views/Projects";
import { SettingsView } from "./views/Settings";
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
      return <SettingsView section={route.section} />;
  }
}
