// The update loader: while a new version downloads, a quiet progress line; once it's ready, a prompt
// to restart into it (or it installs by itself on the next quit). Lives at the foot of the sidebar,
// above the timer, where it never covers work.
import { DownloadIcon, RotateCwIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { UpdateState } from "../../main/updates";
import { desktop, on } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";

export function UpdatePill() {
  const { t } = useI18n();
  const [u, setU] = useState<UpdateState>({ state: "idle" });
  useEffect(() => {
    void desktop.update.state().then(setU, () => null);
    return on("update", setU);
  }, []);
  if (u.state === "downloading") {
    return (
      <div className="border-t border-line px-3 py-2.5" role="status" data-update="downloading">
        <p className="flex items-center gap-2 text-[12.5px] text-grid-body">
          <DownloadIcon className="size-3.5 text-grid-muted" />
          <span className="flex-1 truncate">{t("update.downloading", { version: u.version })}</span>
          <span dir="ltr" className="font-mono text-[12px] text-grid-muted tabular-nums">
            {u.percent}%
          </span>
        </p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-grid-soft">
          <div className="h-full rounded-full bg-grid-action transition-[width] duration-300" style={{ width: `${u.percent}%` }} />
        </div>
      </div>
    );
  }
  if (u.state === "ready") {
    return (
      <div className="border-t border-line p-2.5" data-update="ready">
        <div className="rounded-md border border-[color-mix(in_oklab,var(--grid-action)_35%,transparent)] bg-[color-mix(in_oklab,var(--grid-action)_10%,transparent)] px-2.5 py-2">
          <p className="text-[13px] font-medium text-grid-fg">{t("update.ready", { version: u.version })}</p>
          <p className="mt-0.5 text-[12px] text-grid-muted">{t("update.readyHint")}</p>
          <button
            type="button"
            onClick={() => void desktop.update.install()}
            className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md bg-grid-action px-2.5 text-[13px] font-medium text-grid-on-action hover:opacity-90"
            data-update-install
          >
            <RotateCwIcon className="size-3.5" />
            {t("update.restart")}
          </button>
        </div>
      </div>
    );
  }
  return null;
}
