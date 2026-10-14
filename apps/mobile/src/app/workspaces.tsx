// The workspace picker — and, for someone in none yet, the way forward: join by the admin's
// invitation (pull to refresh once it's accepted) or create one (the server makes the caller its
// owner; it needs a verified email). The header's gear reaches the Profile hub from here too, so a
// new account can finish verifying, edit itself or delete itself before it has any workspace.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { LogOut, Plus, Settings } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";

import { ApiError } from "@/api/client";
import { Chip, useErrorText } from "@/components/kit";
import {
  AppText,
  ErrorLine,
  Field,
  fonts,
  ForwardChevron,
  Header,
  IconButton,
  ListItem,
  PrimaryButton,
  Row,
  Rows,
  Screen,
  SecondaryButton,
  SkeletonRow,
  StateRow,
  TextButton,
  useColors,
} from "@/grid";
import { useI18n } from "@/i18n";
import { mahaam, useSession } from "@/lib/session";
import { fs, lh } from "@/lib/type-scale";

export default function Workspaces() {
  const { t, locale } = useI18n();
  const c = useColors();
  const qc = useQueryClient();
  const errText = useErrorText();
  const { status, workspace, chooseWorkspace, signOut, user } = useSession();
  const q = useQuery({ queryKey: ["workspaces", user?.id], queryFn: mahaam.workspaces, enabled: status === "signedIn" });
  const list = q.data?.workspaces ?? [];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () => mahaam.createWorkspace(name.trim(), locale === "ar" ? "ar" : "en"),
    onSuccess: async ({ workspace: ws }) => {
      await qc.invalidateQueries({ queryKey: ["workspaces"] });
      await chooseWorkspace(ws);
      router.replace("/");
    },
  });
  const unverified = create.error instanceof ApiError && (create.error.body as { code?: string } | undefined)?.code === "email_unverified";

  // Only one workspace and none chosen yet → take it. (Staff or customer, the app fits both.)
  useEffect(() => {
    if (!workspace && list.length === 1) void chooseWorkspace(list[0]!).then(() => router.replace("/"));
  }, [workspace, list, chooseWorkspace]);

  if (status === "signedOut") return <Redirect href="/sign-in" />;

  const none = q.data && list.length === 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen
        header={
          <Header
            title={t("ws.title")}
            count={q.data && list.length ? list.length : undefined}
            trailing={<IconButton label={t("common.settings")} onPress={() => router.push("/settings")}>
                <Settings size={20} color={c.fg} strokeWidth={1.6} />
              </IconButton>}
          />
        }
        refreshing={q.isRefetching}
        onRefresh={() => void q.refetch()}>
        <Rows inset>
          {q.isPending ? <SkeletonRow /> : null}
          {q.isError ? <StateRow state="error" message={errText(q.error)} onRetry={() => void q.refetch()} /> : null}
          {none ? (
            <Row>
              <AppText variant="rowTitle">{t("ws.noneTitle")}</AppText>
              <AppText style={{ fontFamily: fonts.regular, fontSize: fs.body, lineHeight: lh(fs.body), color: c.body }}>{t("ws.noneBody")}</AppText>
            </Row>
          ) : null}
          {list.length ? (
            <Row style={{ paddingVertical: 0 }}>
              {list.map((w, i) => (
                <ListItem
                  key={w.id}
                  last={i === list.length - 1}
                  trailing={<ForwardChevron />}
                  onPress={() => void chooseWorkspace(w).then(() => router.replace("/"))}>
                  <AppText variant="rowTitle">{w.name}</AppText>
                  <Chip label={t(`ws.role.${w.role}` as "ws.role.member")} tone={w.role === "client" ? "gold" : "neutral"} />
                </ListItem>
              ))}
            </Row>
          ) : null}

          {q.data ? (
            creating || none ? (
              <Row>
                <AppText variant="rowTitle">{t("ws.create")}</AppText>
                <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, lineHeight: lh(fs.meta), color: c.muted }}>{t("ws.createBody")}</AppText>
                <Field label={t("ws.namePlaceholder")} value={name} onChangeText={setName} maxLength={80} autoCapitalize="words" returnKeyType="done" onSubmitEditing={() => name.trim() && create.mutate()} />
                {create.error ? (
                  <>
                    <ErrorLine text={unverified ? t("ws.unverified") : create.error instanceof ApiError && create.error.status === 409 ? t("ws.taken") : errText(create.error)} />
                    {unverified ? <TextButton label={t("ws.verifyNow")} onPress={() => router.push("/verify-email")} /> : null}
                  </>
                ) : null}
                <PrimaryButton
                  label={t("ws.createSubmit")}
                  icon={<Plus size={18} color={c.onAction} strokeWidth={1.6} />}
                  disabled={create.isPending || !name.trim()}
                  onPress={() => create.mutate()}
                />
              </Row>
            ) : (
              <Row>
                <SecondaryButton label={t("ws.create")} icon={<Plus size={17} color={c.muted} strokeWidth={1.6} />} onPress={() => setCreating(true)} />
              </Row>
            )
          ) : null}

          <Row>
            <AppText variant="micro">{t("auth.email")}</AppText>
            <AppText variant="rowTitle" style={{ writingDirection: "ltr" }}>
              {user?.email}
            </AppText>
            <SecondaryButton label={t("auth.signOut")} icon={<LogOut size={17} color={c.muted} strokeWidth={1.6} />} onPress={() => void signOut()} />
          </Row>
        </Rows>
      </Screen>
    </KeyboardAvoidingView>
  );
}
