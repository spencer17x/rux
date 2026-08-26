import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TopBar from "../navigation/TopBar";
import AddProjectModal from "../projects/AddProjectModal";
import ReviewScreen from "../workspace/ReviewScreen";
import ToolLauncher from "../workspace/ToolLauncher";
import { ModelPopover, PermissionPopover } from "../composer/ComposerControls";

describe("typed renderer components", () => {
  it("renders project context in the top bar", () => {
    const html = renderToStaticMarkup(<TopBar activeThread={{ id: "thread", title: "Task", type: "project", projectName: "Rux" }} bottomPanelOpen={false} rightPanelOpen onToggleBottomPanel={() => {}} onToggleRightPanel={() => {}} onOpenSettings={() => {}} onOpenPath={() => {}} onCopyPath={() => {}} onShare={() => {}} onRename={() => {}} onRemoveThread={() => {}} />);
    expect(html).toContain("Rux"); expect(html).toContain("Task");
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
    expect(html).toContain("导入已有项目"); expect(html).toContain("新建项目");
  });

  it("renders typed model and permission choices", () => {
    const settings = { provider: "codex" as const, serviceName: "Codex", model: "model-1", reasoning: "medium" as const, sandboxMode: "workspace-write" as const };
    const modelHtml = renderToStaticMarkup(<ModelPopover mode="models" settings={settings} auth={{ connected: true }} models={[{ id: "model-1", model: "model-1", displayName: "Model 1", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium" }] }]} loading={false} error="" onSelectModel={() => {}} onSelectReasoning={() => {}} />);
    const permissionHtml = renderToStaticMarkup(<PermissionPopover selectedValue="workspace-write" onSelect={() => {}} onLearnMore={() => {}} />);
    expect(modelHtml).toContain("Model 1"); expect(permissionHtml).toContain("完全访问权限");
  });
});
