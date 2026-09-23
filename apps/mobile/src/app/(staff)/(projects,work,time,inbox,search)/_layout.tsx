// Every staff tab is its own stack (expo-router shared routes): the project, issue and task screens
// live in each, so the tab bar stays on screen inside them and "back" stays within the tab. The
// segment picks the tab's first screen.
import { Stack } from "expo-router";

import { useColors } from "@/grid";
import { isLiquidGlass } from "@/lib/platform";

const FIRST: Record<string, string> = {
  "(projects)": "projects",
  "(work)": "work",
  "(time)": "time",
  "(inbox)": "inbox",
  "(search)": "search",
};

export default function StaffTabStack({ segment }: { segment: string }) {
  const c = useColors();
  return (
    <Stack initialRouteName={FIRST[segment] ?? "projects"} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
      {/* iOS 26+: the search screen's native header exists from the first frame, so its
          search controller is what iOS hosts as the Liquid Glass field in the tab bar. */}
      <Stack.Screen name="search" options={{ headerShown: isLiquidGlass() }} />
    </Stack>
  );
}
