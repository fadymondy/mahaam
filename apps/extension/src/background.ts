// MV3 service worker: the toolbar badge (running timer's elapsed minutes) and the page context menu.
// A worker cannot hold the SSE stream (Chrome suspends it after ~30s idle), so it polls
// GET /api/w/time/running once a minute with chrome.alarms; the popup, while open, keeps the
// live stream and pushes changes here immediately.
import { badge, elapsedSeconds, type TimeEntry } from "@mahaam/client";
import { BRAND } from "@mahaam/client/brand";
import { loadState, makeClient, saveState, type ExtMessage, type PendingPage } from "./ext";

const ALARM = "mahaam-tick";
let running: TimeEntry | null = null;

function paint(): void {
  if (!running) {
    void chrome.action.setBadgeText({ text: "" });
    void chrome.action.setTitle({ title: "Mahaam" });
    return;
  }
  const secs = elapsedSeconds(running);
  void chrome.action.setBadgeBackgroundColor({ color: BRAND.brand });
  void chrome.action.setBadgeTextColor?.({ color: BRAND.paper });
  void chrome.action.setBadgeText({ text: badge(secs) });
  const what = running.task_key ? `${running.task_key} ${running.task_title ?? ""}` : running.description || running.project_name || "";
  void chrome.action.setTitle({ title: `Mahaam — ${Math.floor(secs / 60)} min · ${what}`.trim() });
}

async function poll(): Promise<void> {
  const state = await loadState();
  if (!state.token || !state.workspace) {
    running = null;
    return paint();
  }
  const client = makeClient(state, () => void saveState({ token: null }));
  try {
    running = await client.running();
  } catch {
    // offline or signed out: keep the last known timer ticking locally; a 401 cleared the token
    if (!(await loadState()).token) running = null;
  }
  paint();
}

function setup(): void {
  void chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "mahaam", title: "Mahaam", contexts: ["page", "selection", "link"] });
    chrome.contextMenus.create({ id: "mahaam-issue", parentId: "mahaam", title: "File an issue for this page", contexts: ["page", "selection", "link"] });
    chrome.contextMenus.create({ id: "mahaam-log", parentId: "mahaam", title: "Log time on this page", contexts: ["page", "selection", "link"] });
  });
  void poll();
}

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void poll();
});

chrome.runtime.onMessage.addListener((msg: ExtMessage, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.type === "timer") {
    running = msg.running;
    paint();
  } else if (msg.type === "refresh") void poll();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ("token" in changes || "workspace" in changes)) void poll();
});

/**
 * A screenshot of the visible tab, or undefined.
 *
 * `activeTab` is granted transiently by the context-menu click itself, which is why this has to
 * happen here and now: the grant is tied to that gesture and is gone by the time the popup opens.
 * The extension asks for no host permission and has no content script, so this is the *only*
 * moment it can see the page at all — and only because the person just asked it to.
 *
 * JPEG at 70, not PNG: a full-window PNG of a 4K screen runs to several megabytes, past both the
 * server's 8 MB cap and the 10 MB session-storage quota this then has to sit in. A screenshot of a
 * bug does not need to be lossless.
 *
 * Never throws. A page the browser refuses to capture — chrome://, the Web Store, a PDF viewer —
 * must still file an issue, just without the picture.
 */
async function capture(windowId: number | undefined): Promise<string | undefined> {
  try {
    return await chrome.tabs.captureVisibleTab(windowId as number, { format: "jpeg", quality: 70 });
  } catch {
    return undefined;
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "mahaam-issue" && info.menuItemId !== "mahaam-log") return;
  const pending: PendingPage = {
    url: info.linkUrl || info.pageUrl || tab?.url || "",
    ...(tab?.title ? { title: tab.title } : {}),
    ...(info.selectionText ? { selection: info.selectionText } : {}),
    mode: info.menuItemId === "mahaam-issue" ? "issue" : "log",
  };
  void (async () => {
    // Capture before the popup opens: opening it changes what is on screen, and the activeTab
    // grant belongs to the click that is already behind us.
    if (pending.mode === "issue") {
      const shot = await capture(tab?.windowId);
      if (shot) pending.screenshot = shot;
    }
    await chrome.storage.session.set({ pending });
    // openPopup works from a context-menu click on Chrome 127+; fall back to a small window.
    await chrome.action
      .openPopup()
      .catch(() => chrome.windows.create({ url: chrome.runtime.getURL("popup.html"), type: "popup", width: 400, height: 620 }));
  })();
});
