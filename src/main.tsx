import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installWebMock } from "./renderer/web-mock";
import "./ui/tokens.css";
import "./styles.css";
import "./workbench-theme.css";
import "./ui/ui.css";

const root = document.getElementById("root");
if (!root) throw new Error("Rux root element is missing");

async function render(): Promise<void> {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "components") {
    const { default: ComponentGallery } = await import("./ui/ComponentGallery");
    createRoot(root!).render(<StrictMode><ComponentGallery /></StrictMode>);
    return;
  }
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("prototype") === "conversation-output") {
    const { default: ConversationOutputPrototype } = await import("./prototypes/ConversationOutputPrototype");
    createRoot(root!).render(<StrictMode><ConversationOutputPrototype /></StrictMode>);
    return;
  }
  if (import.meta.env.DEV && !window.rux) installWebMock();
  const { default: App } = await import("./App");
  createRoot(root!).render(<StrictMode><App /></StrictMode>);
}

void render();
