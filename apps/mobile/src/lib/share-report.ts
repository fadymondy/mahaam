// A project report out of the app: the PDF (downloaded with the session's Bearer header — the
// report route is signed in, a browser URL would not be) handed to the share sheet, or the Markdown
// as text. Web: the PDF opens in a new tab from a blob.
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";

import { client, mahaam } from "./session";

const reportUrl = (project: string, format: "pdf" | "md", lang: string) =>
  `${client.baseUrl}/api/w/projects/${encodeURIComponent(project)}/report?format=${format}&lang=${lang}`;

export async function shareReportPdf(project: string, name: string, lang: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (client.token) headers.Authorization = `Bearer ${client.token}`;
  if (client.workspace) headers["X-Workspace-ID"] = client.workspace;
  if (Platform.OS === "web") {
    const res = await fetch(reportUrl(project, "pdf", lang), { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
    return;
  }
  const safe = name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "report";
  const dest = new File(Paths.cache, `${safe}.pdf`);
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(reportUrl(project, "pdf", lang), dest, { headers });
  await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: name });
}

export async function shareReportMarkdown(project: string, name: string, lang: string): Promise<void> {
  const md = await mahaam.projects.reportText(project, "md", lang);
  await Share.share({ title: name, message: md });
}
