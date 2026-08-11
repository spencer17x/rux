import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";

if (window.rux) {
  document.body.classList.add("is-electron");
  void window.rux.getDesktopInfo().then((info) => {
    document.body.classList.add(`platform-${info.platform}`);
    document.body.dataset.ruxVersion = info.version;
  });
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
