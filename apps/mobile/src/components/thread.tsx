// A comment thread as one grid row: the comments (markdown), then the composer. Shared by the
// task, team-issue and portal-issue screens, which differ only in where the thread comes from.
//
// Comments reach other people, so each one has a "…" menu (App Store 1.2 / Play UGC): Delete on
// your own, Report on anyone else's. A reported comment is hidden for the reporter at once; the
// report goes to the workspace owners and support (POST /api/w/comments/{id}/report).
import { MoreHorizontal, Send } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { AppText, confirmDialog, ErrorLine, Field, ListItem, Markdown, Meta, PrimaryButton, Row, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";
import { Micro, useErrorText } from "./kit";

export type ThreadComment = { id: string; body: string; created_at: string; author?: string | null; agent?: boolean; mine?: boolean };

export function Thread({
  comments,
  onSend,
  sending,
  error,
  canWrite = true,
  onDelete,
  onReport,
}: {
  comments: ThreadComment[];
  onSend: (body: string) => Promise<unknown>;
  sending: boolean;
  error?: unknown;
  canWrite?: boolean;
  /** Deletes one of the person's own comments. */
  onDelete?: (id: string) => Promise<unknown>;
  /** Reports someone else's comment. */
  onReport?: (id: string) => Promise<unknown>;
}) {
  const t = useT();
  const f = useFormat();
  const c = useColors();
  const errText = useErrorText();
  const [body, setBody] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [modError, setModError] = useState<unknown>(null);

  const remove = async (id: string) => {
    if (!onDelete) return;
    const ok = await confirmDialog({
      title: t("tasks.deleteComment"),
      message: t("tasks.deleteCommentConfirm"),
      confirmLabel: t("tasks.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setModError(null);
    await onDelete(id).catch(setModError);
  };

  const report = async (id: string) => {
    if (!onReport) return;
    const ok = await confirmDialog({
      title: t("tasks.reportComment"),
      message: t("tasks.reportConfirm"),
      confirmLabel: t("tasks.reportSend"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setModError(null);
    try {
      await onReport(id);
      setHidden((h) => new Set(h).add(id));
      Alert.alert(t("tasks.reportComment"), t("tasks.reported"));
    } catch (e) {
      setModError(e);
    }
  };

  const menu = (cm: ThreadComment) => {
    if (cm.mine && onDelete) return () => void remove(cm.id);
    if (!cm.mine && onReport) return () => void report(cm.id);
    return null;
  };

  return (
    <Row style={{ paddingVertical: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 14, paddingBottom: 4 }}>
        <Micro style={{ flex: 1 }}>{t("tasks.comments")}</Micro>
        <AppText variant="mono">{comments.length}</AppText>
      </View>
      {comments.length === 0 ? (
        <AppText variant="meta" style={{ paddingVertical: 14 }}>
          {t("tasks.noComments")}
        </AppText>
      ) : null}
      {comments.map((cm, i) => {
        const open = menu(cm);
        return (
          <ListItem
            key={cm.id}
            alignTop
            last={i === comments.length - 1 && !canWrite}
            trailing={
              open && !hidden.has(cm.id) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={cm.mine ? t("tasks.deleteComment") : t("tasks.reportComment")}
                  hitSlop={12}
                  onPress={open}
                  style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.5 : 1 })}>
                  <MoreHorizontal size={18} color={c.muted} strokeWidth={1.6} />
                </Pressable>
              ) : undefined
            }>
            <Meta
              items={[cm.agent ? t("issues.agent") : cm.author, `${f.date(cm.created_at)} ${f.time(cm.created_at)}`].filter(Boolean) as string[]}
            />
            {hidden.has(cm.id) ? <AppText variant="meta">{t("tasks.reportedHidden")}</AppText> : <Markdown source={cm.body} />}
          </ListItem>
        );
      })}
      {modError ? <ErrorLine text={errText(modError)} /> : null}
      {canWrite ? (
        <View style={{ gap: 10, paddingVertical: 14 }}>
          <Field placeholder={t("tasks.addComment")} value={body} onChangeText={setBody} multiline />
          {error ? <ErrorLine text={errText(error)} /> : null}
          <PrimaryButton
            label={t("common.send")}
            icon={<Send size={17} color={c.onAction} strokeWidth={1.6} />}
            disabled={!body.trim() || sending}
            onPress={() => void onSend(body.trim()).then(() => setBody(""), () => {})}
          />
        </View>
      ) : null}
    </Row>
  );
}
