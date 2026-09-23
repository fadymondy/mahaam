// Native shell services for the renderer, so the app's chrome is the operating system's own and not
// HTML drawn to look like it (after Zekra's native-ui.ts):
//
//   native:menu     a real NSMenu / Win32 menu built from a plain item list — every picker, "…" menu
//                   and right-click menu in the app; resolves with the chosen item's id (null when
//                   dismissed). Type-to-select, keyboard, checkmarks and submenus come from the OS.
//   native:confirm  a native alert (a sheet on macOS) for anything destructive; resolves true/false.
//   native:share    the macOS Share menu (Mail, Messages, AirDrop, Notes…) for a link.
//   window:issue    an issue in its own document window (listed in the Window menu).
//   text menus      right-clicking text anywhere gets the native Cut/Copy/Paste menu with spelling
//                   suggestions, "Look Up" and "Search with Google".
import { BrowserWindow, dialog, ipcMain, Menu, ShareMenu, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type WebContents } from "electron";

export interface NativeMenuItem {
  id?: string;
  label?: string;
  /** A second, quieter line is not possible in native menus; use `sublabel` (macOS 14.4+ shows it). */
  sublabel?: string;
  type?: "normal" | "separator" | "checkbox" | "radio" | "submenu" | "header";
  checked?: boolean;
  enabled?: boolean;
  /** Display-only shortcut hint, e.g. "CmdOrCtrl+Backspace". */
  accelerator?: string;
  submenu?: NativeMenuItem[];
}

export interface MenuRequest {
  items: NativeMenuItem[];
  /** Window-relative CSS px (e.g. under the button that opened it); default: at the pointer. */
  x?: number;
  y?: number;
}

export interface ConfirmRequest {
  message: string;
  detail?: string;
  confirm: string;
  cancel: string;
  destructive?: boolean;
}

/**
 * For the e2e (MAHAAM_E2E=1): a real menu or alert blocks the test driver, so none is shown. Each
 * menu is recorded (`menus`) and resolves with the next queued pick: an item id, or a label /
 * id-prefix match found anywhere in the tree ("label:Done", "id:status:"), or null for "dismissed".
 * Each confirm is recorded and resolves with the next queued answer (true when the queue is empty).
 */
export const nativeProbe = {
  menus: [] as NativeMenuItem[][],
  picks: [] as (string | null)[],
  confirms: [] as ConfirmRequest[],
  answers: [] as boolean[],
};
const probing = process.env.MAHAAM_E2E === "1";

function probePick(items: NativeMenuItem[]): string | null {
  nativeProbe.menus.push(items);
  const want = nativeProbe.picks.shift();
  if (want == null) return null;
  const flat = (xs: NativeMenuItem[]): NativeMenuItem[] => xs.flatMap((x) => [x, ...flat(x?.submenu ?? [])]);
  const all = flat(items).filter((x) => typeof x?.id === "string" && x.enabled !== false);
  const hit = want.startsWith("label:")
    ? all.find((x) => x.label === want.slice(6))
    : want.startsWith("id:")
      ? all.find((x) => x.id!.startsWith(want.slice(3)))
      : all.find((x) => x.id === want);
  return hit?.id ?? null;
}

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : undefined);

function toTemplate(items: NativeMenuItem[], pick: (id: string) => void, depth = 0): MenuItemConstructorOptions[] {
  if (!Array.isArray(items) || depth > 3) return [];
  return items.slice(0, 200).map((it): MenuItemConstructorOptions => {
    if (it?.type === "separator") return { type: "separator" };
    if (it?.type === "header") return { type: "header" as never, label: str(it.label) ?? "" };
    const base: MenuItemConstructorOptions = {
      label: str(it?.label) ?? "",
      sublabel: str(it?.sublabel),
      enabled: it?.enabled !== false,
      accelerator: str(it?.accelerator, 40),
      registerAccelerator: false, // a hint only: the app menu and the views own the shortcuts
    };
    if (it?.type === "submenu" || it?.submenu?.length) return { ...base, submenu: toTemplate(it.submenu ?? [], pick, depth + 1) };
    return {
      ...base,
      type: it?.type === "checkbox" || it?.type === "radio" ? it.type : "normal",
      checked: !!it?.checked,
      click: () => typeof it?.id === "string" && pick(it.id),
    };
  });
}

function popup(e: IpcMainInvokeEvent, req: MenuRequest): Promise<string | null> {
  if (probing) return Promise.resolve(probePick(req?.items ?? []));
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const menu = Menu.buildFromTemplate(toTemplate(req?.items ?? [], (id) => finish(id)));
    menu.popup({
      window: BrowserWindow.fromWebContents(e.sender) ?? undefined,
      ...(typeof req?.x === "number" && typeof req?.y === "number" ? { x: Math.round(req.x), y: Math.round(req.y) } : {}),
      // The close callback can run before the item's click: let a click win.
      callback: () => setTimeout(() => finish(null), 50),
    });
  });
}

async function confirm(e: IpcMainInvokeEvent, req: ConfirmRequest): Promise<boolean> {
  if (probing) {
    nativeProbe.confirms.push(req);
    return nativeProbe.answers.shift() ?? true;
  }
  const win = BrowserWindow.fromWebContents(e.sender);
  const opts = {
    type: (req?.destructive ? "warning" : "question") as "warning" | "question",
    message: str(req?.message) ?? "",
    detail: str(req?.detail, 1000),
    buttons: [str(req?.confirm, 60) ?? "OK", str(req?.cancel, 60) ?? "Cancel"],
    defaultId: req?.destructive ? 1 : 0,
    cancelId: 1,
    noLink: true,
  };
  // A sheet on the window it came from (macOS), a modal alert elsewhere.
  const out = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return out.response === 0;
}

/** Right-click on text: the platform's own editing menu, with spelling suggestions. */
export function nativeTextMenu(wc: WebContents): void {
  wc.on("context-menu", (_e, p) => {
    // Views that draw their own context menu (a row, a card) call native:menu themselves and stop
    // the event; this only covers text and fields.
    if (!p.isEditable && !p.selectionText.trim()) return;
    const items: MenuItemConstructorOptions[] = [];
    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
      if (p.dictionarySuggestions.length) items.push({ type: "separator" });
      items.push({ role: "toggleSpellChecker" as never }, { type: "separator" });
    }
    if (p.selectionText.trim() && process.platform === "darwin") {
      items.push({ label: `Look Up “${p.selectionText.trim().slice(0, 24)}”`, click: () => wc.showDefinitionForSelection() });
    }
    if (p.selectionText.trim()) {
      const q = p.selectionText.trim().slice(0, 200);
      items.push({ label: "Search with Google", click: () => void shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(q)}`) }, { type: "separator" });
    }
    if (p.isEditable) items.push({ role: "cut", enabled: p.editFlags.canCut }, { role: "copy", enabled: p.editFlags.canCopy }, { role: "paste", enabled: p.editFlags.canPaste }, { role: "selectAll" });
    else items.push({ role: "copy", enabled: p.editFlags.canCopy });
    Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(wc) ?? undefined });
  });
}

export function registerNative(opts: {
  trusted: (e: IpcMainInvokeEvent) => boolean;
  openIssueWindow: (key: string) => void;
}): void {
  const guard =
    <A extends unknown[], R>(fn: (e: IpcMainInvokeEvent, ...a: A) => Promise<R> | R) =>
    async (e: IpcMainInvokeEvent, ...a: A) => {
      if (!opts.trusted(e)) return { ok: false, status: 0, message: "untrusted sender" };
      try {
        return { ok: true, value: await fn(e, ...a) };
      } catch (err) {
        return { ok: false, status: 0, message: err instanceof Error ? err.message : String(err) };
      }
    };
  ipcMain.handle("native:menu", guard((e, req: MenuRequest) => popup(e, req)));
  ipcMain.handle("native:confirm", guard((e, req: ConfirmRequest) => confirm(e, req)));
  ipcMain.handle(
    "native:share",
    guard((e, url: unknown, title?: unknown) => {
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) return;
      if (process.platform !== "darwin") {
        void shell.openExternal(`mailto:?subject=${encodeURIComponent(String(title ?? ""))}&body=${encodeURIComponent(url)}`);
        return;
      }
      new ShareMenu({ urls: [url], texts: title ? [String(title).slice(0, 200)] : [] }).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined });
    }),
  );
  ipcMain.handle(
    "window:issue",
    guard((_e, key: unknown) => {
      if (typeof key === "string" && /^[A-Za-z][A-Za-z0-9]{0,9}-\d+$/.test(key)) opts.openIssueWindow(key.toUpperCase());
    }),
  );
}
