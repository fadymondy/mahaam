// A destructive confirm (delete an entry, discard a running timer). Enter confirms, Esc cancels.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/lib/i18n";

export interface ConfirmRequest {
  title: string;
  body?: string;
  action: string;
  run: () => void;
}

export function Confirm({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <AlertDialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent size="sm" data-time-confirm className="gap-3">
        <AlertDialogHeader className="place-items-start text-start">
          <AlertDialogTitle className="text-[14.5px]">{request?.title}</AlertDialogTitle>
          {request?.body ? <AlertDialogDescription className="text-[13.5px]">{request.body}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter className="flex! flex-row! justify-end! gap-2 px-4 py-3">
          <AlertDialogCancel size="sm">{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            size="sm"
            variant="destructive"
            autoFocus
            data-time-confirm-ok
            onClick={() => {
              request?.run();
              onClose();
            }}
          >
            {request?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
