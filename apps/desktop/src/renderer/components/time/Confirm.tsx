// A destructive confirm (delete an entry, discard a running timer), as the platform's own alert — a
// sheet on the window on macOS — not an HTML dialog. Renders nothing; asks when `request` is set.
import { useEffect } from "react";

import { useI18n } from "@/lib/i18n";
import { nativeConfirm } from "@/lib/native";

export interface ConfirmRequest {
  title: string;
  body?: string;
  action: string;
  run: () => void;
}

export function Confirm({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!request) return;
    let live = true;
    void nativeConfirm({ message: request.title, detail: request.body, confirm: request.action, cancel: t("common.cancel"), destructive: true }).then((yes) => {
      if (!live) return;
      onClose();
      if (yes) request.run();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  return null;
}
