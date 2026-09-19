// The only bridge between the sandboxed popover and the main process: a fixed set of invoke
// channels and event channels. No Node, no ipcRenderer, no arbitrary channel names reach the page.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const INVOKE = new Set([
  "mgy:config",
  "mgy:session",
  "mgy:signIn",
  "mgy:signOut",
  "mgy:selectWorkspace",
  "mgy:api",
  "mgy:timerChanged",
  "mgy:openUrl",
  "mgy:hide",
  "mgy:quit",
  "mgy:autoLaunch:get",
  "mgy:autoLaunch:set",
]);
const EVENTS = new Set(["mgy:live", "mgy:live-status", "mgy:auth-lost"]);

contextBridge.exposeInMainWorld("mahaam", {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!INVOKE.has(channel)) return Promise.reject(new Error(`blocked channel ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel: string, cb: (...args: unknown[]) => void): () => void {
    if (!EVENTS.has(channel)) throw new Error(`blocked channel ${channel}`);
    const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
