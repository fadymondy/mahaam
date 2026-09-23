// In-app navigation: a history of Routes (no URLs — this is an app, not a site). Back/forward are
// ⌘[ / ⌘] and the mouse's back/forward buttons, like Linear and Finder.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { Route } from "../../shared/types";

interface RouterCtx {
  route: Route;
  navigate: (to: Route, opts?: { replace?: boolean }) => void;
  back: () => void;
  forward: () => void;
  canBack: boolean;
  canForward: boolean;
}

const Ctx = createContext<RouterCtx | null>(null);
const KEY = "mahaam.route";

const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);

function initial(): Route {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? "null") as Route | null;
    if (r && typeof r.name === "string") return r;
  } catch {}
  return { name: "my-issues" };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ stack: Route[]; index: number }>(() => ({ stack: [initial()], index: 0 }));
  const route = state.stack[state.index]!;

  useEffect(() => {
    // Where the person was is where the app reopens (not an issue that may have gone).
    if (route.name !== "issue") localStorage.setItem(KEY, JSON.stringify(route));
  }, [route]);

  const navigate = useCallback((to: Route, opts?: { replace?: boolean }) => {
    setState((s) => {
      const cur = s.stack[s.index]!;
      if (same(cur, to)) return s;
      if (opts?.replace) {
        const stack = s.stack.slice();
        stack[s.index] = to;
        return { stack, index: s.index };
      }
      const stack = [...s.stack.slice(0, s.index + 1), to].slice(-100);
      return { stack, index: stack.length - 1 };
    });
  }, []);
  const back = useCallback(() => setState((s) => (s.index > 0 ? { ...s, index: s.index - 1 } : s)), []);
  const forward = useCallback(() => setState((s) => (s.index < s.stack.length - 1 ? { ...s, index: s.index + 1 } : s)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "[") {
        e.preventDefault();
        back();
      } else if (e.key === "]") {
        e.preventDefault();
        forward();
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) back();
      if (e.button === 4) forward();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, [back, forward]);

  const value = useMemo(
    () => ({ route, navigate, back, forward, canBack: state.index > 0, canForward: state.index < state.stack.length - 1 }),
    [route, navigate, back, forward, state.index, state.stack.length],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRouter(): RouterCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRouter outside RouterProvider");
  return v;
}
