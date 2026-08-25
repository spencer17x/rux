import { contextBridge, ipcRenderer } from "electron";

const api = {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: (input: unknown) => ipcRenderer.invoke("settings:save", input),
    test: (input: unknown) => ipcRenderer.invoke("settings:test", input),
  },
  auth: {
    status: () => ipcRenderer.invoke("auth:status"),
    login: () => ipcRenderer.invoke("auth:login"),
    logout: () => ipcRenderer.invoke("auth:logout"),
  },
  models: {
    list: () => ipcRenderer.invoke("models:list"),
  },
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    defaultParent: () => ipcRenderer.invoke("projects:default-parent"),
    chooseDirectory: () => ipcRenderer.invoke("projects:choose-directory"),
    import: (input: unknown) => ipcRenderer.invoke("projects:import", input),
    clone: (input: unknown) => ipcRenderer.invoke("projects:clone", input),
    create: (input: unknown) => ipcRenderer.invoke("projects:create", input),
    remove: (projectId: string) => ipcRenderer.invoke("projects:remove", projectId),
    addThread: (input: unknown) => ipcRenderer.invoke("projects:add-thread", input),
    addStandalone: (input: unknown) => ipcRenderer.invoke("projects:add-standalone", input),
    updateThread: (input: unknown) => ipcRenderer.invoke("projects:update-thread", input),
  },
  threads: {
    update: (input: unknown) => ipcRenderer.invoke("threads:update", input),
  },
  agent: {
    send: (input: unknown) => ipcRenderer.invoke("agent:send", input),
  },
  git: {
    status: (projectId: string) => ipcRenderer.invoke("git:status", projectId),
    diff: (input: unknown) => ipcRenderer.invoke("git:diff", input),
    stage: (input: unknown) => ipcRenderer.invoke("git:stage", input),
    discard: (input: unknown) => ipcRenderer.invoke("git:discard", input),
  },
  terminal: {
    start: (projectId: string) => ipcRenderer.invoke("terminal:start", projectId),
    write: (input: string) => ipcRenderer.invoke("terminal:write", input),
    stop: () => ipcRenderer.invoke("terminal:stop"),
    onData: (listener: (data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: string) => listener(data);
      ipcRenderer.on("terminal:data", handler);
      return () => ipcRenderer.removeListener("terminal:data", handler);
    },
  },
  system: {
    openPath: (projectId: string) => ipcRenderer.invoke("system:open-path", projectId),
  },
};

contextBridge.exposeInMainWorld("rux", api);
