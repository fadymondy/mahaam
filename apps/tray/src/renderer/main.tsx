import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Panel } from "@mahaam/client/ui";
import "@mahaam/client/tokens.css";
import "@mahaam/client/panel.css";
import { trayHost } from "./host";

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") void window.mahaam.invoke("mgy:hide");
});

void trayHost().then((host) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Panel host={host} />
    </StrictMode>,
  );
});
