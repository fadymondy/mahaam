// File an issue in a project from the team side: title, markdown details, type, priority and the
// stage it starts in. Lands on the project's board; opens the new issue after.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Send } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";

import { Micro, useErrorText } from "@/components/kit";
import { useProject } from "@/features/projects";
import { ErrorLine, Field, FilterStrip, FooterBar, PrimaryButton, Row, Rows, Screen, StackHeader, useColors } from "@/grid";
import { useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { mahaam } from "@/lib/session";

const TYPES = ["bug", "feature", "task", "story"] as const;
const PRIORITIES = ["highest", "high", "medium", "low", "lowest"] as const;
const START = ["backlog", "todo", "in_progress"] as const;

export default function NewIssue() {
  const { project } = useLocalSearchParams<{ project: string }>();
  const t = useT();
  const c = useColors();
  const ws = useWs();
  const qc = useQueryClient();
  const errText = useErrorText();
  const p = useProject(project);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<string>("bug");
  const [priority, setPriority] = useState<string>("medium");
  const [stage, setStage] = useState<string>("todo");

  const create = useMutation({
    mutationFn: () => mahaam.issues.create({ title: title.trim(), body: body.trim() || undefined, project, issue_type: type, priority, status: stage }),
    onSuccess: (issue) => {
      void qc.invalidateQueries({ queryKey: ["issues", ws] });
      void qc.invalidateQueries({ queryKey: ["projects", ws] });
      router.replace({ pathname: "/issue/[key]", params: { key: issue.key } });
    },
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen
        header={<StackHeader title={t("issues.new")} subtitle={p.data?.name} />}
        footer={
          <FooterBar>
            <PrimaryButton
              label={t("issues.create")}
              icon={<Send size={17} color={c.onAction} strokeWidth={1.6} />}
              disabled={!title.trim() || create.isPending}
              onPress={() => create.mutate()}
            />
          </FooterBar>
        }>
        <Rows>
          <Row>
            <Field label={t("file.title")} value={title} onChangeText={setTitle} maxLength={200} autoFocus testID="issue-title" />
            <Field label={t("file.details")} value={body} onChangeText={setBody} multiline testID="issue-body" />
            {create.error ? <ErrorLine text={errText(create.error)} /> : null}
          </Row>
          <Row>
            <Micro>{t("file.type")}</Micro>
            <FilterStrip flush value={type} onChange={setType} options={TYPES.map((x) => ({ value: x, label: t(`issues.type.${x}`) }))} />
            <Micro>{t("issues.filter.priority")}</Micro>
            <FilterStrip flush value={priority} onChange={setPriority} options={PRIORITIES.map((x) => ({ value: x, label: t(`issues.priority.${x}`) }))} />
            <Micro>{t("issues.startsIn")}</Micro>
            <FilterStrip flush value={stage} onChange={setStage} options={START.map((x) => ({ value: x, label: t(`issues.status.${x}`) }))} />
          </Row>
        </Rows>
      </Screen>
    </KeyboardAvoidingView>
  );
}
