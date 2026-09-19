import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_API_URL, normalizeApiUrl } from "@mahaam/client";
import { Mark } from "@mahaam/client/ui";
import "@mahaam/client/tokens.css";
import "@mahaam/client/panel.css";
import "./popup.css";
import { loadState, requestOrigin, saveState } from "./ext";

// Options: which Mahaam server the extension talks to. Changing it asks Chrome for that origin's
// host permission and signs out (a token belongs to one server).
function Options() {
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void loadState().then((s) => setUrl(s.apiUrl));
    document.documentElement.classList.toggle("dark", matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    let next: string;
    try {
      next = normalizeApiUrl(url);
    } catch {
      return setMsg("Not a valid URL.");
    }
    if (!(await requestOrigin(next))) return setMsg(`Permission to reach ${new URL(next).host} was not granted.`);
    const cur = await loadState();
    await saveState(next === cur.apiUrl ? { apiUrl: next } : { apiUrl: next, token: null, workspace: null });
    setUrl(next);
    setMsg("Saved.");
  };
  return (
    <form onSubmit={save}>
      <h1 className="mgy-bar">
        <Mark size={20} /> Mahaam
      </h1>
      <label className="mgy-field">
        <span>Server</span>
        <input type="url" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_API_URL} />
      </label>
      <p className="mgy-muted mgy-small">
        Default: {DEFAULT_API_URL}. The extension only has access to the server you choose here.
      </p>
      <div className="mgy-foot-actions">
        <span className="mgy-ok">{msg}</span>
        <button className="mgy-btn mgy-btn-primary">Save</button>
      </div>
    </form>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
