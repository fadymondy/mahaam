import { createContext, useContext, type ReactNode } from "react";

import { useLiveUpdates } from "./hooks";

const Ctx = createContext<"live" | "polling">("polling");

/** Mount once per workspace tree: runs the SSE stream and tells screens whether to poll. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const mode = useLiveUpdates();
  return <Ctx.Provider value={mode}>{children}</Ctx.Provider>;
}

export const usePolling = () => useContext(Ctx) === "polling";
export const useLiveMode = () => useContext(Ctx);
