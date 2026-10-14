// File an issue (POST /api/w/portal/issues) or a request (POST /api/w/portal/requests), both
// multipart with an optional photo in the `screenshot` part.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { Camera, ImagePlus, Send, X } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";

import type { Attachment } from "@/api/endpoints";
import { Actions, Grow, Micro, useErrorText } from "@/components/kit";
import { AppText, ErrorLine, Field, FilterStrip, fonts, FooterBar, PrimaryButton, Row, Rows, Screen, SecondaryButton, StackHeader, useColors } from "@/grid";
import { useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { mahaam } from "@/lib/session";
import { fs } from "@/lib/type-scale";

type IssueType = "bug" | "feature" | "task";
type RequestKind = "feature" | "change" | "bug";

async function toAttachment(a: ImagePicker.ImagePickerAsset): Promise<Attachment> {
  const type = a.mimeType ?? "image/jpeg";
  const name = a.fileName ?? `photo.${type.split("/")[1] ?? "jpg"}`;
  if (Platform.OS === "web") {
    const blob = a.file ?? (await (await fetch(a.uri)).blob());
    return { uri: a.uri, name, type, blob };
  }
  return { uri: a.uri, name, type };
}

export default function FileScreen() {
  const { project, kind = "issue" } = useLocalSearchParams<{ project: string; kind?: "issue" | "request" }>();
  const t = useT();
  const c = useColors();
  const ws = useWs();
  const qc = useQueryClient();
  const errText = useErrorText();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [issueType, setIssueType] = useState<IssueType>("bug");
  const [reqKind, setReqKind] = useState<RequestKind>("feature");
  const [desiredOn, setDesiredOn] = useState("");
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const pick = async (camera: boolean) => {
    setNote(null);
    // Android's system photo picker needs no storage permission (and the legacy storage
    // permissions are blocked in app.config.ts), so the library is only asked for on iOS.
    if (camera || Platform.OS !== "android") {
      const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return setNote(t("file.permission"));
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, exif: false };
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!res.canceled && res.assets[0]) setPhoto(res.assets[0]);
  };

  const submit = useMutation({
    mutationFn: async () =>
      mahaam.portal.file(
        kind === "request" ? "request" : "issue",
        kind === "request"
          ? { project_id: project, title: title.trim(), body: body.trim(), kind: reqKind, desired_on: desiredOn.trim() || undefined }
          : { project_id: project, title: title.trim(), body: body.trim(), issue_type: issueType },
        photo ? await toAttachment(photo) : undefined,
      ),
    onSuccess: (r) => {
      for (const k of ["portal-project", "portal-projects", "portal-issues", "portal-requests"]) void qc.invalidateQueries({ queryKey: [k, ws] });
      setNote(t("file.done", { key: r.key }));
      setTimeout(() => (router.canGoBack() ? router.back() : router.replace("/")), 900);
    },
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen
        header={<StackHeader title={kind === "request" ? t("file.titleRequest") : t("file.titleIssue")} />}
        footer={
          <FooterBar>
            <PrimaryButton
              label={t("file.submit")}
              icon={<Send size={17} color={c.onAction} strokeWidth={1.6} />}
              disabled={!title.trim() || !project || submit.isPending || submit.isSuccess}
              onPress={() => submit.mutate()}
            />
          </FooterBar>
        }>
        <Rows>
          <Row style={{ paddingHorizontal: 0 }}>
            <Micro style={{ paddingHorizontal: 28 }}>{kind === "request" ? t("file.kind") : t("file.type")}</Micro>
            {kind === "request" ? (
              <FilterStrip<RequestKind>
                value={reqKind}
                onChange={setReqKind}
                options={[
                  { value: "feature", label: t("file.feature") },
                  { value: "change", label: t("file.change") },
                  { value: "bug", label: t("file.bug") },
                ]}
              />
            ) : (
              <FilterStrip<IssueType>
                value={issueType}
                onChange={setIssueType}
                options={[
                  { value: "bug", label: t("file.bug") },
                  { value: "feature", label: t("file.feature") },
                  { value: "task", label: t("file.task") },
                ]}
              />
            )}
          </Row>
          <Row>
            <Field label={t("file.title")} value={title} onChangeText={setTitle} maxLength={200} testID="file-title" />
            <Field label={t("file.details")} value={body} onChangeText={setBody} multiline testID="file-body" />
            {kind === "request" ? <Field label={t("file.desiredOn")} value={desiredOn} onChangeText={setDesiredOn} autoCapitalize="none" ltr /> : null}
          </Row>
          <Row>
            {photo ? (
              <View style={{ gap: 10 }}>
                <Image
                  source={{ uri: photo.uri }}
                  style={{ width: "100%", height: 200, borderRadius: 8, borderWidth: 1, borderColor: c.line }}
                  contentFit="contain"
                  accessibilityLabel={t("file.photo")}
                />
                <SecondaryButton label={t("file.removePhoto")} icon={<X size={16} color={c.muted} strokeWidth={1.6} />} onPress={() => setPhoto(null)} />
              </View>
            ) : (
              <Actions>
                <Grow>
                  <SecondaryButton label={t("file.photo")} icon={<ImagePlus size={17} color={c.muted} strokeWidth={1.6} />} onPress={() => void pick(false)} />
                </Grow>
                {Platform.OS !== "web" ? (
                  <Grow>
                    <SecondaryButton label={t("file.camera")} icon={<Camera size={17} color={c.muted} strokeWidth={1.6} />} onPress={() => void pick(true)} />
                  </Grow>
                ) : null}
              </Actions>
            )}
            {note ? <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: submit.isSuccess ? c.okText : c.muted }}>{note}</AppText> : null}
            {submit.error ? <ErrorLine text={errText(submit.error)} /> : null}
          </Row>
        </Rows>
      </Screen>
    </KeyboardAvoidingView>
  );
}
