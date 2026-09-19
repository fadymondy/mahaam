/*
 * Mahaam embeddable Feedback widget.
 *
 * A single IIFE, bundled with esbuild, that a client pastes onto their own site:
 *
 *   <script src="https://console.mahaam.app/embed/v1.js"
 *           data-key="pfk_…" defer></script>
 *
 * Optional attributes: data-locale="en|ar", data-theme="light|dark|auto",
 * data-position="end|start", data-endpoint (defaults to <script origin>/api/feedback/embed),
 * data-launcher="false" (no floating button; open with window.MahaamFeedback.open(); window.ManagyFeedback is kept as an alias).
 *
 * It renders a floating launcher inside a Shadow DOM (so the host page's CSS and the
 * widget's never leak into each other). The dialog is the same anatomy as the
 * feedback-sdk ReportDialog used by fadymondy.com-v2 and Mahaam itself — title, type +
 * priority, details, Attach (Screenshot · Select element · Image), selector line,
 * capture preview — drawn on the grid tokens with Mahaam's brand, and signed
 * "Powered by Mahaam". It POSTs multipart/form-data to the PUBLIC endpoint
 * /api/feedback/embed, authenticated only by the per-project public key, which can
 * do exactly one thing server-side: file an issue into its project.
 *
 * The capture/diagnostics/picker code is the SHARED feedback-sdk core, imported from
 * web/lib/feedback, so the hard-won capture fixes are not re-implemented here.
 */
import {
  installDiagnostics,
  consoleSnapshot,
  networkSnapshot,
  diagnosticsCounts,
  captureViewport,
  captureElement,
  pickElement,
  selectorFor,
  pageContext,
} from "../../web/lib/feedback/core/index"
import { FEEDBACK_LABELS, fillLabel } from "../../web/lib/feedback/react/labels"
import { createLauncher, LAUNCHER_CSS, type LauncherStrings, type Look } from "./launcher"

type Locale = "en" | "ar"
type Cfg = {
  key: string
  endpoint: string
  origin: string
  locale: Locale
  theme: "light" | "dark" | "auto"
  position: string
  launcher: boolean
  /** Which of locale / theme / position the <script> tag set (they win over the key's config). */
  set: { locale: boolean; theme: boolean; position: boolean }
  look: Look
}

// Strings the shared labels do not carry (types, priorities, the widget chrome).
const EXTRA = {
  en: {
    types: { bug: "Bug", feature: "Feature request", task: "Other" },
    priorities: { highest: "Highest", high: "High", medium: "Medium", low: "Low", lowest: "Lowest" },
    cancel: "Cancel",
    close: "Close",
    thanks: "Thanks — your report was sent as {key}.",
    thanksNoKey: "Thanks — your report was sent.",
    unavailable: "Reporting is not available here right now. Please try again later.",
    poweredBy: "Powered by",
    brand: "Mahaam",
    required: "Add a title first.",
    launcher: {
      menu: "Right-click for options",
      dock: "Dock to the edge",
      undock: "Undock",
      moveTo: "Move to",
      corners: { "top-start": "Top left", "top-end": "Top right", "bottom-start": "Bottom left", "bottom-end": "Bottom right" },
      reset: "Reset position",
      hideNow: "Hide for now",
      hideSite: "Hide on this site",
      shortcut: "Ctrl/⌘ + Shift + F shows it again",
    },
  },
  ar: {
    types: { bug: "خطأ", feature: "طلب ميزة", task: "أخرى" },
    priorities: { highest: "الأعلى", high: "عالية", medium: "متوسطة", low: "منخفضة", lowest: "الأدنى" },
    cancel: "إلغاء",
    close: "إغلاق",
    thanks: "شكرًا — تم إرسال بلاغك برقم {key}.",
    thanksNoKey: "شكرًا — تم إرسال بلاغك.",
    unavailable: "الإبلاغ غير متاح هنا حاليًا. حاول مرة أخرى لاحقًا.",
    poweredBy: "مدعوم من",
    brand: "مهام",
    required: "أضف عنوانًا أولًا.",
    launcher: {
      menu: "انقر بزر الفأرة الأيمن للخيارات",
      dock: "إلصاق بحافة الشاشة",
      undock: "فك الإلصاق",
      moveTo: "نقل إلى",
      corners: { "top-start": "أعلى اليمين", "top-end": "أعلى اليسار", "bottom-start": "أسفل اليمين", "bottom-end": "أسفل اليسار" },
      reset: "إعادة الموضع",
      hideNow: "إخفاء مؤقتًا",
      hideSite: "إخفاء على هذا الموقع",
      shortcut: "Ctrl/⌘ + Shift + F لإظهاره مجددًا",
    },
  },
} as const

const TYPES = ["bug", "feature", "task"] as const
const PRIORITIES = ["highest", "high", "medium", "low", "lowest"] as const

function readConfig(): Cfg | null {
  const s =
    (document.currentScript as HTMLScriptElement | null) ||
    document.querySelector<HTMLScriptElement>('script[data-key^="pfk_"]')
  const key = s?.getAttribute("data-key")?.trim()
  if (!key) {
    console.warn("[mahaam-feedback] missing data-key on the <script> tag")
    return null
  }
  let origin = ""
  try {
    origin = new URL(s!.src).origin
  } catch {
    /* inline or relative script */
  }
  const endpoint =
    s?.getAttribute("data-endpoint")?.trim() || (origin ? origin + "/api/feedback/embed" : "/api/feedback/embed")
  const attr = (n: string) => s?.getAttribute(n)?.trim() ?? ""
  const lang = attr("data-locale") || document.documentElement.lang || "en"
  const theme = attr("data-theme")
  return {
    key,
    endpoint,
    origin,
    locale: lang.toLowerCase().startsWith("ar") ? "ar" : "en",
    theme: theme === "light" || theme === "dark" ? theme : "auto",
    position: attr("data-position") === "start" ? "bottom-start" : attr("data-position") || "bottom-end",
    launcher: attr("data-launcher") !== "false",
    set: { locale: !!attr("data-locale"), theme: !!attr("data-theme"), position: !!attr("data-position") },
    look: {},
  }
}

// ── tiny DOM helpers ─────────────────────────────────────────────────────────

type Kid = Node | string | null | false | undefined
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | EventListener> = {},
  ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") n.addEventListener(k.replace(/^on/, ""), v)
    else if (v === true) n.setAttribute(k, "")
    else if (v !== false) n.setAttribute(k, v)
  }
  for (const k of kids) if (k) n.append(k)
  return n
}

// Lucide paths (ISC), inlined so the bundle has no icon dependency.
const ICONS: Record<string, string> = {
  camera:
    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  crosshair:
    '<circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>',
  image:
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
}
function icon(name: string, cls = "i"): SVGElement {
  const t = document.createElement("template")
  t.innerHTML = `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
  return t.content.firstChild as SVGElement
}

// The Mahaam mark, exactly as the brand page gives it (never recoloured; the body
// swaps to its on-ink shade in dark, the accent cube stays).
function mark(): SVGElement {
  const t = document.createElement("template")
  t.innerHTML =
    '<svg class="mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Mahaam">' +
    '<rect class="b" x="29" y="29" width="21" height="21"/><rect x="71" y="29" width="21" height="21" fill="#C9A227"/>' +
    '<rect class="b" x="8" y="50" width="21" height="21"/><rect class="b" x="50" y="50" width="21" height="21"/></svg>'
  return t.content.firstChild as SVGElement
}

// ── styles: grid tokens (web/app/styles/grid-tokens.css) + the Mahaam brand block ──

const CSS = LAUNCHER_CSS + `
:host { all: initial; }
.root {
  --bg: #f0ebe1; --card: #f7f4ec; --elevated: #faf8f3; --line: #ded5c4; --soft: #ede7db;
  --fg: #0e1a3c; --body: #4a4438; --muted: #6e6551; --hover: #efe9dd;
  --action: #8c3fb5; --on-action: #f0ebe1; --brand: #8c3fb5; --accent: #c9a227;
  --danger: #a8233b; --ok: #33702a;
  --sans: "Lusail", "Alexandria", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "JetBrains Mono", "Lusail", ui-monospace, monospace;
  font-family: var(--sans); color: var(--fg); font-size: 14px; line-height: 1.5;
}
.root.dark {
  --bg: #0b1429; --card: #0e1a3c; --elevated: #18264a; --line: #32456f; --soft: #2a3b66;
  --fg: #f0ebe1; --body: #c8d0e4; --muted: #8a97b8; --hover: #22325c;
  --action: #b784d6; --on-action: #0e1a3c; --brand: #b784d6;
  --danger: #e8788c; --ok: #6fbf5e;
}
* { box-sizing: border-box; }
.i { width: 16px; height: 16px; flex: none; }
.sm .i { width: 14px; height: 14px; }
.mark { width: 16px; height: 16px; flex: none; }
.mark .b { fill: var(--brand); }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: none; box-shadow: 0 0 0 3px color-mix(in oklab, var(--action) 50%, transparent);
}
.overlay {
  position: fixed; inset: 0; z-index: 2147483001; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: rgba(0, 0, 0, .10); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  animation: fade 100ms ease;
}
.overlay.hidden { opacity: 0; pointer-events: none; background: transparent; backdrop-filter: none; }
@keyframes fade { from { opacity: 0 } }
@keyframes pop { from { opacity: 0; transform: scale(.95) } }
.dialog {
  position: relative; width: 100%; max-width: 576px; max-height: calc(100vh - 32px); overflow: auto;
  display: flex; flex-direction: column; gap: 16px; padding: 16px; border-radius: 12px;
  background: var(--elevated); color: var(--fg); box-shadow: 0 0 0 1px var(--line), 0 24px 60px rgba(14, 26, 60, .25);
  animation: pop 100ms ease;
}
.x { position: absolute; top: 8px; inset-inline-end: 8px; }
.head { display: flex; flex-direction: column; gap: 8px; padding-inline-end: 28px; }
.title { margin: 0; font: 500 16px/1.3 var(--sans); }
.hint { margin: 0; font-size: 13px; color: var(--muted); }
.group { display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.cols { display: grid; gap: 16px; }
@media (min-width: 640px) { .cols { grid-template-columns: 1fr 1fr; } }
label, .label { font: 500 13px/1.2 var(--sans); color: var(--fg); }
input, select, textarea {
  width: 100%; min-width: 0; border: 1px solid var(--line); border-radius: 8px; background: transparent;
  color: var(--fg); font: 400 14px/1.4 var(--sans); padding: 5px 10px; transition: border-color 150ms ease;
}
.root.dark input, .root.dark select, .root.dark textarea { background: color-mix(in oklab, var(--line) 30%, transparent); }
input, select { height: 32px; }
select { appearance: none; padding-inline-end: 28px; cursor: pointer;
  background: transparent url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%238a8577%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E") no-repeat right 8px center / 16px; }
.root[dir="rtl"] select { background-position: left 8px center; padding-inline-end: 10px; padding-inline-start: 28px; }
select option { background: var(--elevated); color: var(--fg); }
textarea { resize: vertical; min-height: 140px; }
input::placeholder, textarea::placeholder { color: var(--muted); }
input:focus, select:focus, textarea:focus { border-color: var(--action); }
.btns { display: flex; flex-wrap: wrap; gap: 8px; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 10px;
  border: 1px solid transparent; border-radius: 8px; font: 500 14px/1 var(--sans); cursor: pointer;
  background: transparent; color: var(--fg); white-space: nowrap; transition: background 150ms ease;
}
.btn.sm { height: 28px; font-size: 12.8px; gap: 4px; }
.btn:active:not(:disabled) { transform: translateY(1px); }
.btn:disabled { opacity: .5; pointer-events: none; }
.btn.primary { background: var(--action); color: var(--on-action); }
.btn.primary:hover { background: color-mix(in oklab, var(--action) 80%, transparent); }
.btn.outline { border-color: var(--line); background: var(--bg); }
.root.dark .btn.outline { background: color-mix(in oklab, var(--line) 30%, transparent); }
.btn.outline:hover, .btn.ghost:hover { background: var(--soft); }
.btn.icon { width: 28px; padding: 0; }
.sel { display: flex; align-items: center; gap: 8px; margin: 0; font: 12px/1.4 var(--mono); color: var(--muted); }
.sel span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: ltr; }
.shot { position: relative; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; }
.shot img { display: block; width: 100%; max-height: 192px; object-fit: contain; background: color-mix(in oklab, var(--soft) 30%, transparent); }
.shot .btn { position: absolute; top: 8px; inset-inline-end: 8px; background: var(--elevated); }
.err { margin: 0; font-size: 13px; color: var(--danger); }
.ok { margin: 0; font-size: 14px; color: var(--ok); }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  margin: 4px -16px -16px; padding: 12px 16px; border-top: 1px solid var(--line);
  background: color-mix(in oklab, var(--soft) 50%, transparent); border-radius: 0 0 12px 12px; }
.powered { display: inline-flex; align-items: center; gap: 6px; font: 12px/1 var(--sans);
  color: var(--muted); text-decoration: none; }
.powered b { font: 500 12px/1 var(--sans); color: var(--fg); letter-spacing: 0; }
.powered:hover b { text-decoration: underline; }
.acts { display: flex; gap: 8px; margin-inline-start: auto; }
`

// @font-face does not apply inside a shadow root in every engine; declare the brand
// face once on the host document, served from the widget's own origin.
function installFonts(origin: string) {
  if (!origin || document.getElementById("mahaam-feedback-fonts")) return
  const css = [300, 400, 500]
    .map((w) => {
      const file = { 300: "Light", 400: "Regular", 500: "Medium" }[w]
      return `@font-face{font-family:"Lusail";src:url("${origin}/fonts/lusail/Lusail-${file}.woff2?v=2") format("woff2");font-weight:${w};font-style:normal;font-display:swap}`
    })
    .join("")
  const st = document.createElement("style")
  st.id = "mahaam-feedback-fonts"
  st.textContent = css
  document.head.append(st)
}

function isDark(cfg: Cfg): boolean {
  if (cfg.theme !== "auto") return cfg.theme === "dark"
  const html = document.documentElement
  if (html.classList.contains("dark") || html.getAttribute("data-theme") === "dark") return true
  if (html.classList.contains("light") || html.getAttribute("data-theme") === "light") return false
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
}

const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

function mount(cfg: Cfg) {
  installDiagnostics()
  installFonts(cfg.origin)
  const L = FEEDBACK_LABELS[cfg.locale]
  const X = EXTRA[cfg.locale]

  const host = document.createElement("div")
  host.setAttribute("data-reporter", "") // excluded from its own screenshots
  const shadow = host.attachShadow({ mode: "open" })
  const style = document.createElement("style")
  style.textContent = CSS
  const root = h("div", { class: "root", dir: cfg.locale === "ar" ? "rtl" : "ltr", lang: cfg.locale })
  shadow.append(style, root)
  document.body.append(host)

  const applyTheme = () => root.classList.toggle("dark", isDark(cfg))
  applyTheme()
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme)
  new MutationObserver(applyTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  })

  const launcher = cfg.launcher
    ? createLauncher({
        root,
        storageKey: "mahaam-feedback:" + cfg.key,
        look: { ...cfg.look, position: cfg.set.position ? cfg.position : cfg.look.position || cfg.position },
        rtl: cfg.locale === "ar",
        strings: { label: L.launcher, ...X.launcher } as LauncherStrings,
        iconFor: (name) => (ICONS[name] ? icon(name) : null),
        onOpen: () => open(),
      })
    : null

  let overlay: HTMLDivElement | null = null
  let onKey: ((e: KeyboardEvent) => void) | null = null

  function close() {
    overlay?.remove()
    overlay = null
    if (onKey) document.removeEventListener("keydown", onKey, true)
    launcher?.setOpen(false)
  }

  function open() {
    if (overlay) return
    applyTheme()
    launcher?.setOpen(true)

    let screenshot: string | null = null
    let selector: string | null = null
    let busy = false

    const titleIn = h("input", { id: "mf-title", dir: "auto", placeholder: L.titlePlaceholder, maxlength: "200", required: true })
    const typeSel = h("select", { id: "mf-type" }, ...TYPES.map((t) => h("option", { value: t }, X.types[t])))
    const prioSel = h("select", { id: "mf-priority" }, ...PRIORITIES.map((p) => h("option", { value: p }, X.priorities[p])))
    prioSel.value = "medium"
    const body = h("textarea", { id: "mf-body", dir: "auto", rows: "7", placeholder: L.bodyPlaceholder })
    const err = h("p", { class: "err", role: "alert" })
    err.hidden = true
    const selLine = h("p", { class: "sel" })
    selLine.hidden = true
    const shotBox = h("div", { class: "shot" })
    shotBox.hidden = true
    const file = h("input", { type: "file", accept: "image/*", hidden: true })

    const shotBtn = h("button", { class: "btn outline sm", type: "button" }, icon("camera"), L.screenshot)
    const pickBtn = h("button", { class: "btn outline sm", type: "button" }, icon("crosshair"), L.selectElement)
    const imgBtn = h("button", { class: "btn outline sm", type: "button" }, icon("image"), L.image)
    const send = h("button", { class: "btn primary", type: "submit" }, icon("send"), L.submitReport)
    const cancel = h("button", { class: "btn ghost", type: "button" }, X.cancel)

    const setErr = (m: string | null) => {
      err.textContent = m ?? ""
      err.hidden = !m
    }
    const setBusy = (b: boolean, which?: HTMLButtonElement, text?: string) => {
      busy = b
      for (const x of [shotBtn, pickBtn, imgBtn]) x.disabled = b
      if (which && text) which.lastChild!.textContent = text
    }
    const renderShot = () => {
      shotBox.replaceChildren()
      shotBox.hidden = !screenshot
      if (!screenshot) return
      const rm = h("button", { class: "btn outline icon sm", type: "button", "aria-label": L.removeAttachment, title: L.removeAttachment }, icon("x"))
      rm.addEventListener("click", () => {
        screenshot = null
        renderShot()
      })
      shotBox.append(h("img", { src: screenshot, alt: L.attachedCapture }), rm)
    }
    const renderSel = () => {
      selLine.replaceChildren()
      selLine.hidden = !selector
      if (selector) selLine.append(icon("crosshair"), h("span", {}, selector))
    }
    const hide = async (on: boolean) => {
      overlay!.classList.toggle("hidden", on)
      if (on) await frame()
    }

    shotBtn.addEventListener("click", async () => {
      if (busy) return
      setErr(null)
      setBusy(true, shotBtn, L.capturing)
      await hide(true)
      try {
        screenshot = await captureViewport()
        renderShot()
      } catch (e) {
        setErr(e instanceof Error ? e.message : L.screenshotFailed)
      } finally {
        await hide(false)
        setBusy(false, shotBtn, L.screenshot)
      }
    })
    pickBtn.addEventListener("click", async () => {
      if (busy) return
      setErr(null)
      setBusy(true, pickBtn, L.picking)
      await hide(true)
      try {
        const picked = await pickElement({ hint: L.pickHint })
        if (picked) {
          selector = selectorFor(picked.anchor)
          renderSel()
          const shot = await captureElement(picked.element)
          if (shot) {
            screenshot = shot
            renderShot()
          }
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : L.pickFailed)
      } finally {
        await hide(false)
        setBusy(false, pickBtn, L.selectElement)
      }
    })
    imgBtn.addEventListener("click", () => file.click())
    file.addEventListener("change", () => {
      const f = file.files?.[0]
      file.value = ""
      if (!f) return
      const r = new FileReader()
      r.onload = () => {
        screenshot = String(r.result)
        renderShot()
      }
      r.readAsDataURL(f)
    })

    const xBtn = h("button", { class: "btn ghost icon sm x", type: "button", "aria-label": X.close, title: X.close }, icon("x"))
    xBtn.addEventListener("click", close)
    cancel.addEventListener("click", close)

    const powered = h(
      "a",
      { class: "powered", href: "https://mahaam.app", target: "_blank", rel: "noopener" },
      X.poweredBy,
      mark(),
      h("b", {}, X.brand),
    )

    const form = h(
      "form",
      { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "mf-heading", novalidate: true },
      xBtn,
      h(
        "div",
        { class: "head" },
        h("h2", { class: "title", id: "mf-heading" }, L.reportTitle),
        h("p", { class: "hint" }, fillLabel(L.reportHint, diagnosticsCounts())),
      ),
      h(
        "div",
        { class: "group" },
        h("div", { class: "field" }, h("label", { for: "mf-title" }, L.title), titleIn),
        h(
          "div",
          { class: "cols" },
          h("div", { class: "field" }, h("label", { for: "mf-type" }, L.type), typeSel),
          h("div", { class: "field" }, h("label", { for: "mf-priority" }, L.priority), prioSel),
        ),
        h("div", { class: "field" }, h("label", { for: "mf-body" }, L.details), body),
        h("div", { class: "field" }, h("span", { class: "label" }, L.attach), h("div", { class: "btns" }, shotBtn, pickBtn, imgBtn, file)),
        selLine,
        shotBox,
        err,
      ),
      h("div", { class: "foot" }, powered, h("div", { class: "acts" }, cancel, send)),
    )

    form.addEventListener("submit", async (e) => {
      e.preventDefault()
      const title = titleIn.value.trim()
      if (!title) {
        setErr(X.required)
        titleIn.focus()
        return
      }
      setErr(null)
      send.disabled = true
      send.lastChild!.textContent = L.saving

      const ctx = pageContext()
      const fd = new FormData()
      fd.set("public_key", cfg.key)
      fd.set("title", title)
      fd.set("body", body.value.trim())
      fd.set("issue_type", typeSel.value)
      fd.set("priority", prioSel.value)
      fd.set("page_url", ctx.page_url)
      fd.set("route", ctx.route)
      fd.set("user_agent", ctx.user_agent)
      fd.set("viewport", ctx.viewport)
      if (selector) fd.set("selector", selector)
      fd.set("console_log", consoleSnapshot())
      fd.set("network_log", withPageLoad(networkSnapshot()))
      if (screenshot) fd.set("screenshot", dataUrlToBlob(screenshot), "screenshot.png")
      try {
        const res = await fetch(cfg.endpoint, { method: "POST", body: fd, mode: "cors", credentials: "omit" })
        // 402 (the workspace's plan is out of issues or storage) and 403 (key, origin or workspace
        // unavailable): tell the visitor reporting is not available, rather than "try again".
        if (res.status === 402 || res.status === 403) {
          send.disabled = false
          send.lastChild!.textContent = L.submitReport
          setErr(X.unavailable)
          return
        }
        if (!res.ok) throw new Error(String(res.status))
        const out = (await res.json().catch(() => ({}))) as { key?: string }
        const done = h("button", { class: "btn primary", type: "button" }, X.close)
        done.addEventListener("click", close)
        form.replaceChildren(
          h("div", { class: "head" }, h("h2", { class: "title" }, L.reportTitle)),
          h("p", { class: "ok", role: "status" }, out.key ? X.thanks.replace("{key}", out.key) : X.thanksNoKey),
          h("div", { class: "foot" }, powered, h("div", { class: "acts" }, done)),
        )
        done.focus()
      } catch {
        send.disabled = false
        send.lastChild!.textContent = L.submitReport
        setErr(L.failed)
      }
    })

    overlay = h("div", { class: "overlay" }, form) as HTMLDivElement
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay && !busy) close()
    })
    onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && overlay && !overlay.classList.contains("hidden")) close()
    }
    document.addEventListener("keydown", onKey, true)
    root.append(overlay)
    titleIn.focus()
  }

  const api = { open, close, show: () => launcher?.show() }
  const w = window as unknown as { MahaamFeedback: unknown; ManagyFeedback: unknown }
  w.MahaamFeedback = api
  w.ManagyFeedback = api // pre-rebrand name, kept for sites that already call it
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, data = ""] = dataUrl.split(",", 2)
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/png"
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// The key's look from Mahaam (project settings / MCP set_feedback_widget). The <script>
// tag's own data-locale / data-theme / data-position win over it. A slow or failed fetch
// never blocks the widget: after 2 s it mounts with the default look.
async function loadLook(cfg: Cfg): Promise<void> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 2000)
    const res = await fetch(cfg.endpoint + "/config?key=" + encodeURIComponent(cfg.key), { signal: ctl.signal, credentials: "omit" })
    clearTimeout(t)
    if (!res.ok) return
    const { widget } = (await res.json()) as { widget?: Look & { theme?: string; locale?: string } }
    if (!widget) return
    cfg.look = widget
    if (!cfg.set.locale && (widget.locale === "en" || widget.locale === "ar")) cfg.locale = widget.locale
    if (!cfg.set.theme && (widget.theme === "light" || widget.theme === "dark")) cfg.theme = widget.theme
  } catch {
    /* default look */
  }
}

// Record from the moment the script runs, not from mount (which waits for the look and the DOM):
// otherwise the page-load failures, which are the ones worth reporting, are never seen.
installDiagnostics()

const cfg = readConfig()
if (cfg) {
  void loadLook(cfg).then(() => {
    if (document.body) mount(cfg)
    else window.addEventListener("DOMContentLoaded", () => mount(cfg))
  })
}

/*
 * Requests the recorder could not see — made before this script ran (the document, scripts,
 * styles, images, early API calls) — from the browser's Performance timeline. Status is known
 * where the browser exposes responseStatus (Chromium, Firefox); a transfer of 0 bytes with no
 * status is marked "blocked?" (CORS, ad-blockers, network errors). Newest 40, before the log.
 */
function withPageLoad(recorded: string): string {
  let lines: string[] = []
  try {
    const nav = performance.getEntriesByType("navigation")[0] as (PerformanceNavigationTiming & { responseStatus?: number }) | undefined
    const res = performance.getEntriesByType("resource") as (PerformanceResourceTiming & { responseStatus?: number })[]
    const origin = performance.timeOrigin
    const line = (e: PerformanceResourceTiming & { responseStatus?: number }, kind: string) => {
      const status = e.responseStatus ? String(e.responseStatus) : e.transferSize === 0 && e.decodedBodySize === 0 && e.duration > 0 ? "blocked?" : "—"
      return `[${new Date(origin + e.startTime).toISOString()}] ${kind} ${shortUrl(e.name)} → ${status} ${Math.round(e.duration)}ms`
    }
    if (nav) lines.push(line(nav, "DOCUMENT"))
    lines = lines.concat(
      res
        .filter((e) => !e.name.includes("/api/feedback/embed") && !e.name.includes("/embed/v1"))
        .slice(-40)
        .map((e) => line(e, (e.initiatorType || "resource").toUpperCase())),
    )
  } catch {
    return recorded
  }
  if (!lines.length) return recorded
  return "# page load (Performance timeline)\n" + lines.join("\n") + (recorded ? "\n# recorded requests\n" + recorded : "")
}

function shortUrl(u: string): string {
  try {
    const x = new URL(u, location.href)
    return x.origin === location.origin ? x.pathname + x.search : x.href
  } catch {
    return u.slice(0, 300)
  }
}
