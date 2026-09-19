// The realtime stream (GET /api/w/events, SSE behind the session). Browsers and React Native have no
// EventSource that can send a Bearer header, so we stream with fetch: the platform fetch on web and
// expo/fetch (which exposes response.body as a stream) on iOS / Android. If streaming is unavailable
// or keeps failing, the caller falls back to polling.
import { Platform } from "react-native";
import { fetch as expoFetch } from "expo/fetch";

import type { MahaamClient } from "./client";
import { createSseParser, type SseEvent } from "./sse";

export interface StreamHandle {
  close(): void;
}

export function openEventStream(
  client: MahaamClient,
  onEvent: (e: SseEvent) => void,
  onState: (s: "live" | "polling") => void,
): StreamHandle {
  let closed = false;
  let ctrl: AbortController | null = null;
  let failures = 0;
  const doFetch = (Platform.OS === "web" ? fetch : expoFetch) as unknown as typeof fetch;

  const run = async () => {
    while (!closed) {
      ctrl = new AbortController();
      let retryMs = 3000;
      try {
        const res = await doFetch(`${client.baseUrl}/api/w/events`, {
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${client.token ?? ""}`,
            "X-Workspace-ID": client.workspace ?? "",
          },
          signal: ctrl.signal,
        });
        if (res.status === 401) await client.reauthenticate().catch(() => false);
        const reader = res.ok ? res.body?.getReader?.() : undefined;
        if (!reader) throw new Error(`stream unavailable (${res.status})`);
        onState("live");
        failures = 0;
        const parser = createSseParser(onEvent);
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done || closed) break;
          parser.push(typeof value === "string" ? value : dec.decode(value, { stream: true }));
        }
        retryMs = parser.retry() ?? retryMs;
      } catch {
        if (closed) return;
        failures++;
      }
      if (closed) return;
      onState("polling");
      // Back off after repeated failures; polling covers the gap meanwhile.
      const wait = Math.min(retryMs * 2 ** Math.max(0, failures - 1), 60_000);
      await new Promise((r) => setTimeout(r, wait));
    }
  };
  void run();
  return {
    close() {
      closed = true;
      ctrl?.abort();
    },
  };
}
