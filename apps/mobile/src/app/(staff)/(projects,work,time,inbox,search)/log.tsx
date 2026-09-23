import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";

import { useErrorText } from "@/components/kit";
import { ProjectPicker } from "@/components/project-picker";
import { useMyTasks, useProjects, useTimeSettings } from "@/features/team";
import { AppText, Checkbox, ErrorLine, Field, fonts, FooterBar, PrimaryButton, Row, Rows, Screen, StackHeader, useColors } from "@/grid";
import { useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { mahaam } from "@/lib/session";
import { formatDuration, localDay, parseMinutes } from "@/lib/time";

export default function LogTime() {
  const t = useT();
  const c = useColors();
  const ws = useWs();
  const qc = useQueryClient();
  const errText = useErrorText();
  const settings = useTimeSettings();
  const projects = useProjects();
  const { tasks } = useMyTasks();
  const [project, setProject] = useState<string | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [duration, setDuration] = useState("");
  const [description, setDescription] = useState("");
  const [billable, setBillable] = useState(true);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const today = localDay(new Date(), settings.data?.timezone);
  const projectTasks = (tasks.data ?? []).filter((x) => x.project_id === project && !x.completed_at);

  const log = useMutation({
    mutationFn: (minutes: number) =>
      mahaam.time.log({
        project: project ?? undefined,
        task: task ?? undefined,
        date: date.trim() || today,
        minutes,
        description: description.trim() || undefined,
        billable,
      }),
    onSuccess: (e) => {
      setMessage({ ok: true, text: t("log.saved", { duration: formatDuration(e.duration_s ?? 0) }) });
      setDuration("");
      setDescription("");
      void qc.invalidateQueries({ queryKey: ["entries", ws] });
      void qc.invalidateQueries({ queryKey: ["timesheet", ws] });
    },
    onError: (e) => setMessage({ ok: false, text: errText(e) }),
  });

  const submit = () => {
    const minutes = parseMinutes(duration);
    if (!minutes) return setMessage({ ok: false, text: t("log.badDuration") });
    setMessage(null);
    log.mutate(minutes);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen
        header={<StackHeader title={t("log.title")} />}
        footer={
          <FooterBar>
            <PrimaryButton
              label={t("log.submit")}
              icon={<Check size={18} color={c.onAction} strokeWidth={1.8} />}
              onPress={submit}
              disabled={log.isPending || !duration.trim()}
            />
          </FooterBar>
        }>
        <Rows inset>
          <Row>
            <ProjectPicker
              label={t("log.project")}
              projects={projects.data ?? []}
              value={project}
              onChange={(p) => {
                setProject(p);
                setTask(null);
              }}
            />
            {projectTasks.length ? (
              <ProjectPicker
                label={t("log.task")}
                allowNone
                projects={projectTasks.map((x) => ({ id: x.key, name: `${x.key} · ${x.title}`, color: "", archived_at: null }))}
                value={task}
                onChange={setTask}
              />
            ) : null}
          </Row>
          <Row>
            <Field label={t("log.date")} value={date} onChangeText={setDate} placeholder={today} autoCapitalize="none" inputMode="numeric" ltr />
            <Field label={t("log.duration")} value={duration} onChangeText={setDuration} placeholder="1h30" autoCapitalize="none" ltr testID="log-duration" />
            <Field label={t("log.description")} value={description} onChangeText={setDescription} />
            <Checkbox checked={billable} onChange={setBillable}>
              <AppText style={{ fontFamily: fonts.regular, fontSize: 13.5, color: c.body }}>{t("log.billable")}</AppText>
            </Checkbox>
            {message ? (
              <View accessibilityLiveRegion="polite">
                {message.ok ? <AppText style={{ fontFamily: fonts.regular, fontSize: 12.5, color: c.okText }}>{message.text}</AppText> : <ErrorLine text={message.text} />}
              </View>
            ) : null}
          </Row>
        </Rows>
      </Screen>
    </KeyboardAvoidingView>
  );
}
