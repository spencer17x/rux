import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TopBar from "../navigation/TopBar";
import Sidebar from "../navigation/Sidebar";
import RenameThreadModal from "../conversation/RenameThreadModal";
import AddProjectModal from "../projects/AddProjectModal";
import ReviewScreen from "../workspace/ReviewScreen";
import ToolLauncher from "../workspace/ToolLauncher";
import { ModelPopover, PermissionPopover } from "../composer/ComposerControls";
import WorkspaceDock from "../workspace/WorkspaceDock";
import EnvironmentPanel from "../workspace/EnvironmentPanel";

describe("typed renderer components", () => {
  it("renders project context in the top bar", () => {
    const html = renderToStaticMarkup(<TopBar activeThread={{ id: "thread", title: "Task", type: "project", projectName: "Rux" }} leftPanelOpen={false} bottomPanelOpen={false} rightPanelOpen onToggleLeftPanel={() => {}} onToggleBottomPanel={() => {}} onToggleRightPanel={() => {}} onOpenSettings={() => {}} onOpenPath={() => {}} onCopyPath={() => {}} onShare={() => {}} onRename={() => {}} onRemoveThread={() => {}} />);
    expect(html).toContain("Rux"); expect(html).toContain("Task");
    expect(html).toContain('aria-label="切换左侧面板"'); expect(html).toContain('aria-label="切换底部面板"'); expect(html).toContain('aria-label="切换环境信息"');
  });

  it("exposes conversation action menus for standalone and project conversations", () => {
    const html = renderToStaticMarkup(<Sidebar workspace={{ standaloneThreads: [{ id: "standalone", title: "独立任务" }], projects: [{ id: "project", name: "Demo", path: "/tmp/demo", threads: [{ id: "project-thread", title: "项目任务" }] }] }} auth={{ connected: true }} expandedProjects={["project"]} activeThread={{ id: "project-thread", title: "项目任务", type: "project", projectId: "project" }} runningThreadIds={new Set(["standalone", "project-thread"])} onToggleProject={() => {}} onSelectProjectThread={() => {}} onSelectStandalone={() => {}} onAddProject={() => {}} onRemoveProject={() => {}} onOpenProjectPath={() => {}} onCopyProjectPath={() => {}} onNewProjectThread={() => {}} onNewStandalone={() => {}} onRenameThread={() => {}} onDeleteThread={() => {}} onOpenSettings={() => {}} />);
    expect(html).toContain("新建项目会话");
    expect(html).toContain('aria-label="会话操作 独立任务"');
    expect(html).toContain('aria-label="会话操作 项目任务"');
    expect(html).toContain('aria-label="项目任务 正在响应"');
    expect(html).not.toContain('aria-label="独立任务 正在响应"');
  });

  it("keeps project-only tools disabled without a project", () => {
    const html = renderToStaticMarkup(<ToolLauncher activeTool="" hasProject={false} onSelectTool={() => {}} />);
    expect(html).toContain('disabled=""'); expect(html).toContain("终端");
  });

  it("renders real environment information and sources", () => {
    const html = renderToStaticMarkup(<EnvironmentPanel hasProject gitState={{ branch: "main", files: [{ path: "src/a.ts", status: "M", plus: 4, minus: 2, untracked: false, staged: false, unstaged: true }] }} branches={["main", "feature"]} sources={["/tmp/design.png"]} busy={false} onOpenReview={() => {}} onOpenPath={() => {}} onSwitchBranch={() => {}} onCompareBranch={() => {}} onCommitPush={() => {}} onAddSource={() => {}} />);
    expect(html).toContain("环境信息"); expect(html).toContain("+4"); expect(html).toContain("−2"); expect(html).toContain("design.png");
  });

  it("shows staged and unstaged Git state", () => {
    const html = renderToStaticMarkup(<ReviewScreen gitState={{ branch: "main", files: [{ path: "src/a.ts", status: "MM", plus: 2, minus: 1, untracked: false, staged: true, unstaged: true }] }} branches={["main"]} selectedFile="src/a.ts" diff="diff" busy={false} onSelectFile={() => {}} onBack={() => {}} onSwitchBranch={() => {}} onCommitPush={() => {}} onStageAll={() => {}} onStageFile={() => {}} onDiscard={() => {}} />);
    expect(html).toContain("已暂存"); expect(html).toContain("未暂存");
  });

  it("renders branch comparisons without destructive working-tree actions", () => {
    const html = renderToStaticMarkup(<ReviewScreen comparisonBase="main" gitState={{ branch: "main…feature", files: [{ path: "src/a.ts", status: "M", plus: 2, minus: 1, untracked: false, staged: false, unstaged: false }] }} branches={["main", "feature"]} selectedFile="src/a.ts" diff="diff" busy={false} onSelectFile={() => {}} onBack={() => {}} onSwitchBranch={() => {}} onCommitPush={() => {}} onStageAll={() => {}} onStageFile={() => {}} onDiscard={() => {}} />);
    expect(html).toContain("分支比较"); expect(html).not.toContain("全部暂存");
  });

  it("renders the add-project decision dialog", () => {
    const html = renderToStaticMarkup(<AddProjectModal step="choose" defaultParent="/tmp" onClose={() => {}} onStep={() => {}} onComplete={async () => {}} onChooseDirectory={async () => null} />);
    expect(html).toContain("导入已有项目"); expect(html).toContain("新建项目"); expect(html).toContain('aria-pressed="true"');
  });

  it("renders an in-app rename dialog and a visible side-chat wait state", () => {
    const renameHtml = renderToStaticMarkup(<RenameThreadModal currentTitle="Task" onClose={() => {}} onSubmit={async () => {}} />);
    expect(renameHtml).toContain('role="dialog"'); expect(renameHtml).toContain("会话名称");
    const dockHtml = renderToStaticMarkup(<WorkspaceDock activeTool="chat" hasProject gitState={{ branch: "main", files: [] }} terminalProps={{ output: [], onInput: () => {}, onResize: () => {} }} remoteUrl="" projectFiles={[]} sideMessages={[{ id: "u", role: "user", text: "hello" }]} sideValue="" sideSending sideApproval={{ id: "approval", label: "执行命令" }} sideAgentLabel="Codex" onSelectTool={() => {}} onClose={() => {}} onOpenReview={() => {}} onOpenRemote={() => {}} onOpenFile={() => {}} onSideValue={() => {}} onSendSide={() => {}} onSideApproval={() => {}} onCancelSide={() => {}} />);
    expect(dockHtml).toContain("Codex 正在回复"); expect(dockHtml).toContain("执行命令需要批准"); expect(dockHtml).toContain('role="status"');
  });

  it("renders typed model and permission choices", () => {
    const settings = { provider: "codex" as const, serviceName: "Codex", model: "model-1", reasoning: "medium" as const, sandboxMode: "workspace-write" as const };
    const modelHtml = renderToStaticMarkup(<ModelPopover mode="models" settings={settings} auth={{ connected: true }} models={[{ id: "model-1", model: "model-1", displayName: "Model 1", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium" }] }]} loading={false} error="" onSelectModel={() => {}} onSelectReasoning={() => {}} />);
    const permissionHtml = renderToStaticMarkup(<PermissionPopover selectedValue="workspace-write" onSelect={() => {}} onLearnMore={() => {}} />);
    expect(modelHtml).toContain("Model 1"); expect(permissionHtml).toContain("完全访问权限");
  });

  it("does not present Pi approval mode as an available capability", () => {
    const html = renderToStaticMarkup(<PermissionPopover agentId="pi" selectedValue="read-only" onSelect={() => {}} onLearnMore={() => {}} />);
    expect(html).toContain("Pi RPC 暂不支持逐次审批");
    expect(html).toMatch(/disabled=""[^>]*aria-disabled="true"|aria-disabled="true"[^>]*disabled=""/);
  });
});
