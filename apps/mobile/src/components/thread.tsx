// A comment thread as one grid row: the comments (markdown), then the composer. Shared by the
// task, team-issue and portal-issue screens, which differ only in where the thread comes from.
import { Send } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText, ErrorLine, Field, ListItem, Markdown, Meta, PrimaryButton, Row, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";
import { Micro, useErrorText } from "./kit";

export type ThreadComment = { id: string; body: string; created_at: string; author?: string | null; agent?: boolean };

export function Thread({
  comments,
  onSend,
  sending,
  error,
  canWrite = true,
}: {
  comments: ThreadComment[];
  onSend: (body: string) => Promise<unknown>;
  sending: boolean;
  error?: unknown;
  canWrite?: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const c = useColors();
  const errText = useErrorText();
  const [body, setBody] = useState("");

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
      {comments.map((cm, i) => (
        <ListItem key={cm.id} alignTop last={i === comments.length - 1 && !canWrite}>
          <Meta
            items={[cm.agent ? t("issues.agent") : cm.author, `${f.date(cm.created_at)} ${f.time(cm.created_at)}`].filter(Boolean) as string[]}
          />
          <Markdown source={cm.body} />
        </ListItem>
      ))}
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
