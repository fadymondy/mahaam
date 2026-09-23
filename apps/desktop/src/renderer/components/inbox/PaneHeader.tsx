// A pane's 44px title-bar row, for views split into panes (the inbox). The window's own controls
// sit at physical corners — macOS traffic lights top-left, Windows/Linux caption buttons top-right —
// so which pane's header has to keep clear of them depends on the language direction and whether
// the sidebar is shown. Rather than guess, the header measures where it is and pads the corner it
// actually shares with the window.
import { PanelLeftOpenIcon } from "lucide-react";
import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useApp } from "@/lib/app";
import { useI18n } from "@/lib/i18n";
import { ShellContext } from "@/lib/shell";
import { cn } from "@/lib/utils";

const MAC_LIGHTS = 84;
const CAPTION_BUTTONS = 148;

export function PaneHeader({ children, className, start }: { children: ReactNode; className?: string; start?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const shell = useContext(ShellContext);
  const { config, fullscreen } = useApp();
  const { t, dir } = useI18n();
  const [pad, setPad] = useState<{ left?: number; right?: number }>({});
  const sidebarOpen = shell?.sidebarOpen ?? true;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const mac = config.platform === "darwin";
      const left = mac && !fullscreen && r.left < 8 ? MAC_LIGHTS : undefined;
      const right = !mac && r.right > window.innerWidth - 8 ? CAPTION_BUTTONS : undefined;
      setPad((p) => (p.left === left && p.right === right ? p : { left, right }));
    };
    measure();
    // The shell sets the direction, the sidebar state and full screen on <html> after this renders,
    // and none of them resizes the header — so watch them as well as the size.
    const frame = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const mo = new MutationObserver(measure);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["dir", "data-sidebar", "data-fullscreen"] });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [config.platform, fullscreen, sidebarOpen, dir]);

  return (
    <header
      ref={ref}
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
