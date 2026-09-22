import * as Haptics from "expo-haptics";
import { ArrowLeftRight, Play } from "lucide-react-native";
import { useState } from "react";
import { Platform, View } from "react-native";

import type { TimeEntry } from "@/api/types";
import { useProjects, useStartTimer, useStopTimer } from "@/features/team";
import { AppText, ErrorLine, Field, fonts, Meta, PrimaryButton, Row, SecondaryButton, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";
import { useNow } from "@/lib/hooks";
import { entrySeconds, formatClock } from "@/lib/time";
import { Actions, DangerButton, Grow, Micro, projectColor, useErrorText } from "./kit";
import { ProjectPicker } from "./project-picker";

const tap = () => {
  if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
};

/** The timer row on Today: the running clock with Stop / Switch, or a quick start form. */
export function TimerCard({ running }: { running: TimeEntry | null }) {
  const t = useT();
  const f = useFormat();
  const c = useColors();
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
    <>
      <Field label={t("timer.whatAreYouDoing")} value={desc} onChangeText={setDesc} onSubmitEditing={doStart} returnKeyType="go" testID="timer-desc" />
      <ProjectPicker label={t("log.project")} projects={projects.data ?? []} value={project} onChange={setProject} />
      <Actions>
        <Grow>
          <PrimaryButton
            label={running ? t("timer.switch") : t("timer.start")}
            icon={<Play size={17} color={c.onAction} strokeWidth={1.8} />}
            onPress={doStart}
            disabled={start.isPending}
          />
        </Grow>
        {switching ? <SecondaryButton label={t("common.cancel")} onPress={() => setSwitching(false)} /> : null}
      </Actions>
    </>
  );

  if (!running) {
    return (
      <Row>
        <Micro>{t("timer.idle")}</Micro>
        {form}
        {error ? <ErrorLine text={errText(error)} /> : null}
      </Row>
    );
  }

  const what = running.task_key ? `${running.task_key} · ${running.task_title ?? ""}` : running.description || t("timer.noProject");
  const secs = entrySeconds(running, now);
  return (
    <Row style={{ borderStartWidth: 2, borderStartColor: projectColor(running.project_color) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 7, height: 7, borderRadius: 1.5, backgroundColor: c.ok }} />
        <Micro style={{ flex: 1, color: c.okText }}>{t("timer.running")}</Micro>
        <Meta items={[t("timer.startedAt", { time: f.time(running.started_at) })]} />
      </View>
      <View accessible accessibilityRole="timer" accessibilityLabel={`${t("timer.running")}: ${formatClock(secs)}`}>
        <AppText style={{ fontFamily: fonts.mono, fontSize: 44, lineHeight: 54, color: c.fg, fontVariant: ["tabular-nums"], writingDirection: "ltr", textAlign: "left", alignSelf: "flex-start" }}>
          {formatClock(secs)}
        </AppText>
      </View>
      <AppText variant="rowTitle" numberOfLines={2}>
        {what}
      </AppText>
      {running.project_name ? <Meta items={[running.project_name]} /> : null}
      {switching ? (
        form
      ) : (
        <Actions>
          <Grow>
            <DangerButton
              label={t("timer.stop")}
              onPress={() => {
                tap();
                stop.mutate();
              }}
              disabled={stop.isPending}
            />
          </Grow>
          <Grow>
            <SecondaryButton label={t("timer.switch")} icon={<ArrowLeftRight size={17} color={c.muted} strokeWidth={1.6} />} onPress={() => setSwitching(true)} />
          </Grow>
        </Actions>
      )}
      {error ? <ErrorLine text={errText(error)} /> : null}
    </Row>
  );
}
