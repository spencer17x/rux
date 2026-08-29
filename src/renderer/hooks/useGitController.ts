import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { RuxApi } from "../../electron/preload";
import type { GitState } from "../types";

type View = "project" | "standalone" | "review" | "settings";

export function useGitController(api: RuxApi, projectId: string | undefined, notify: (message: string) => void, setView: Dispatch<SetStateAction<View>>) {
  const [gitState, setGitState] = useState<GitState>({ branch: "—", files: [] });
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [diff, setDiff] = useState("");
  const [busy, setBusy] = useState(false);
  const selectDiff = useCallback(async (path: string, targetProjectId = projectId) => {
    if (!targetProjectId) return;
    setSelectedFile(path); setDiff("加载中…");
    try { setDiff(await api.git.diff({ projectId: targetProjectId, path })); }
    catch (error) { setDiff(error instanceof Error ? error.message : String(error)); }
  }, [api, projectId]);
  const refreshGit = useCallback(async (targetProjectId = projectId) => {
    if (!targetProjectId) return;
    try {
      const status = await api.git.status(targetProjectId) as GitState;
      setGitState(status);
      if (status.files.length && !status.files.some((file) => file.path === selectedFile)) await selectDiff(status.files[0].path, targetProjectId);
      if (!status.files.length) { setSelectedFile(""); setDiff(""); }
    } catch (error) {
      setGitState({ branch: "—", files: [] }); notify(error instanceof Error ? error.message : String(error));
    }
  }, [api, notify, projectId, selectDiff, selectedFile]);
  useEffect(() => {
    if (!projectId) { setGitState({ branch: "—", files: [] }); setBranches([]); setSelectedFile(""); setDiff(""); return; }
    void refreshGit(projectId);
    api.git.branches(projectId).then((value) => setBranches(value as string[])).catch(() => setBranches([]));
  }, [api, projectId, refreshGit]);
  const switchBranch = useCallback(async (branch: string) => {
    if (!projectId || branch === gitState.branch) return;
    if (gitState.files.length && !window.confirm(`当前有 ${gitState.files.length} 个变更，仍要切换到 ${branch}？`)) return;
    try { setGitState(await api.git.switchBranch({ projectId, branch }) as GitState); notify(`已切换到 ${branch}`); }
    catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [api, gitState, notify, projectId]);
  const stage = useCallback(async (paths: string[]) => {
    if (!projectId || !paths.length) return;
    setBusy(true);
    try { const status = await api.git.stage({ projectId, paths }) as GitState; setGitState(status); notify("已暂存所选文件"); if (!status.files.length) setView("project"); }
    catch (error) { notify(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }, [api, notify, projectId, setView]);
  const discardSelected = useCallback(async () => {
    if (!projectId || !selectedFile || !window.confirm(`确认放弃 ${selectedFile} 的未暂存修改？已暂存内容会保留，此操作不可撤销。`)) return;
    setBusy(true);
    try { const status = await api.git.discard({ projectId, path: selectedFile }) as GitState; setGitState(status); notify("未暂存修改已恢复，暂存内容已保留"); if (status.files.length) await selectDiff(status.files[0].path, projectId); else setView("project"); }
    catch (error) { notify(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }, [api, notify, projectId, selectDiff, selectedFile, setView]);
  const commitOrPush = useCallback(async () => {
    if (!projectId) return;
    let rulesAcknowledged = false;
    try {
      const guidance = await api.git.instructions(projectId) as { files: Array<{ path: string; content: string }>; stagedPaths: string[] };
      if (guidance.files.length) {
        const summary = guidance.files.map((file) => `【${file.path}】\n${file.content.trim()}`).join("\n\n").slice(0, 6000);
        const staged = guidance.stagedPaths.length ? `\n\n适用的已暂存文件：\n${guidance.stagedPaths.map((path) => `• ${path}`).join("\n")}` : "";
        if (!window.confirm(`提交前请阅读并遵循以下项目规则：\n\n${summary}${staged}\n\n确认当前已暂存内容、提交信息和推送操作均符合这些规则？`)) return;
        rulesAcknowledged = true;
      }
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); return; }
    const message = window.prompt("输入提交信息；留空则仅推送当前分支", ""); if (message === null) return;
    const push = window.confirm(message.trim() ? "提交完成后是否推送到 origin？" : "确认推送当前分支到 origin？"); if (!message.trim() && !push) return;
    setBusy(true);
    try { setGitState(await api.git.commitPush({ projectId, message, push, rulesAcknowledged }) as GitState); notify(push ? "Git 提交/推送已完成" : "Git 提交已完成"); }
    catch (error) { notify(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }, [api, notify, projectId]);
  const openReview = useCallback(async () => { if (projectId) await refreshGit(projectId); setView("review"); }, [projectId, refreshGit, setView]);
  return { gitState, branches, selectedFile, diff, busy, selectDiff, refreshGit, switchBranch, stage, discardSelected, commitOrPush, openReview };
}
