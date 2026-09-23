// What any view can ask of the shell: open quick-create (optionally in a project), the timer
// palette or ⌘K, and show/hide the sidebar.
import { createContext, useContext } from "react";

export interface Shell {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  openCreate: (projectId?: string | null) => void;
  openTimer: () => void;
  openPalette: () => void;
}

export const ShellContext = createContext<Shell | null>(null);

export function useShell(): Shell {
  const v = useContext(ShellContext);
  if (!v) throw new Error("useShell outside the app shell");
  return v;
}
