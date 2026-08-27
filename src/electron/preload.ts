import { contextBridge, ipcRenderer } from "electron";

const api = {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: (input: unknown) => ipcRenderer.invoke("settings:save", input),
    test: (input: unknown) => ipcRenderer.invoke("settings:test", input),
  },
  providers: {
    list: () => ipcRenderer.invoke("providers:list"),
    save: (input: unknown) => ipcRenderer.invoke("providers:save", input),
    remove: (id: string) => ipcRenderer.invoke("providers:remove", id),
    setActive: (id: string) => ipcRenderer.invoke("providers:set-active", id),
    test: (id: string) => ipcRenderer.invoke("providers:test", id),
  },
  auth: {
    status: () => ipcRenderer.invoke("auth:status"),
    login: () => ipcRenderer.invoke("auth:login"),
    logout: () => ipcRenderer.invoke("auth:logout"),
    onLoginEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, loginEvent: unknown) => listener(loginEvent);
      ipcRenderer.on("auth:login-event", handler);
      return () => { ipcRenderer.removeListener("auth:login-event", handler); };
    },
  },
  models: {
    list: (input?: unknown) => ipcRenderer.invoke("models:list", input),
  },
  agents: {
    list: () => ipcRenderer.invoke("agents:list"),
  },
  runtimes: {
    list: () => ipcRenderer.invoke("runtimes:list"),
    ensure: (agentId: string) => ipcRenderer.invoke("runtimes:ensure", agentId),
    onProgress: (listener: (progress: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => listener(progress);
      ipcRenderer.on("runtime:progress", handler);
      return () => { ipcRenderer.removeListener("runtime:progress", handler); };
    },
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
    remove: (input: unknown) => ipcRenderer.invoke("threads:remove", input),
  },
  messages: {
    list: () => ipcRenderer.invoke("messages:list"),
    save: (input: unknown) => ipcRenderer.invoke("messages:save", input),
  },
  agent: {
    send: (input: unknown) => ipcRenderer.invoke("agent:send", input),
    start: (input: unknown) => ipcRenderer.invoke("agent:start", input),
    interrupt: (input: unknown) => ipcRenderer.invoke("agent:interrupt", input),
    respondToApproval: (input: unknown) => ipcRenderer.invoke("agent:approval", input),
    onEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, event: unknown) => listener(event);
      ipcRenderer.on("agent:event", handler);
      return () => { ipcRenderer.removeListener("agent:event", handler); };
    },
  },
  git: {
    status: (projectId: string) => ipcRenderer.invoke("git:status", projectId),
    diff: (input: unknown) => ipcRenderer.invoke("git:diff", input),
    branches: (projectId: string) => ipcRenderer.invoke("git:branches", projectId),
    switchBranch: (input: unknown) => ipcRenderer.invoke("git:switch", input),
    remote: (projectId: string) => ipcRenderer.invoke("git:remote", projectId),
    commitPush: (input: unknown) => ipcRenderer.invoke("git:commit-push", input),
    stage: (input: unknown) => ipcRenderer.invoke("git:stage", input),
    discard: (input: unknown) => ipcRenderer.invoke("git:discard", input),
  },
  files: {
    list: (projectId: string) => ipcRenderer.invoke("files:list", projectId),
    open: (input: unknown) => ipcRenderer.invoke("files:open", input),
  },
  terminal: {
    start: (projectId: string) => ipcRenderer.invoke("terminal:start", projectId),
    write: (input: string) => ipcRenderer.invoke("terminal:write", input),
    resize: (input: unknown) => ipcRenderer.invoke("terminal:resize", input),
    stop: () => ipcRenderer.invoke("terminal:stop"),
    onData: (listener: (data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: string) => listener(data);
      ipcRenderer.on("terminal:data", handler);
      return () => { ipcRenderer.removeListener("terminal:data", handler); };
    },
  },
  system: {
    openPath: (projectId: string) => ipcRenderer.invoke("system:open-path", projectId),
    chooseFiles: () => ipcRenderer.invoke("system:choose-files"),
    copy: (value: string) => ipcRenderer.invoke("system:copy", value),
    openExternal: (url: string) => ipcRenderer.invoke("system:open-external", url),
    openMessageTarget: (input: unknown) => ipcRenderer.invoke("system:open-message-target", input),
    showMessageContextMenu: (input: unknown) => ipcRenderer.invoke("system:message-context-menu", input),
    info: () => ipcRenderer.invoke("system:info"),
  },
};

export type RuxApi = typeof api;

contextBridge.exposeInMainWorld("rux", api);
