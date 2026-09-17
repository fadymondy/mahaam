/*
 * Managy embeddable Feedback widget (P7).
 *
 * A single IIFE, bundled with esbuild, that a client pastes onto their own site:
 *
 *   <script src="https://managy-app.fadymondy.com/embed/v1.js"
 *           data-key="pfk_…" defer></script>
 *
 * It renders a "Report a problem" launcher inside a Shadow DOM (so the host page's
 * CSS and the widget's never leak into each other), captures a screenshot of the
 * viewport plus the console/network diagnostics, and POSTs multipart/form-data to
 * the PUBLIC endpoint /api/feedback/embed, authenticated only by the per-project
 * public key. The key can do exactly one thing server-side: file an issue into its
 * project. No session, no workspace header.
 *
 * The capture/diagnostics/context code is the SHARED feedback-sdk core (the same
 * one the in-app dialog uses), imported from web/lib/feedback/core, so the hard-won
 * capture fixes are not re-implemented here.
 */
import {
  installDiagnostics,
  consoleSnapshot,
  networkSnapshot,
  captureViewport,
  pageContext,
} from "../../web/lib/feedback/core/index"

type Cfg = {
  key: string
  endpoint: string
  locale: "en" | "ar"
}

const STRINGS = {
  en: {
    launch: "Report a problem",
    title: "Report a problem",
    typeBug: "Something is broken",
    typeFeature: "An idea",
    typeTask: "Something else",
    subject: "Summary",
    kind: "Type",
    subjectPh: "What went wrong?",
    details: "Details",
    detailsPh: "Steps, what you expected, what happened…",
    shot: "A screenshot of this page is attached automatically.",
    send: "Send",
    sending: "Sending…",
    cancel: "Cancel",
    thanks: "Thanks — your report was sent.",
    failed: "Could not send. Please try again.",
  },
  ar: {
    launch: "الإبلاغ عن مشكلة",
    title: "الإبلاغ عن مشكلة",
    typeBug: "هناك خطأ ما",
    typeFeature: "فكرة",
    typeTask: "شيء آخر",
    subject: "الملخّص",
    kind: "النوع",
    subjectPh: "ما الذي حدث؟",
    details: "التفاصيل",
    detailsPh: "الخطوات، وما توقّعته، وما حدث…",
    shot: "يتم إرفاق لقطة شاشة لهذه الصفحة تلقائيًا.",
    send: "إرسال",
    sending: "جارٍ الإرسال…",
    cancel: "إلغاء",
    thanks: "شكرًا — تم إرسال بلاغك.",
    failed: "تعذّر الإرسال. حاول مرّة أخرى.",
  },
} as const

function readConfig(): Cfg | null {
  const el =
    (document.currentScript as HTMLScriptElement | null) ||
    document.querySelector<HTMLScriptElement>('script[data-key^="pfk_"]')
  const key = el?.getAttribute("data-key")?.trim()
  if (!key) {
    console.warn("[managy-feedback] missing data-key on the <script> tag")
    return null
  }
  let endpoint = el?.getAttribute("data-endpoint")?.trim() || ""
  if (!endpoint && el?.src) {
    try {
      endpoint = new URL("/api/feedback/embed", el.src).toString()
    } catch {
      /* ignore */
    }
  }
  const locale = (el?.getAttribute("data-locale")?.trim() === "ar" ? "ar" : "en") as "en" | "ar"
  return { key, endpoint: endpoint || "/api/feedback/embed", locale }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  for (const k of kids) node.append(k)
  return node
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.launcher {
  position: fixed; inset-block-end: 20px; inset-inline-end: 20px; z-index: 2147483000;
  border: 0; border-radius: 9999px; padding: 10px 16px; font-size: 14px; font-weight: 600;
  color: #fff; background: #4B00B6; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.25);
}
.launcher:hover { background: #5a12cf; }
.overlay { position: fixed; inset: 0; z-index: 2147483001; background: rgba(0,0,0,.45);
  display: flex; align-items: center; justify-content: center; padding: 16px; }
.card { width: 100%; max-width: 420px; background: #fff; color: #17161c; border-radius: 14px;
  padding: 20px; box-shadow: 0 24px 60px rgba(0,0,0,.35); }
.card h2 { margin: 0 0 12px; font-size: 17px; }
.row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
label { font-size: 12px; font-weight: 600; color: #55525e; }
input, textarea, select { width: 100%; border: 1px solid #d9d7e0; border-radius: 9px;
  padding: 9px 10px; font-size: 14px; background: #fff; color: inherit; }
textarea { min-height: 90px; resize: vertical; }
.hint { font-size: 12px; color: #7a7784; }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
button.act { border: 0; border-radius: 9px; padding: 9px 16px; font-size: 14px; font-weight: 600; cursor: pointer; }
.primary { background: #4B00B6; color: #fff; }
.primary:disabled { opacity: .6; cursor: default; }
.ghost { background: transparent; color: #55525e; }
.status { font-size: 13px; margin-top: 8px; }
.status.ok { color: #157347; }
.status.err { color: #c0362c; }
@media (prefers-color-scheme: dark) {
  .card { background: #1b1a22; color: #ececf1; }
  label { color: #a6a3b0; }
  input, textarea, select { background: #24232c; border-color: #3a3944; color: #ececf1; }
  .hint { color: #a6a3b0; }
  .ghost { color: #a6a3b0; }
  .launcher { background: #6a2bd6; }
}
`

function mount(cfg: Cfg) {
  installDiagnostics()
  const t = STRINGS[cfg.locale]

  const host = el("div", {})
  host.setAttribute("data-reporter", "") // exclude the widget from its own screenshots
  const root = host.attachShadow({ mode: "open" })
  const style = document.createElement("style")
  style.textContent = CSS
  root.append(style)
  if (cfg.locale === "ar") root.host.setAttribute("dir", "rtl")

  const launcher = el("button", { className: "launcher", textContent: t.launch })
  root.append(launcher)
  document.body.append(host)

  let overlay: HTMLDivElement | null = null

  const close = () => {
    overlay?.remove()
    overlay = null
    launcher.style.display = ""
  }

  launcher.addEventListener("click", () => {
    if (overlay) return
    launcher.style.display = "none"

    const typeSel = el("select", {}) as HTMLSelectElement
    typeSel.append(
      el("option", { value: "bug", textContent: t.typeBug }),
      el("option", { value: "feature", textContent: t.typeFeature }),
      el("option", { value: "task", textContent: t.typeTask }),
    )
    const subject = el("input", { type: "text", placeholder: t.subjectPh, maxLength: 200 }) as HTMLInputElement
    const details = el("textarea", { placeholder: t.detailsPh }) as HTMLTextAreaElement
    const status = el("div", { className: "status" })
    const send = el("button", { className: "act primary", textContent: t.send }) as HTMLButtonElement
    const cancel = el("button", { className: "act ghost", textContent: t.cancel })

    const card = el(
      "div",
      { className: "card" },
      el("h2", { textContent: t.title }),
      el("div", { className: "row" }, el("label", { textContent: t.subject }), subject),
      el("div", { className: "row" }, el("label", { textContent: t.details }), details),
      el("div", { className: "row" }, el("label", { textContent: t.kind }), typeSel),
      el("div", { className: "hint", textContent: t.shot }),
      el("div", { className: "actions" }, cancel, send),
      status,
    )
    overlay = el("div", { className: "overlay" }, card) as HTMLDivElement
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close()
    })
    cancel.addEventListener("click", close)
    root.append(overlay)
    subject.focus()

    send.addEventListener("click", async () => {
      const title = subject.value.trim()
      if (!title) {
        subject.focus()
        return
      }
      send.disabled = true
      send.textContent = t.sending
      status.textContent = ""
      status.className = "status"

      // Hide the dialog so it is not in the screenshot, then restore it.
      const prevDisplay = overlay!.style.display
      overlay!.style.display = "none"
      let screenshot = ""
      try {
        screenshot = await captureViewport()
      } catch {
        /* a screenshot is best-effort */
      }
      overlay!.style.display = prevDisplay

      const ctx = pageContext()
      const form = new FormData()
      form.set("public_key", cfg.key)
      form.set("title", title)
      form.set("body", details.value.trim())
      form.set("issue_type", typeSel.value)
      form.set("page_url", ctx.page_url)
      form.set("route", ctx.route)
      form.set("user_agent", ctx.user_agent)
      form.set("viewport", ctx.viewport)
      form.set("console_log", consoleSnapshot(50))
      form.set("network_log", networkSnapshot(50))
      if (screenshot) {
        const blob = dataUrlToBlob(screenshot)
        form.set("screenshot", blob, "screenshot.png")
      }
      try {
        const res = await fetch(cfg.endpoint, {
          method: "POST",
          body: form,
          mode: "cors",
          credentials: "omit",
        })
        if (res.ok) {
          card.replaceChildren(
            el("h2", { textContent: t.title }),
            el("div", { className: "status ok", textContent: t.thanks }),
            el("div", { className: "actions" }, el("button", { className: "act primary", textContent: t.cancel, onclick: close })),
          )
          return
        }
        throw new Error(String(res.status))
      } catch {
        send.disabled = false
        send.textContent = t.send
        status.textContent = t.failed
        status.className = "status err"
      }
    })
  })
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, data = ""] = dataUrl.split(",", 2)
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/png"
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

const cfg = readConfig()
if (cfg) {
  if (document.body) mount(cfg)
  else window.addEventListener("DOMContentLoaded", () => mount(cfg))
}
