import { Redirect } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { Bell, FolderOpen, MessageSquarePlus, ReceiptText } from "lucide-react-native";

import { GridTabBar, type GridTab } from "@/grid";
import { LiveProvider } from "@/lib/live";
import { isCustomer, useSession } from "@/lib/session";

// Labels are string keys: the grid's tab bar translates them.
const TABS: GridTab[] = [
  { name: "portal", label: "tabs.projects", Icon: FolderOpen },
  { name: "requests", label: "tabs.requests", Icon: MessageSquarePlus },
  { name: "invoices", label: "tabs.invoices", Icon: ReceiptText },
  { name: "updates", label: "tabs.inbox", Icon: Bell },
];

/** A customer of the selected workspace: the portal. */
export default function CustomerLayout() {
  const { status, workspace } = useSession();
  if (status !== "signedIn" || !workspace || !isCustomer(workspace)) return <Redirect href="/" />;
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
