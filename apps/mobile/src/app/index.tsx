// The gate: signed out → sign in; no workspace → picker; otherwise this variant's tree.
import { Redirect } from "expo-router";

import { Loading } from "@/components/ui";
import { isTeam } from "@/config";
import { useSession } from "@/lib/session";

export default function Gate() {
  const { status, workspace } = useSession();
  if (status === "loading") return <Loading />;
  if (status === "signedOut") return <Redirect href="/sign-in" />;
  if (!workspace) return <Redirect href="/workspaces" />;
  return <Redirect href={isTeam ? "/today" : "/projects"} />;
}
