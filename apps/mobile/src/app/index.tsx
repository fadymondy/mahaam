// The gate: no language yet → first-run picker; signed out → sign in; no workspace → picker;
// otherwise the workspace's experience — staff start on projects, customers on their portal.
import { Redirect } from "expo-router";

import { usePrefs } from "@/grid";
import { isCustomer, useSession } from "@/lib/session";

export default function Gate() {
  const { locale } = usePrefs();
  const { status, workspace } = useSession();
  if (locale === null) return <Redirect href="/welcome" />;
  if (status !== "signedIn") return <Redirect href="/sign-in" />;
  if (!workspace) return <Redirect href="/workspaces" />;
  return <Redirect href={isCustomer(workspace) ? "/portal" : "/projects"} />;
}
