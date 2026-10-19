import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TopBar from "../navigation/TopBar";
import Sidebar from "../navigation/Sidebar";
import RenameThreadModal from "../conversation/RenameThreadModal";
import AddProjectModal from "../projects/AddProjectModal";
import ReviewScreen from "../workspace/ReviewScreen";
import CommitModal from "../workspace/CommitModal";
import ToolLauncher from "../workspace/ToolLauncher";
import { ModelPopover, PermissionPopover } from "../composer/ComposerControls";
import WorkspaceDock from "../workspace/WorkspaceDock";
import EnvironmentPanel from "../workspace/EnvironmentPanel";
import { ConfirmDialog } from "./ConfirmDialog";

describe("typed renderer components", () => {
  it("renders project context in the top bar", () => {
    const html = renderToStaticMarkup(<TopBar activeThread={{ id: "thread", title: "Task", type: "project", projectName: "Rux" }} leftPanelOpen={false} bottomPanelOpen={false} rightPanelOpen onToggleLeftPanel={() => {}} onToggleBottomPanel={() => {}} onToggleRightPanel={() => {}} onOpenSettings={() => {}} onOpenPath={() => {}} onCopyPath={() => {}} onShare={() => {}} onRename={() => {}} onRemoveThread={() => {}} />);
    expect(html).toContain("Rux"); expect(html).toContain("Task");
    expect(html).toContain('aria-label="切换左侧面板"'); expect(html).toContain('aria-label="切换底部面板"'); expect(html).toContain('aria-label="切换右侧面板"');
    expect(html.indexOf('aria-label="切换左侧面板"')).toBeLessThan(html.indexOf('aria-label="切换底部面板"'));
    expect(html.indexOf('aria-label="切换底部面板"')).toBeLessThan(html.indexOf('aria-label="切换右侧面板"'));
  });

  it("exposes conversation action menus for standalone and project conversations", () => {
    const html = renderToStaticMarkup(<Sidebar workspace={{ standaloneThreads: [{ id: "standalone", title: "独立任务" }], projects: [{ id: "project", name: "Demo", path: "/tmp/demo", threads: [{ id: "project-thread", title: "项目任务" }] }] }} auth={{ connected: true }} expandedProjects={["project"]} activeThread={{ id: "project-thread", title: "项目任务", type: "project", projectId: "project" }} runningThreadIds={new Set(["standalone", "project-thread"])} onToggleProject={() => {}} onSelectProjectThread={() => {}} onSelectStandalone={() => {}} onAddProject={() => {}} onRemoveProject={() => {}} onOpenProjectPath={() => {}} onCopyProjectPath={() => {}} onNewProjectThread={() => {}} onNewStandalone={() => {}} onRenameThread={() => {}} onDeleteThread={() => {}} onOpenSettings={() => {}} />);
    expect(html).toContain("新建项目会话");
    expect(html).toContain('aria-label="会话操作 独立任务"');
    expect(html).toContain('aria-label="会话操作 项目任务"');
    expect(html).toContain('aria-label="项目任务 正在响应"');
    expect(html).toContain('aria-label="独立任务 正在响应"');
  });

  it("guides first-time users when the sidebar has no project", () => {
    const html = renderToStaticMarkup(<Sidebar workspace={{ standaloneThreads: [], projects: [] }} auth={{ connected: false }} expandedProjects={[]} activeThread={null} runningThreadIds={new Set()} onToggleProject={() => {}} onSelectProjectThread={() => {}} onSelectStandalone={() => {}} onAddProject={() => {}} onRemoveProject={() => {}} onOpenProjectPath={() => {}} onCopyProjectPath={() => {}} onNewProjectThread={() => {}} onNewStandalone={() => {}} onRenameThread={() => {}} onDeleteThread={() => {}} onOpenSettings={() => {}} />);
    expect(html).toContain("还没有项目");
    expect(html).toContain("添加本地项目后");
    expect(html).not.toContain("未找到匹配的项目或会话");
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
    const rightDockHtml = renderToStaticMarkup(<WorkspaceDock placement="right" activeTool="environment" environmentContent={<div>共享环境内容</div>} hasProject gitState={{ branch: "main", files: [] }} terminalProps={{ output: [], onInput: () => {}, onResize: () => {} }} remoteUrl="" projectFiles={[]} sideMessages={[]} sideValue="" sideSending={false} sideApproval={null} sideAgentLabel="Codex" onSelectTool={() => {}} onClose={() => {}} onOpenReview={() => {}} onOpenRemote={() => {}} onOpenFile={() => {}} onSideValue={() => {}} onSendSide={() => {}} onSideApproval={() => {}} onCancelSide={() => {}} />);
    expect(rightDockHtml).toContain('aria-label="右侧工作区面板"'); expect(rightDockHtml).toContain('aria-label="关闭右侧面板"'); expect(rightDockHtml).toContain("共享环境内容"); expect(rightDockHtml).toContain('aria-label="终端"'); expect(rightDockHtml).toContain('aria-label="侧边聊天"');
  });

  it("renders typed model and permission choices", () => {
    const settings = { provider: "codex" as const, serviceName: "Codex", model: "model-1", reasoning: "medium" as const, sandboxMode: "workspace-write" as const };
    const modelHtml = renderToStaticMarkup(<ModelPopover settings={settings} auth={{ connected: true }} models={[{ id: "model-1", model: "model-1", displayName: "GPT-5.6 Sol", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium" }], serviceTiers: [{ id: "priority", name: "Fast", description: "1.5x speed" }] }]} loading={false} error="" serviceTier={null} onSelectModel={() => {}} onSelectReasoning={() => {}} onSelectServiceTier={() => {}} />);
    const permissionHtml = renderToStaticMarkup(<PermissionPopover selectedValue="workspace-write" onSelect={() => {}} onLearnMore={() => {}} />);
    expect(modelHtml).toContain("5.6 Sol"); expect(modelHtml).toContain("推理强度"); expect(modelHtml).toContain("速度"); expect(modelHtml).not.toContain('role="menuitemradio"'); expect(permissionHtml).toContain("完全访问权限");
  });

  it("does not present Pi approval mode as an available capability", () => {
    const html = renderToStaticMarkup(<PermissionPopover agentId="pi" selectedValue="read-only" onSelect={() => {}} onLearnMore={() => {}} />);
    expect(html).toContain("Pi RPC 暂不支持逐次审批");
    expect(html).toMatch(/disabled=""[^>]*aria-disabled="true"|aria-disabled="true"[^>]*disabled=""/);
  });

  it("renders the commit dialog with rules, staged files and a blocked submit", () => {
    const html = renderToStaticMarkup(<CommitModal request={{ projectId: "project", branch: "main", stagedPaths: ["src/a.ts"], rules: [{ path: "AGENTS.md", content: "Use conventional commit messages." }], hasRemote: false }} busy={false} error="" onCancel={() => {}} onSubmit={async () => {}} />);
    expect(html).toContain("提交或推送");
    expect(html).toContain("src/a.ts");
    expect(html).toContain("AGENTS.md");
    expect(html).toContain("Use conventional commit messages.");
    expect(html).toContain("我已阅读并遵循以上项目规则");
    expect(html).toContain("当前项目没有 origin 远程仓库");
    expect(html).toContain('disabled=""');
  });

  it("surfaces a rejected commit inside the commit dialog", () => {
    const html = renderToStaticMarkup(<CommitModal request={{ projectId: "project", branch: "main", stagedPaths: [], rules: [], hasRemote: true }} busy={false} error="没有已暂存的变更，请先在审查页暂存文件" onCancel={() => {}} onSubmit={async () => {}} />);
    expect(html).toContain("没有已暂存的文件");
    expect(html).toContain('role="alert"');
    expect(html).toContain("没有已暂存的变更");
  });

  it("renders destructive confirmations as alert dialogs with cancel focused", () => {
    const html = renderToStaticMarkup(<ConfirmDialog title="删除会话" message="“Task”将从 Rux 中删除。" detail="这会删除会话记录及其底层 Agent 数据，此操作不可撤销。" confirmLabel="删除会话" tone="danger" onCancel={() => {}} onConfirm={() => {}} />);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("删除会话");
    expect(html).toContain("此操作不可撤销");
    expect(html).toMatch(/data-autofocus[^>]*>取消</);
    expect(html).not.toMatch(/data-autofocus[^>]*>删除会话</);
  });

  it("keeps the safe action secondary in non-destructive confirmations", () => {
    const html = renderToStaticMarkup(<ConfirmDialog title="切换分支" message="当前有 2 个未提交的变更。" confirmLabel="切换分支" onCancel={() => {}} onConfirm={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("切换分支");
    expect(html).not.toContain("此操作不可撤销");
    expect(html).toMatch(/data-autofocus[^>]*>切换分支</);
  });
});
