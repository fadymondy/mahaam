// A pane's 44px title-bar row, for views split into panes (the inbox). The window's own controls
// sit at physical corners — the macOS traffic lights top-left, or top-right when the app runs
// right-to-left natively (Arabic); Windows/Linux caption buttons top-right — so which pane's header has to keep clear of them depends on the language direction and whether
// the sidebar is shown. Rather than guess, the header measures where it is and pads the corner it
// actually shares with the window.
import { PanelLeftOpenIcon } from "lucide-react";
import { useContext, type ReactNode } from "react";

import { useWindowControlsPadding } from "@/components/kit";
import { useI18n } from "@/lib/i18n";
import { ShellContext } from "@/lib/shell";
import { cn } from "@/lib/utils";

export function PaneHeader({ children, className, start }: { children: ReactNode; className?: string; start?: boolean }) {
  const shell = useContext(ShellContext);
  const { t } = useI18n();
  // The same measurement as every title-bar row (components/kit.tsx): pads whichever corner it
  // shares with the window's buttons — the traffic lights on either side, or caption buttons.
  const pad = useWindowControlsPadding();
  const sidebarOpen = shell?.sidebarOpen ?? true;

  return (
    <header
      ref={pad.ref}
      data-view-header
      style={{ paddingLeft: pad.left, paddingRight: pad.right }}
      className={cn("drag flex h-11 shrink-0 items-center gap-2 border-b border-line px-4", className)}
    >
      {start && shell && !sidebarOpen ? (
        <button
          type="button"
          onClick={shell.toggleSidebar}
          title={t("nav.expand")}
          aria-label={t("nav.expand")}
          className="-ms-1 flex size-7 items-center justify-center rounded-md text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
        >
          <PanelLeftOpenIcon className="size-4 rtl:-scale-x-100" />
        </button>
      ) : null}
      {children}
    </header>
  );
}
