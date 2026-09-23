import { Redirect } from "expo-router";
import { Bell, FolderOpen, MessageSquarePlus, ReceiptText, Search } from "lucide-react-native";

import { ShellTabs, type ShellTab } from "@/components/shell-tabs";
import { LiveProvider } from "@/lib/live";
import { isCustomer, useSession } from "@/lib/session";

const TABS: ShellTab[] = [
  { name: "(portal)", label: "tabs.projects", Icon: FolderOpen, sf: { default: "folder", selected: "folder.fill" } },
  { name: "(requests)", label: "tabs.requests", Icon: MessageSquarePlus, sf: { default: "text.bubble", selected: "text.bubble.fill" } },
  { name: "(invoices)", label: "tabs.invoices", Icon: ReceiptText, sf: { default: "doc.text", selected: "doc.text.fill" } },
  { name: "(updates)", label: "tabs.inbox", Icon: Bell, sf: { default: "bell", selected: "bell.fill" } },
  { name: "(search)", label: "common.search", Icon: Search, sf: { default: "magnifyingglass", selected: "magnifyingglass" }, search: true },
];

export const unstable_settings = { initialRouteName: "(portal)" };

/** A customer of the selected workspace: the portal. */
export default function CustomerLayout() {
  const { status, workspace } = useSession();
  if (status !== "signedIn" || !workspace || !isCustomer(workspace)) return <Redirect href="/" />;
  return (
    <LiveProvider>
      <ShellTabs tabs={TABS} />
    </LiveProvider>
  );
}
