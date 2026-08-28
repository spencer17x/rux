export type AgentId = "codex" | "claude-code" | "pi";

export type ThreadRecord = {
  id: string; title: string; codexThreadId?: string; agentId?: AgentId;
  nativeSessionId?: string; agentMode?: string; draft?: boolean;
};

export type ProjectRecord = { id: string; name: string; path: string; threads: ThreadRecord[] };
export type WorkspaceState = { projects: ProjectRecord[]; standaloneThreads: ThreadRecord[] };
export type ActiveThread = ThreadRecord & { type: "project" | "standalone"; projectId?: string; projectName?: string; projectPath?: string };
export type AuthState = { connected: boolean; message?: string; account?: { email?: string; planType?: string } | null };
export type GitFile = { path: string; status: string; plus: number; minus: number; untracked: boolean; staged: boolean; unstaged: boolean };
export type GitState = { branch: string; files: GitFile[] };
export type WorkspaceToolId = "review" | "terminal" | "browser" | "files" | "chat";

export type ProjectAction =
  | { kind: "import"; path: string; createThread: boolean }
  | { kind: "clone"; url: string; parent: string; createThread: boolean }
  | { kind: "create"; name: string; parent: string; template: "empty" | "react" | "node"; initGit: boolean; createThread: boolean };
