import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { openEventStream } from "@/api/events";
import { invalidationsFor } from "./invalidate";
import { client, useSession } from "./session";

export { useNow } from "./use-now";
export { invalidationsFor };

/** The current workspace id; screens under a workspace layout can rely on it. */
export function useWs(): string {
  return useSession().workspace?.id ?? "";
}

/**
 * Keep the workspace's data fresh from the realtime stream while the app is in the foreground;
 * when streaming isn't possible, report "polling" so queries poll instead.
 */
export function useLiveUpdates(): "live" | "polling" {
  const ws = useWs();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"live" | "polling">("polling");
  const [fg, setFg] = useState(AppState.currentState !== "background");

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setFg(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!ws || !fg || !client.token) return;
    const h = openEventStream(
      client,
      (e) => {
        for (const key of invalidationsFor(e)) void qc.invalidateQueries({ queryKey: [key, ws] });
      },
      setMode,
    );
    return () => h.close();
  }, [ws, fg, qc]);

  return mode;
}
