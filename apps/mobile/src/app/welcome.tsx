// First run: pick a language. Arabic flips the app to RTL (one controlled reload, see the grid's
// prefs); either way the gate takes over after.
import { router } from "expo-router";

import { WelcomeScreen } from "@/grid";

export default function Welcome() {
  return <WelcomeScreen onDone={() => router.replace("/")} />;
}
