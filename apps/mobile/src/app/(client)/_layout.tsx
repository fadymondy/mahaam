import { Redirect } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { Bell, FolderOpen, ReceiptText } from "lucide-react-native";

import { isTeam } from "@/config";
import { GridTabBar, type GridTab } from "@/grid";
import { LiveProvider } from "@/lib/live";
import { useSession } from "@/lib/session";

// Labels are string keys: the grid's tab bar translates them.
const TABS: GridTab[] = [
  { name: "projects", label: "tabs.projects", Icon: FolderOpen },
  { name: "invoices", label: "tabs.invoices", Icon: ReceiptText },
  { name: "updates", label: "tabs.inbox", Icon: Bell },
];

export default function ClientLayout() {
  const { status, workspace } = useSession();
  if (isTeam || status !== "signedIn" || !workspace) return <Redirect href="/" />;
  return (
    <LiveProvider>
      <Tabs screenOptions={{ headerShown: false }} tabBar={(p) => <GridTabBar {...p} tabs={TABS} />}>
        {TABS.map((tab) => (
          <Tabs.Screen key={tab.name} name={tab.name} />
        ))}
      </Tabs>
    </LiveProvider>
  );
}
