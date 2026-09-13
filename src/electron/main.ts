import { app, BrowserWindow, systemPreferences } from "electron";
import { join } from "node:path";
import { registerBackend, stopBackendProcesses, stopVoiceInput } from "./backend";

let mainWindow: BrowserWindow | null = null;
let backendReady = false;
const ownsProfile = app.requestSingleInstanceLock();
if (!ownsProfile) app.quit();
app.on("second-instance", () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  else if (backendReady) void createWindow();
});

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Rux",
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 19 } } : {}),
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
    },
  });

  mainWindow = window;
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(process.platform === "darwin" && !window.isDestroyed() && contents === window.webContents && permission === "media" && "mediaTypes" in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === "audio" && systemPreferences.getMediaAccessStatus("microphone") === "granted");
  });
  window.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) => process.platform === "darwin" && !window.isDestroyed() && contents === window.webContents && permission === "media" && details.mediaType === "audio" && systemPreferences.getMediaAccessStatus("microphone") === "granted");
  window.once("ready-to-show", () => window.show());
  window.on("close", stopVoiceInput);
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl) {
    await window.loadURL(developmentUrl);
  } else {
    await window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

if (ownsProfile) app.whenReady().then(async () => {
  await registerBackend(() => mainWindow);
  backendReady = true;
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => stopBackendProcesses());
