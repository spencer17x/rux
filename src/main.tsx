import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installWebMock } from "./renderer/web-mock";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Rux root element is missing");

async function render(): Promise<void> {
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
