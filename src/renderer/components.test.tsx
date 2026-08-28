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

describe("typed renderer components", () => {
  it("renders project context in the top bar", () => {
    const html = renderToStaticMarkup(<TopBar activeThread={{ id: "thread", title: "Task", type: "project", projectName: "Rux" }} bottomPanelOpen={false} rightPanelOpen onToggleBottomPanel={() => {}} onToggleRightPanel={() => {}} onOpenSettings={() => {}} onOpenPath={() => {}} onCopyPath={() => {}} onShare={() => {}} onRename={() => {}} onRemoveThread={() => {}} />);
    expect(html).toContain("Rux"); expect(html).toContain("Task");
    expect(html).toContain('data-panel-icon="bottom"'); expect(html).toContain('data-panel-icon="right"');
  });

  it("exposes conversation action menus for standalone and project conversations", () => {
    const html = renderToStaticMarkup(<Sidebar workspace={{ standaloneThreads: [{ id: "standalone", title: "独立任务" }], projects: [{ id: "project", name: "Demo", path: "/tmp/demo", threads: [{ id: "project-thread", title: "项目任务" }] }] }} auth={{ connected: true }} expandedProjects={["project"]} activeThread={{ id: "project-thread", title: "项目任务", type: "project", projectId: "project" }} onToggleProject={() => {}} onSelectProjectThread={() => {}} onSelectStandalone={() => {}} onAddProject={() => {}} onRemoveProject={() => {}} onOpenProjectPath={() => {}} onCopyProjectPath={() => {}} onNewProjectThread={() => {}} onNewStandalone={() => {}} onRenameThread={() => {}} onDeleteThread={() => {}} onOpenSettings={() => {}} />);
    expect(html).toContain("新建项目会话");
    expect(html).toContain('aria-label="会话操作 独立任务"');
    expect(html).toContain('aria-label="会话操作 项目任务"');
  });

  it("keeps project-only tools disabled without a project", () => {
    const html = renderToStaticMarkup(<ToolLauncher activeTool="" hasProject={false} onSelectTool={() => {}} />);
    expect(html).toContain('disabled=""'); expect(html).toContain("终端");
  });

  it("shows staged and unstaged Git state", () => {
    const html = renderToStaticMarkup(<ReviewScreen gitState={{ branch: "main", files: [{ path: "src/a.ts", status: "MM", plus: 2, minus: 1, untracked: false, staged: true, unstaged: true }] }} branches={["main"]} selectedFile="src/a.ts" diff="diff" busy={false} onSelectFile={() => {}} onBack={() => {}} onSwitchBranch={() => {}} onCommitPush={() => {}} onStageAll={() => {}} onStageFile={() => {}} onDiscard={() => {}} />);
    expect(html).toContain("已暂存"); expect(html).toContain("未暂存");
  });

  it("renders the add-project decision dialog", () => {
    const html = renderToStaticMarkup(<AddProjectModal step="choose" defaultParent="/tmp" onClose={() => {}} onStep={() => {}} onComplete={async () => {}} onChooseDirectory={async () => null} />);
    expect(html).toContain("导入已有项目"); expect(html).toContain("新建项目"); expect(html).toContain('aria-pressed="true"');
  });

  it("renders an in-app rename dialog and a visible side-chat wait state", () => {
    const renameHtml = renderToStaticMarkup(<RenameThreadModal currentTitle="Task" onClose={() => {}} onSubmit={async () => {}} />);
    expect(renameHtml).toContain('role="dialog"'); expect(renameHtml).toContain("会话名称");
    const dockHtml = renderToStaticMarkup(<WorkspaceDock activeTool="chat" hasProject gitState={{ branch: "main", files: [] }} terminalProps={{ output: [], onInput: () => {}, onResize: () => {} }} remoteUrl="" projectFiles={[]} sideMessages={[{ id: "u", role: "user", text: "hello" }]} sideValue="" sideSending onSelectTool={() => {}} onClose={() => {}} onOpenReview={() => {}} onOpenRemote={() => {}} onOpenFile={() => {}} onSideValue={() => {}} onSendSide={() => {}} />);
    expect(dockHtml).toContain("Rux 正在回复"); expect(dockHtml).toContain('role="status"');
  });

  it("renders typed model and permission choices", () => {
    const settings = { provider: "codex" as const, serviceName: "Codex", model: "model-1", reasoning: "medium" as const, sandboxMode: "workspace-write" as const };
    const modelHtml = renderToStaticMarkup(<ModelPopover mode="models" settings={settings} auth={{ connected: true }} models={[{ id: "model-1", model: "model-1", displayName: "Model 1", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium" }] }]} loading={false} error="" onSelectModel={() => {}} onSelectReasoning={() => {}} />);
    const permissionHtml = renderToStaticMarkup(<PermissionPopover selectedValue="workspace-write" onSelect={() => {}} onLearnMore={() => {}} />);
    expect(modelHtml).toContain("Model 1"); expect(permissionHtml).toContain("完全访问权限");
  });
});
