// A workspace issue, team side — everything the web's issue sheet can do (MH-350): move it between
// the project's columns, set priority and type, close or reopen with a resolution, mark it
// human-only, assign people, edit the title and body, share its link, start a timer, and the
// comment thread.
//
// Separate from portal-issue/[key], the customer's view: a different endpoint, shape and set of
// permissions — sharing one screen would mean branching on role everywhere, which is how a customer
// ends up seeing an internal comment.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Check, Pencil, Play, RotateCcw, Share2, UserPlus, XCircle } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Share, Switch, View } from "react-native";

import { Actions, Chip, Grow, Micro, projectColor, useErrorText } from "@/components/kit";
import { PRIORITY_TONE, TYPE_TONE } from "@/components/issue-board";
import { LineTabs } from "@/components/line-tabs";
import { Thread } from "@/components/thread";
import { useMembers, useMoveToColumn, useProject } from "@/features/projects";
import { useRunning, useStartTimer } from "@/features/team";
import {
  AppText,
  BottomSheet,
  Checkbox,
  ErrorLine,
  Field,
  fonts,
  Markdown,
  Meta,
  PrimaryButton,
  Row,
  Rows,
  Screen,
  SecondaryButton,
  SheetDivider,
  SkeletonRow,
  StackHeader,
  StateRow,
  useColors,
} from "@/grid";
import { useFormat, useI18n } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { mahaam, useSession } from "@/lib/session";
import { fs } from "@/lib/type-scale";

const PRIORITIES = ["highest", "high", "medium", "low", "lowest"] as const;
const TYPES = ["bug", "feature", "task", "story", "epic"] as const;
const WEB = (process.env.EXPO_PUBLIC_WEB_URL || "https://console.mahaam.app").replace(/\/$/, "");

export default function TeamIssueScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { t, locale } = useI18n();
  const f = useFormat();
  const c = useColors();
  const ws = useWs();
  const qc = useQueryClient();
  const errText = useErrorText();
  const { workspace, user } = useSession();
  const running = useRunning();
  const start = useStartTimer();
  const members = useMembers();

  const q = useQuery({ queryKey: qk.issue(ws, key), queryFn: () => mahaam.issues.get(key), enabled: !!ws && !!key });
  const task = useQuery({ queryKey: qk.task(ws, key), queryFn: () => mahaam.tasks.get(key), enabled: !!ws && !!key, retry: false });
  const i = q.data;
  const project = useProject(i?.project_id ?? "");
  const move = useMoveToColumn(i?.project_id ?? "");
  const canWrite = project.data?.can_write ?? true;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.issue(ws, key) });
    void qc.invalidateQueries({ queryKey: qk.task(ws, key) });
    void qc.invalidateQueries({ queryKey: ["issues", ws] });
    void qc.invalidateQueries({ queryKey: ["projects", ws] });
  };
  const patch = useMutation({ mutationFn: (p: Parameters<typeof mahaam.issues.update>[1]) => mahaam.issues.update(key, p), onSuccess: refresh });
  const comment = useMutation({ mutationFn: (body: string) => mahaam.issues.comment(key, body), onSuccess: refresh });
  const assign = useMutation({ mutationFn: (ids: string[]) => mahaam.issues.assignees(key, ids), onSuccess: refresh });

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [closing, setClosing] = useState(false);
  const [resolution, setResolution] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    if (i) {
      setTitle(i.title);
      setBody(i.body ?? "");
    }
  }, [i]);
  useEffect(() => setPicked(task.data?.assignee_ids ?? []), [task.data?.assignee_ids]);

  const columns = [...(project.data?.statuses ?? [])].sort((a, b) => a.position - b.position);
  const column = i ? (i.column_id ?? columns.find((x) => x.stage === i.status)?.id) : undefined;
  const isRunning = !!i && running.data?.task_key === i.key;
  const closed = i?.state === "closed";
  const emails = new Map((members.data ?? []).map((m) => [m.user_id, m.email]));
  const assignees = (task.data?.assignee_ids ?? []).map((id) => emails.get(id) ?? id);
  const error = patch.error ?? move.error ?? assign.error ?? start.error;

  const share = () => {
    if (!i) return;
    const url = `${WEB}/${locale}/w/${workspace?.slug ?? ""}/projects/${i.project_id ?? ""}/issues/${i.key}`;
    void Share.share({ message: `${i.key} · ${i.title}\n${url}`, url });
  };

  return (
    <Screen
      header={
        <StackHeader
          title={i?.title ?? key}
          subtitle={key}
          trailing={
            i ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t("issues.share")} hitSlop={10} onPress={share}>
                <Share2 size={19} color={c.muted} strokeWidth={1.6} />
              </Pressable>
            ) : undefined
          }
        />
      }
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}>
      <Rows>
        {q.isPending ? <SkeletonRow lines={3} /> : null}
        {q.isError ? <StateRow state="error" message={errText(q.error)} onRetry={() => void q.refetch()} /> : null}
        {i ? (
          <>
            <Row style={{ borderStartWidth: 2, borderStartColor: projectColor(project.data?.color) }}>
              <AppText variant="title">{i.title}</AppText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                <Chip label={t(`issues.type.${i.issue_type}` as "issues.type.bug")} dot={TYPE_TONE[i.issue_type]} />
                <Chip label={t(`issues.priority.${i.priority}` as "issues.priority.medium")} dot={PRIORITY_TONE[i.priority]} />
                {closed ? <Chip label={t("issues.state.closed")} tone="ok" /> : null}
                {i.human_only ? <Chip label={t("issues.humanOnly")} tone="gold" /> : null}
              </View>
              <Meta items={[project.data?.name, f.date(i.created_at), assignees.length ? assignees.join(", ") : null].filter(Boolean) as string[]} />
              <PrimaryButton
                label={isRunning ? t("timer.running") : t("tasks.startTimer", { key: i.key })}
                icon={<Play size={17} color={c.onAction} strokeWidth={1.8} />}
                disabled={isRunning || closed || start.isPending}
                onPress={() => start.mutate({ task: i.key, project: i.project_id ?? undefined })}
              />
              {error ? <ErrorLine text={errText(error)} /> : null}
            </Row>

            {columns.length ? (
              <Row style={{ paddingHorizontal: 0, paddingBottom: 0 }}>
                <Micro style={{ paddingHorizontal: 28 }}>{t("issues.moveTo")}</Micro>
                <LineTabs<string>
                  options={columns.map((col) => ({ value: col.id, label: col.name }))}
                  value={column ?? ""}
                  onChange={(col) => canWrite && col !== column && !move.isPending && move.mutate({ key: i.key, column: col })}
                />
              </Row>
            ) : null}

            <Row style={{ paddingHorizontal: 0, paddingBottom: 0 }}>
              <Micro style={{ paddingHorizontal: 28 }}>{t("issues.filter.priority")}</Micro>
              <LineTabs<string>
                options={PRIORITIES.map((p) => ({ value: p, label: t(`issues.priority.${p}`) }))}
                value={i.priority}
                onChange={(p) => canWrite && p !== i.priority && patch.mutate({ priority: p })}
              />
              <Micro style={{ paddingHorizontal: 28 }}>{t("issues.filter.type")}</Micro>
              <LineTabs<string>
                options={TYPES.map((x) => ({ value: x, label: t(`issues.type.${x}`) }))}
                value={i.issue_type}
                onChange={(x) => canWrite && x !== i.issue_type && patch.mutate({ issue_type: x })}
              />
            </Row>

            <Row>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Micro style={{ flex: 1 }}>{t("tasks.description")}</Micro>
                {canWrite ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={t("issues.edit")} hitSlop={10} onPress={() => setEditing(true)}>
                    <Pencil size={16} color={c.muted} strokeWidth={1.6} />
                  </Pressable>
                ) : null}
              </View>
              {i.body ? <Markdown source={i.body} /> : <AppText variant="meta">{t("issues.noBody")}</AppText>}
              {i.resolution ? (
                <View style={{ borderStartWidth: 2, borderStartColor: c.ok, paddingStart: 10 }}>
                  <Micro>{t("issues.resolution")}</Micro>
                  <AppText>{i.resolution}</AppText>
                </View>
              ) : null}
            </Row>

            {canWrite ? (
              <Row>
                <Actions>
                  <Grow>
                    <SecondaryButton label={t("issues.assign")} icon={<UserPlus size={16} color={c.muted} strokeWidth={1.6} />} onPress={() => setAssigning(true)} />
                  </Grow>
                  <Grow>
                    {closed ? (
                      <SecondaryButton label={t("issues.reopen")} icon={<RotateCcw size={16} color={c.muted} strokeWidth={1.6} />} onPress={() => patch.mutate({ state: "open" })} />
                    ) : (
                      <SecondaryButton label={t("issues.close")} icon={<XCircle size={16} color={c.muted} strokeWidth={1.6} />} onPress={() => setClosing(true)} />
                    )}
                  </Grow>
                </Actions>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <AppText style={{ flex: 1, fontFamily: fonts.regular, fontSize: fs.item, color: c.fg }}>{t("issues.humanOnlyToggle")}</AppText>
                  <Switch value={i.human_only} onValueChange={(v) => patch.mutate({ human_only: v })} trackColor={{ true: c.gold, false: c.soft }} accessibilityLabel={t("issues.humanOnlyToggle")} />
                </View>
              </Row>
            ) : null}

            <Thread
              comments={(i.comments ?? []).map((cm) => ({
                id: cm.id,
                body: cm.body,
                created_at: cm.created_at,
                agent: cm.author_kind === "agent",
                mine: !!user && cm.author_id === user.id && cm.author_kind !== "agent",
              }))}
              onSend={(b) => comment.mutateAsync(b)}
              sending={comment.isPending}
              error={comment.error}
              onDelete={(id) => mahaam.issues.deleteComment(key, id).then(refresh)}
              onReport={(id) => mahaam.reportComment(id)}
            />
          </>
        ) : null}
      </Rows>

      <BottomSheet visible={editing} onClose={() => setEditing(false)}>
        <AppText variant="title">{t("issues.edit")}</AppText>
        <Field label={t("file.title")} value={title} onChangeText={setTitle} maxLength={200} />
        <Field label={t("file.details")} value={body} onChangeText={setBody} multiline />
        <PrimaryButton
          label={t("common.save")}
          icon={<Check size={17} color={c.onAction} strokeWidth={1.8} />}
          disabled={patch.isPending || !title.trim()}
          onPress={() => patch.mutate({ title: title.trim(), body }, { onSuccess: () => setEditing(false) })}
        />
      </BottomSheet>

      <BottomSheet visible={closing} onClose={() => setClosing(false)}>
        <AppText variant="title">{t("issues.close")}</AppText>
        <Field label={t("issues.resolution")} value={resolution} onChangeText={setResolution} multiline placeholder={t("issues.resolutionHint")} />
        <PrimaryButton
          label={t("issues.close")}
          disabled={patch.isPending}
          onPress={() => patch.mutate({ state: "closed", resolution: resolution.trim() || undefined }, { onSuccess: () => setClosing(false) })}
        />
      </BottomSheet>

      <BottomSheet visible={assigning} onClose={() => setAssigning(false)}>
        <Micro>{t("issues.assign")}</Micro>
        <SheetDivider />
        {(members.data ?? [])
          .filter((m) => m.role !== "client" && m.status === "active")
          .map((m) => (
            <Checkbox key={m.user_id} checked={picked.includes(m.user_id)} onChange={(on) => setPicked((p) => (on ? [...p, m.user_id] : p.filter((x) => x !== m.user_id)))}>
              <AppText style={{ fontFamily: fonts.regular, fontSize: fs.item, color: c.fg, writingDirection: "ltr" }}>{m.email}</AppText>
            </Checkbox>
          ))}
        <PrimaryButton label={t("common.save")} disabled={assign.isPending} onPress={() => assign.mutate(picked, { onSuccess: () => setAssigning(false) })} />
      </BottomSheet>
    </Screen>
  );
}
