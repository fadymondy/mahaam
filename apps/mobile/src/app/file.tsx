// File an issue (POST /api/w/portal/issues) or a request (POST /api/w/portal/requests), both
// multipart with an optional photo in the `screenshot` part.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";

import type { Attachment } from "@/api/endpoints";
import { Button, Card, Field, Row, Screen, Segmented, T, useErrorText } from "@/components/ui";
import { useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { mahaam } from "@/lib/session";
import { space } from "@/theme/tokens";

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
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setNote(t("file.permission"));
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
    <Screen edges={[]}>
      <Stack.Screen options={{ title: kind === "request" ? t("file.titleRequest") : t("file.titleIssue") }} />
      <Card style={{ gap: space.md }}>
        {kind === "request" ? (
          <Segmented<RequestKind>
            label={t("file.kind")}
            value={reqKind}
            onChange={setReqKind}
            options={[
              { value: "feature", label: t("file.feature") },
              { value: "change", label: t("file.change") },
              { value: "bug", label: t("file.bug") },
            ]}
          />
        ) : (
          <Segmented<IssueType>
            label={t("file.type")}
            value={issueType}
            onChange={setIssueType}
            options={[
              { value: "bug", label: t("file.bug") },
              { value: "feature", label: t("file.feature") },
              { value: "task", label: t("file.task") },
            ]}
          />
        )}
        <Field label={t("file.title")} value={title} onChangeText={setTitle} maxLength={200} testID="file-title" />
        <Field
          label={t("file.details")}
          value={body}
          onChangeText={setBody}
          multiline
          style={{ minHeight: 120, textAlignVertical: "top" }}
          testID="file-body"
        />
        {kind === "request" ? <Field label={t("file.desiredOn")} value={desiredOn} onChangeText={setDesiredOn} autoCapitalize="none" /> : null}
        {photo ? (
          <View style={{ gap: space.sm }}>
            <Image source={{ uri: photo.uri }} style={{ width: "100%", height: 200 }} contentFit="contain" accessibilityLabel={t("file.photo")} />
            <Button small variant="secondary" label={t("file.removePhoto")} onPress={() => setPhoto(null)} />
          </View>
        ) : (
          <Row>
            <Button variant="secondary" label={t("file.photo")} onPress={() => void pick(false)} style={{ flex: 1 }} />
            {Platform.OS !== "web" ? <Button variant="secondary" label={t("file.camera")} onPress={() => void pick(true)} style={{ flex: 1 }} /> : null}
          </Row>
        )}
        <Button label={t("file.submit")} disabled={!title.trim() || !project} busy={submit.isPending} onPress={() => submit.mutate()} />
        {note ? <T tone={submit.isSuccess ? "ok" : "muted"}>{note}</T> : null}
        {submit.error ? (
          <T tone="danger" role="alert">
            {errText(submit.error)}
          </T>
        ) : null}
      </Card>
    </Screen>
  );
}
