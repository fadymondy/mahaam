// Every customer tab is its own stack (expo-router shared routes), so the tab bar stays on screen
// inside a project, an issue or an invoice. The segment picks the tab's first screen.
import { Stack } from "expo-router";

import { useColors } from "@/grid";
import { isLiquidGlass } from "@/lib/platform";

const FIRST: Record<string, string> = {
  "(portal)": "portal",
  "(requests)": "requests",
  "(invoices)": "invoices",
  "(updates)": "updates",
  "(search)": "search",
};

export default function CustomerTabStack({ segment }: { segment: string }) {
  const c = useColors();
  return (
    <Stack initialRouteName={FIRST[segment] ?? "portal"} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
      {/* iOS 26+: the search screen's native header exists from the first frame, so its
          search controller is what iOS hosts as the Liquid Glass field in the tab bar. */}
      <Stack.Screen name="search" options={{ headerShown: isLiquidGlass() }} />
    </Stack>
  );
}
