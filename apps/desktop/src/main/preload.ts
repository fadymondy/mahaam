// The renderer's only door out: a fixed set of invoke channels and event channels, exposed as
// window.mahaam. No Node, no ipcRenderer, no arbitrary channel names reach the page.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const INVOKE = new Set([
  "app:config",
  "app:prefs",
  "app:openExternal",
  "app:openWeb",
  "app:autoLaunch:get",
  "app:autoLaunch:set",
  "app:pendingRoute",
  "session:get",
  "session:signIn",
  "session:signInBrowser",
  "session:cancelBrowser",
  "session:signOut",
  "session:selectWorkspace",
  "timer:running",
  "update:state",
  "update:check",
  "update:install",
  "surface:hide",
  "surface:resize",
  "surface:settings",
  "surface:palette",
  "surface:main",
  "surface:command",
  "live:status",
  "api",
]);
const EVENTS = new Set(["session", "live", "live:status", "running", "unread", "prefs", "command", "window", "surface:shown", "update"]);

contextBridge.exposeInMainWorld("mahaam", {
  platform: process.platform,
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
