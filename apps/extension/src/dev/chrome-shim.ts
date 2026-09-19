// Dev harness only (npm run dev:extension): just enough of chrome.* for the popup to run in a
// normal tab against the Vite proxy. Storage is localStorage; the context-menu hand-off can be
// simulated with ?page=<url>&mode=issue|log.
type Bag = Record<string, unknown>;
const area = (prefix: string) => ({
  async get(keys: string | string[]): Promise<Bag> {
    const out: Bag = {};
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      const v = localStorage.getItem(prefix + k);
      if (v !== null) out[k] = JSON.parse(v);
    }
    return out;
  },
  async set(items: Bag): Promise<void> {
    for (const [k, v] of Object.entries(items)) localStorage.setItem(prefix + k, JSON.stringify(v ?? null));
  },
  async remove(keys: string | string[]): Promise<void> {
    for (const k of Array.isArray(keys) ? keys : [keys]) localStorage.removeItem(prefix + k);
  },
});

const q = new URLSearchParams(location.search);
const session = area("dev.session.");
if (q.get("page")) void session.set({ pending: { url: q.get("page"), title: q.get("title") ?? "Dev page", mode: q.get("mode") === "log" ? "log" : "issue" } });

const sent: unknown[] = [];
(globalThis as unknown as { __mahaamSent: unknown[] }).__mahaamSent = sent;
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { local: area("dev.local."), session },
  runtime: { id: "dev", sendMessage: async (m: unknown) => void sent.push(m), getURL: (p: string) => "/" + p },
  permissions: { request: async () => true, contains: async () => true },
  tabs: { create: ({ url }: { url: string }) => window.open(url, "_blank", "noopener") },
};
export {};
