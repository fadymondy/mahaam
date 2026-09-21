import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Switch, View } from "react-native";

import { ProjectPicker } from "@/components/project-picker";
import { Button, Card, Field, Row, Screen, T, useErrorText } from "@/components/ui";
import { useMyTasks, useProjects, useTimeSettings } from "@/features/team";
import { useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { mahaam } from "@/lib/session";
import { formatDuration, localDay, parseMinutes } from "@/lib/time";
import { useTheme } from "@/theme";
import { space } from "@/theme/tokens";

export default function LogTime() {
  const t = useT();
  const ws = useWs();
  const qc = useQueryClient();
  const { c } = useTheme();
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
    <Screen edges={[]}>
      <Card style={{ gap: space.md }}>
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
            projects={projectTasks.map((x) => ({
              id: x.key,
              name: `${x.key} · ${x.title}`,
              color: "",
              archived_at: null,
            }))}
            value={task}
            onChange={setTask}
          />
        ) : null}
        <Field label={t("log.date")} value={date} onChangeText={setDate} placeholder={today} autoCapitalize="none" inputMode="numeric" />
        <Field label={t("log.duration")} value={duration} onChangeText={setDuration} placeholder="1h30" autoCapitalize="none" testID="log-duration" />
        <Field label={t("log.description")} value={description} onChangeText={setDescription} />
        <Row style={{ justifyContent: "space-between", minHeight: 44 }}>
          <T>{t("log.billable")}</T>
          <Switch
            accessibilityLabel={t("log.billable")}
            value={billable}
            onValueChange={setBillable}
            trackColor={{ true: c.brand, false: c.line }}
          />
        </Row>
        <Button label={t("log.submit")} onPress={submit} busy={log.isPending} disabled={!duration.trim()} />
        {message ? (
          <View accessibilityLiveRegion="polite">
            <T tone={message.ok ? "ok" : "danger"} role={message.ok ? "text" : "alert"}>
              {message.text}
            </T>
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}
