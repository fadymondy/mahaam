/*
 * The Feedback widget's floating launcher: the part a visitor sees all the time.
 *
 * Look — set per key in Mahaam (project settings or MCP set_feedback_widget) and read from
 * GET /api/feedback/embed/config: colour, text colour, icon, text, shape (pill · circle ·
 * square · tab) and initial position (a corner or the middle of an edge).
 *
 * Behaviour — the visitor's own, kept in localStorage per key (sessionStorage for "hide for
 * now"), never sent anywhere:
 *   - drag it anywhere (pointer events; a move of more than 4px is a drag, not a click);
 *     it stays inside the viewport, also after a resize;
 *   - right-click (or long-press on touch, or Shift+F10 / the context-menu key) opens a menu:
 *     dock to the edge / undock, move to a corner, reset position, hide for now, hide on
 *     this site;
 *   - docked, only a 14px strip shows at the nearest side edge; hover or focus slides it out;
 *   - hidden, Ctrl/⌘+Shift+F or window.MahaamFeedback.show() brings it back.
 */

export type Look = {
  color?: string
  text_color?: string
  icon?: string
  text?: string
  shape?: string
  position?: string
}

export type LauncherStrings = {
  label: string
  menu: string
  dock: string
  undock: string
  moveTo: string
  corners: Record<"top-start" | "top-end" | "bottom-start" | "bottom-end", string>
  reset: string
  hideNow: string
  hideSite: string
  shortcut: string
}

type State = { x?: number; y?: number; docked?: boolean; hidden?: boolean }

const MARGIN = 20
const PEEK = 14

export function createLauncher(opts: {
  root: HTMLElement
  storageKey: string
  look: Look
  rtl: boolean
  strings: LauncherStrings
  iconFor: (name: string) => SVGElement | null
  onOpen: () => void
}) {
  const { root, look, strings: S } = opts
  const shape = ["pill", "circle", "square", "tab"].includes(look.shape ?? "") ? look.shape! : "pill"
  const el = document.createElement("button")
  el.type = "button"
  el.className = `launcher ${shape}`
  el.setAttribute("aria-haspopup", "dialog")
  el.setAttribute("aria-label", look.text || S.label)
  el.title = `${look.text || S.label} — ${S.menu}`
  if (look.color) el.style.setProperty("--launch-bg", look.color)
  if (look.text_color) el.style.setProperty("--launch-fg", look.text_color)
  const ic = look.icon === "none" ? null : opts.iconFor(look.icon || "bug")
  if (ic) el.append(ic)
  const lbl = document.createElement("span")
  lbl.className = "lbl"
  lbl.textContent = look.text || S.label
  el.append(lbl)
  root.append(el)

  // ---- persisted state ----------------------------------------------------------
  const read = (): State => {
    try {
      return JSON.parse(localStorage.getItem(opts.storageKey) || "{}") as State
    } catch {
      return {}
    }
  }
  const write = (s: State) => {
    try {
      localStorage.setItem(opts.storageKey, JSON.stringify(s))
    } catch {
      /* private mode */
    }
  }
  let state = read()
  const sessionHidden = () => {
    try {
      return sessionStorage.getItem(opts.storageKey + ":hidden") === "1"
    } catch {
      return false
    }
  }

  // ---- placement ------------------------------------------------------------------
  const size = () => ({ w: el.offsetWidth || 48, h: el.offsetHeight || 40 })
  const vw = () => document.documentElement.clientWidth || window.innerWidth
  const vh = () => window.innerHeight

  function presetXY(pos: string): { x: number; y: number } {
    const { w, h } = size()
    const [v, side] = pos.split("-") as [string, string]
    // "end" is the reading end: right in LTR, left in RTL.
    const right = side === "end" ? !opts.rtl : opts.rtl
    // A tab at the middle of an edge is flush with it, as a tab is; everything else keeps a margin.
    const mx = shape === "tab" && v === "middle" ? 0 : MARGIN
    const x = right ? vw() - w - mx : mx
    const y = v === "top" ? MARGIN : v === "middle" ? (vh() - h) / 2 : vh() - h - MARGIN
    return { x, y }
  }

  const clamp = (x: number, y: number) => {
    const { w, h } = size()
    return {
      x: Math.min(Math.max(x, 0), Math.max(0, vw() - w)),
      y: Math.min(Math.max(y, 0), Math.max(0, vh() - h)),
    }
  }

  // Stored as fractions of the viewport so a resize keeps the launcher in the same place.
  function currentXY() {
    if (state.x != null && state.y != null) {
      const { w, h } = size()
      return clamp(state.x * (vw() - w), state.y * (vh() - h))
    }
    return clamp(...(Object.values(presetXY(look.position || "bottom-end")) as [number, number]))
  }

  function nearRight(x: number) {
    return x + size().w / 2 > vw() / 2
  }

  function place() {
    if (state.hidden || sessionHidden()) {
      el.style.display = "none"
      return
    }
    el.style.display = ""
    let { x, y } = currentXY()
    const docked = !!state.docked
    el.classList.toggle("docked", docked)
    if (docked) {
      const right = nearRight(x)
      el.classList.toggle("dock-right", right)
      el.classList.toggle("dock-left", !right)
      const peeking = el.matches(":hover") || el.matches(":focus-visible") || menu !== null
      const w = size().w
      x = right ? (peeking ? vw() - w : vw() - PEEK) : peeking ? 0 : PEEK - w
    } else {
      el.classList.remove("dock-right", "dock-left")
    }
    el.classList.toggle("edge-left", !docked && x <= 0)
    el.classList.toggle("edge-right", !docked && x >= vw() - size().w)
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }

  function save(x: number, y: number) {
    const { w, h } = size()
    state = { ...state, x: vw() > w ? x / (vw() - w) : 0, y: vh() > h ? y / (vh() - h) : 0 }
    write(state)
  }

  // ---- drag -------------------------------------------------------------------------
  let drag: { id: number; dx: number; dy: number; sx: number; sy: number; moved: boolean } | null = null
  let suppressClick = false
  let longPress: ReturnType<typeof setTimeout> | null = null

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return
    const r = el.getBoundingClientRect()
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false }
    el.setPointerCapture(e.pointerId)
    if (e.pointerType !== "mouse") {
      longPress = setTimeout(() => {
        if (drag && !drag.moved) {
          drag = null
          suppressClick = true
          openMenu(r.left, r.top)
        }
      }, 600)
    }
  })
  el.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return
    if (!drag.moved) {
      drag.moved = true
      if (longPress) clearTimeout(longPress)
      el.classList.add("dragging")
      if (state.docked) {
        state = { ...state, docked: false }
        el.classList.remove("docked", "dock-right", "dock-left")
      }
    }
    const { x, y } = clamp(e.clientX - drag.dx, e.clientY - drag.dy)
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  })
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    if (longPress) clearTimeout(longPress)
    if (drag.moved) {
      suppressClick = true
      const r = el.getBoundingClientRect()
      save(r.left, r.top)
    }
    el.classList.remove("dragging")
    drag = null
  }
  el.addEventListener("pointerup", endDrag)
  el.addEventListener("pointercancel", endDrag)
  el.addEventListener("click", (e) => {
    if (suppressClick) {
      suppressClick = false
      e.preventDefault()
      return
    }
    opts.onOpen()
  })
  el.addEventListener("mouseenter", place)
  el.addEventListener("mouseleave", place)
  el.addEventListener("focus", place)
  el.addEventListener("blur", place)

  // ---- context menu -----------------------------------------------------------------
  let menu: HTMLDivElement | null = null
  const closeMenu = () => {
    menu?.remove()
    menu = null
    document.removeEventListener("pointerdown", outside, true)
    document.removeEventListener("keydown", menuKey, true)
    place()
  }
  const outside = (e: Event) => {
    if (menu && !e.composedPath().includes(menu)) closeMenu()
  }
  const menuKey = (e: KeyboardEvent) => {
    if (!menu) return
    const items = [...menu.querySelectorAll<HTMLButtonElement>("button")]
    const cur = items.indexOf((menu.getRootNode() as ShadowRoot).activeElement as HTMLButtonElement)
    if (e.key === "Escape") {
      e.preventDefault()
      closeMenu()
      el.focus()
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const n = items.length
      items[(((cur < 0 ? -1 : cur) + (e.key === "ArrowDown" ? 1 : -1)) % n + n) % n]?.focus()
    }
  }

  function openMenu(x: number, y: number) {
    closeMenu()
    menu = document.createElement("div")
    menu.className = "menu"
    menu.setAttribute("role", "menu")
    menu.setAttribute("aria-label", S.menu)
    const item = (label: string, run: () => void) => {
      const b = document.createElement("button")
      b.type = "button"
      b.setAttribute("role", "menuitem")
      b.textContent = label
      b.addEventListener("click", () => {
        closeMenu()
        run()
      })
      menu!.append(b)
    }
    const sep = (label?: string) => {
      const d = document.createElement("div")
      d.className = label ? "menu-label" : "menu-sep"
      if (label) d.textContent = label
      menu!.append(d)
    }
    item(state.docked ? S.undock : S.dock, () => {
      state = { ...state, docked: !state.docked }
      write(state)
      place()
    })
    sep(S.moveTo)
    for (const pos of ["top-start", "top-end", "bottom-start", "bottom-end"] as const) {
      item(S.corners[pos], () => {
        const p = presetXY(pos)
        state = { ...state, docked: false }
        save(p.x, p.y)
        place()
      })
    }
    item(S.reset, () => {
      state = {}
      write(state)
      place()
    })
    sep()
    item(S.hideNow, () => {
      try {
        sessionStorage.setItem(opts.storageKey + ":hidden", "1")
      } catch {
        /* ignore */
      }
      place()
    })
    item(S.hideSite, () => {
      state = { ...state, hidden: true }
      write(state)
      place()
    })
    const hint = document.createElement("div")
    hint.className = "menu-hint"
    hint.textContent = S.shortcut
    menu.append(hint)
    root.append(menu)
    // Keep the menu on screen.
    const mw = menu.offsetWidth
    const mh = menu.offsetHeight
    menu.style.left = `${Math.min(Math.max(8, x), vw() - mw - 8)}px`
    menu.style.top = `${Math.min(Math.max(8, y - mh - 8 < 8 ? y + size().h + 8 : y - mh - 8), vh() - mh - 8)}px`
    document.addEventListener("pointerdown", outside, true)
    document.addEventListener("keydown", menuKey, true)
    menu.querySelector("button")?.focus()
  }

  el.addEventListener("contextmenu", (e) => {
    e.preventDefault()
    openMenu(e.clientX, e.clientY)
  })
  el.addEventListener("keydown", (e) => {
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      openMenu(r.left, r.top)
    }
  })

  // ---- show again -------------------------------------------------------------------
  function show() {
    state = { ...state, hidden: false }
    write(state)
    try {
      sessionStorage.removeItem(opts.storageKey + ":hidden")
    } catch {
      /* ignore */
    }
    place()
  }
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "F" || e.key === "f")) {
      e.preventDefault()
      show()
      el.focus()
    }
  })
  window.addEventListener("resize", place)

  // First placement once the label has laid out (its width decides the corner offset).
  requestAnimationFrame(place)

  return {
    el,
    show,
    /** While the dialog is open the launcher steps aside. */
    setOpen(open: boolean) {
      if (open) el.style.display = "none"
      else place()
    },
  }
}

export const LAUNCHER_CSS = `
.launcher {
  position: fixed; left: 0; top: 0; z-index: 2147483000; display: inline-flex; align-items: center; gap: 8px;
  height: 40px; padding: 0 16px 0 12px; border: 1px solid transparent; border-radius: 9999px;
  font: 500 14px/1 var(--sans); color: var(--launch-fg, var(--on-action)); background: var(--launch-bg, var(--action));
  cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; white-space: nowrap;
  box-shadow: 0 8px 24px rgba(14, 26, 60, .28);
  transition: left 180ms ease, top 180ms ease, box-shadow 150ms ease, border-radius 150ms ease;
}
.launcher .i { width: 18px; height: 18px; }
.launcher:hover { box-shadow: 0 10px 28px rgba(14, 26, 60, .34); }
.launcher.dragging { cursor: grabbing; transition: none; box-shadow: 0 16px 36px rgba(14, 26, 60, .38); }
.launcher.circle, .launcher.square { width: 48px; height: 48px; padding: 0; justify-content: center; }
.launcher.square { border-radius: 12px; }
.launcher.circle .lbl, .launcher.square .lbl { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.launcher.tab { height: auto; padding: 14px 9px; writing-mode: vertical-rl; border-radius: 10px; gap: 10px; }
.launcher.tab .i { transform: rotate(90deg); }
.launcher.tab.edge-left { border-top-left-radius: 0; border-bottom-left-radius: 0; }
.launcher.tab.edge-right { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.launcher.docked.dock-right { border-start-end-radius: 0; border-end-end-radius: 0; }
.launcher.docked.dock-left { border-start-start-radius: 0; border-end-start-radius: 0; }
.root[dir="rtl"] .launcher.docked.dock-right { border-radius: 9999px 0 0 9999px; }
.root[dir="rtl"] .launcher.docked.dock-left { border-radius: 0 9999px 9999px 0; }
.menu {
  position: fixed; z-index: 2147483002; min-width: 220px; padding: 4px; border-radius: 10px;
  background: var(--elevated); color: var(--fg); box-shadow: 0 0 0 1px var(--line), 0 16px 40px rgba(14, 26, 60, .25);
  font: 400 14px/1.3 var(--sans); animation: pop 100ms ease;
}
.menu button {
  display: flex; width: 100%; align-items: center; padding: 7px 10px; border: 0; border-radius: 6px;
  background: transparent; color: inherit; font: inherit; text-align: start; cursor: pointer;
}
.menu button:hover, .menu button:focus-visible { background: var(--soft); outline: none; }
.menu-sep { height: 1px; margin: 4px 6px; background: var(--line); }
.menu-label { padding: 8px 10px 2px; font-size: 12px; color: var(--muted); }
.menu-hint { padding: 6px 10px 4px; font-size: 11.5px; color: var(--muted); border-top: 1px solid var(--line); margin-top: 4px; }
`
