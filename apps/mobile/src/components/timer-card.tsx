import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Platform, View } from "react-native";

import type { TimeEntry } from "@/api/types";
import { useProjects, useStartTimer, useStopTimer } from "@/features/team";
import { useFormat, useT } from "@/i18n";
import { useNow } from "@/lib/hooks";
import { entrySeconds, formatClock } from "@/lib/time";
import { useTheme } from "@/theme";
import { projectColor, space } from "@/theme/tokens";
import { ProjectPicker } from "./project-picker";
import { Button, Card, Field, Row, T, useErrorText } from "./ui";

const tap = () => {
  if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
};

/** The big card on Today: the running clock with Stop / Switch, or a quick start form. */
export function TimerCard({ running }: { running: TimeEntry | null }) {
  const t = useT();
  const f = useFormat();
  const { c } = useTheme();
  const errText = useErrorText();
  const now = useNow(1000, !!running);
  const projects = useProjects();
  const start = useStartTimer();
  const stop = useStopTimer();
  const [switching, setSwitching] = useState(false);
  const [desc, setDesc] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const error = start.error ?? stop.error;

  const doStart = () => {
    tap();
    start.mutate(
      { description: desc.trim() || undefined, project: project ?? undefined },
      {
        onSuccess: () => {
          setDesc("");
          setSwitching(false);
        },
      },
    );
  };

  const form = (
    <View style={{ gap: space.md }}>
      <Field
        label={t("timer.whatAreYouDoing")}
        value={desc}
        onChangeText={setDesc}
        onSubmitEditing={doStart}
        returnKeyType="go"
        testID="timer-desc"
      />
      <ProjectPicker label={t("log.project")} projects={projects.data ?? []} value={project} onChange={setProject} />
      <Row>
        <Button label={running ? t("timer.switch") : t("timer.start")} onPress={doStart} busy={start.isPending} style={{ flex: 1 }} />
        {switching ? <Button variant="secondary" label={t("common.cancel")} onPress={() => setSwitching(false)} /> : null}
      </Row>
    </View>
  );

  if (!running) {
    return (
      <Card>
        <T size="sm" tone="muted" weight="600">
          {t("timer.idle")}
        </T>
        {form}
        {error ? (
          <T tone="danger" role="alert">
            {errText(error)}
          </T>
        ) : null}
      </Card>
    );
  }

  const what = running.task_key
    ? `${running.task_key} · ${running.task_title ?? ""}`
    : running.description || t("timer.noProject");
  const secs = entrySeconds(running, now);
  return (
    <Card accent={projectColor(running.project_color)} style={{ backgroundColor: c.elevated }}>
      <Row style={{ justifyContent: "space-between" }}>
        <T size="sm" tone="ok" weight="700">
          {`● ${t("timer.running")}`}
        </T>
        <T size="sm" tone="muted">
          {t("timer.startedAt", { time: f.time(running.started_at) })}
        </T>
      </Row>
      <View accessible accessibilityRole="timer" accessibilityLabel={`${t("timer.running")}: ${formatClock(secs)}`}>
        <T size="clock" weight="700" style={{ fontVariant: ["tabular-nums"], writingDirection: "ltr" }}>
          {formatClock(secs)}
        </T>
      </View>
      <T weight="500" numberOfLines={2}>
        {what}
      </T>
      {running.project_name ? <T tone="body">{running.project_name}</T> : null}
      {switching ? (
        form
      ) : (
        <Row>
          <Button
            variant="danger"
            label={t("timer.stop")}
            onPress={() => {
              tap();
              stop.mutate();
            }}
            busy={stop.isPending}
            style={{ flex: 1 }}
          />
          <Button variant="secondary" label={t("timer.switch")} onPress={() => setSwitching(true)} style={{ flex: 1 }} />
        </Row>
      )}
      {error ? (
        <T tone="danger" role="alert">
          {errText(error)}
        </T>
      ) : null}
    </Card>
  );
}
