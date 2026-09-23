// Profile → Details: name, photo and timezone (PATCH /api/me/profile, POST/DELETE /api/me/avatar).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Check, ImagePlus, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";

import { Actions, Grow, useErrorText } from "@/components/kit";
import { useProfile } from "@/features/account";
import { AppText, ErrorLine, Field, fonts, FooterBar, PrimaryButton, Row, Rows, Screen, SecondaryButton, StackHeader, useColors } from "@/grid";
import { useT } from "@/i18n";
import { mahaam, useSession } from "@/lib/session";
import { fs } from "@/lib/type-scale";

export default function Details() {
  const t = useT();
  const c = useColors();
  const qc = useQueryClient();
  const errText = useErrorText();
  const { user } = useSession();
  const profile = useProfile();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (profile.data) {
      setName(profile.data.name ?? "");
      setTimezone(profile.data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [profile.data]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["me", user?.id ?? ""] });

  const save = useMutation({
    mutationFn: () => mahaam.me.update({ name: name.trim(), timezone: timezone.trim() || undefined }),
    onSuccess: () => {
      setSaved(true);
      refresh();
    },
  });
  const avatar = useMutation({
    mutationFn: async () => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) throw new Error(t("file.permission"));
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [1, 1], exif: false });
      if (r.canceled || !r.assets[0]) return null;
      const a = r.assets[0];
      const type = a.mimeType ?? "image/jpeg";
      return mahaam.me.uploadAvatar({ uri: a.uri, name: a.fileName ?? `avatar.${type.split("/")[1] ?? "jpg"}`, type, blob: Platform.OS === "web" ? (a.file ?? undefined) : undefined });
    },
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: mahaam.me.removeAvatar, onSuccess: refresh });
  const p = profile.data;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen
        header={<StackHeader title={t("account.details.title")} />}
        footer={
          <FooterBar>
            <PrimaryButton label={t("common.save")} icon={<Check size={17} color={c.onAction} strokeWidth={1.8} />} disabled={save.isPending || !name.trim()} onPress={() => save.mutate()} />
          </FooterBar>
        }>
        <Rows>
          <Row style={{ alignItems: "center" }}>
            {p?.avatar ? (
              <Image source={{ uri: p.avatar }} style={{ width: 96, height: 96, borderRadius: 18, borderWidth: 1, borderColor: c.line }} />
            ) : (
              <View style={{ width: 96, height: 96, borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, alignItems: "center", justifyContent: "center" }}>
                <AppText style={{ fontFamily: fonts.medium, fontSize: 36, lineHeight: 44, color: c.brand }}>{(name || p?.email || "?").slice(0, 1).toUpperCase()}</AppText>
              </View>
            )}
            <Actions>
              <Grow>
                <SecondaryButton label={t("account.details.photo")} icon={<ImagePlus size={16} color={c.muted} strokeWidth={1.6} />} disabled={avatar.isPending} onPress={() => avatar.mutate()} />
              </Grow>
              {p?.avatar ? (
                <Grow>
                  <SecondaryButton label={t("file.removePhoto")} icon={<Trash2 size={16} color={c.muted} strokeWidth={1.6} />} disabled={remove.isPending} onPress={() => remove.mutate()} />
                </Grow>
              ) : null}
            </Actions>
            {avatar.error || remove.error ? <ErrorLine text={errText(avatar.error ?? remove.error)} /> : null}
          </Row>
          <Row>
            <Field label={t("auth.name")} value={name} onChangeText={(v) => (setName(v), setSaved(false))} autoComplete="name" />
            <Field label={t("account.details.timezone")} value={timezone} onChangeText={(v) => (setTimezone(v), setSaved(false))} autoCapitalize="none" ltr placeholder="Africa/Cairo" />
            {save.error ? <ErrorLine text={errText(save.error)} /> : null}
            {saved ? <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.okText }}>{t("account.saved")}</AppText> : null}
          </Row>
        </Rows>
      </Screen>
    </KeyboardAvoidingView>
  );
}
