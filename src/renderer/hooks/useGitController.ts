import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { RuxApi } from "../../electron/preload";
import type { GitState } from "../types";
import { userFacingError } from "../errors";

type View = "project" | "standalone" | "review" | "settings";
const emptyGitState = (): GitState => ({ branch: "—", files: [] });

export function useGitController(api: RuxApi, projectId: string | undefined, notify: (message: string) => void, setView: Dispatch<SetStateAction<View>>) {
  const [gitState, setGitState] = useState<GitState>(emptyGitState);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [diff, setDiff] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState("");
  const [comparisonBase, setComparisonBase] = useState("");
  const scope = useRef({ projectId, base: "", generation: 0 });
  const selectedFileRef = useRef("");
  const statusRequest = useRef(0);
  const diffRequest = useRef(0);
  const mutation = useRef(false);
  // Invalidate during render, before effects or any late responses can run.
  if (scope.current.projectId !== projectId) scope.current = { projectId, base: "", generation: scope.current.generation + 1 };

  const selectDiff = useCallback(async (path: string, targetProjectId = scope.current.projectId) => {
    const current = scope.current;
    if (!targetProjectId || current.projectId !== targetProjectId) return;
    const request = ++diffRequest.current;
    selectedFileRef.current = path;
    setSelectedFile(path);
    setDiff("");
    setDiffLoading(Boolean(path));
    if (!path) return;
    try {
      const next = current.base ? await api.git.compareDiff({ projectId: targetProjectId, baseBranch: current.base, path }) : await api.git.diff({ projectId: targetProjectId, path });
      if (scope.current === current && diffRequest.current === request) setDiff(next);
    } catch (error) {
      if (scope.current === current && diffRequest.current === request) setDiff(userFacingError(error));
    } finally {
      if (scope.current === current && diffRequest.current === request) setDiffLoading(false);
    }
  }, [api]);

  const refreshGit = useCallback(async (targetProjectId = scope.current.projectId, workingTreeOnly = false) => {
    if (!targetProjectId || targetProjectId !== scope.current.projectId) return;
    if (workingTreeOnly && scope.current.base) {
      scope.current = { ...scope.current, base: "" };
      setComparisonBase("");
    }
    const current = scope.current;
    const request = ++statusRequest.current;
    setLoading(true);
    setError("");
    try {
      const next = (current.base ? await api.git.compare({ projectId: targetProjectId, baseBranch: current.base }) : await api.git.status(targetProjectId)) as GitState;
      if (scope.current !== current || statusRequest.current !== request) return;
      setGitState(next);
      await selectDiff(next.files.find((file) => file.path === selectedFileRef.current)?.path || next.files[0]?.path || "", targetProjectId);
    } catch (error) {
      if (scope.current !== current || statusRequest.current !== request) return;
      setError(userFacingError(error));
      setGitState(emptyGitState());
      void selectDiff("", targetProjectId);
    } finally {
      if (scope.current === current && statusRequest.current === request) setLoading(false);
    }
  }, [api, selectDiff]);

  useEffect(() => {
    const current = scope.current;
    setGitState(emptyGitState()); setBranches([]); setSelectedFile(""); selectedFileRef.current = "";
    setDiff(""); setError(""); setComparisonBase(""); setDiffLoading(false); setLoading(false);
    if (!projectId) return;
    void refreshGit(projectId);
    api.git.branches(projectId).then((value) => { if (scope.current === current) setBranches(value as string[]); }).catch(() => {});
  }, [api, projectId, refreshGit]);

  const mutate = useCallback(async (action: (id: string) => Promise<unknown>, message: string) => {
    const current = scope.current;
    if (!current.projectId || current.base || mutation.current) return;
    mutation.current = true; setBusy(true);
    try {
      await action(current.projectId);
      if (scope.current !== current) return;
      notify(message);
      await refreshGit(current.projectId);
    } catch (error) { if (scope.current === current) notify(userFacingError(error)); }
    finally { mutation.current = false; setBusy(false); }
  }, [notify, refreshGit]);

  const switchBranch = useCallback(async (branch: string) => {
    if (!projectId || branch === gitState.branch || mutation.current) return;
    if (gitState.files.length && !window.confirm(`当前有 ${gitState.files.length} 个变更，仍要切换到 ${branch}？`)) return;
    await mutate((id) => api.git.switchBranch({ projectId: id, branch }), `已切换到 ${branch}`);
  }, [api, gitState, mutate, projectId]);

  const stage = useCallback(async (paths: string[]) => {
    if (paths.length) await mutate((id) => api.git.stage({ projectId: id, paths }), "已暂存所选文件");
  }, [api, mutate]);

  const discardSelected = useCallback(async () => {
    if (!selectedFile || !window.confirm(`确认放弃 ${selectedFile} 的未暂存修改？已暂存内容会保留，此操作不可撤销。`)) return;
    await mutate((id) => api.git.discard({ projectId: id, path: selectedFile }), "未暂存修改已恢复，暂存内容已保留");
  }, [api, mutate, selectedFile]);

  const commitOrPush = useCallback(async () => {
    const current = scope.current;
    if (!current.projectId || current.base || mutation.current) return;
    let rulesAcknowledged = false;
    try {
      const guidance = await api.git.instructions(current.projectId) as { files: Array<{ path: string; content: string }>; stagedPaths: string[] };
      if (scope.current !== current) return;
      if (guidance.files.length) {
        const summary = guidance.files.map((file) => `【${file.path}】\n${file.content.trim()}`).join("\n\n").slice(0, 6000);
        const staged = guidance.stagedPaths.length ? `\n\n适用的已暂存文件：\n${guidance.stagedPaths.map((path) => `• ${path}`).join("\n")}` : "";
        if (!window.confirm(`提交前请阅读并遵循以下项目规则：\n\n${summary}${staged}\n\n确认当前已暂存内容、提交信息和推送操作均符合这些规则？`)) return;
        rulesAcknowledged = true;
      }
    } catch (error) { notify(userFacingError(error)); return; }
    const message = window.prompt("输入提交信息；留空则仅推送当前分支", ""); if (message === null) return;
    const push = window.confirm(message.trim() ? "提交完成后是否推送到 origin？" : "确认推送当前分支到 origin？"); if (!message.trim() && !push) return;
    await mutate((id) => api.git.commitPush({ projectId: id, message, push, rulesAcknowledged }), push ? "Git 提交/推送已完成" : "Git 提交已完成");
  }, [api, mutate, notify]);

  const openReview = useCallback(async (path?: string) => {
    if (!scope.current.projectId) { notify("请先选择一个项目会话"); return; }
    if (typeof path === "string") selectedFileRef.current = path;
    setView("review");
    await refreshGit(scope.current.projectId, true);
  }, [notify, refreshGit, setView]);
  const compareBranch = useCallback(async (baseBranch: string) => {
    if (!scope.current.projectId || mutation.current) return;
    scope.current = { ...scope.current, base: baseBranch };
    setComparisonBase(baseBranch); setView("review"); setGitState(emptyGitState());
    await refreshGit();
  }, [refreshGit, setView]);
  const closeReview = useCallback(async () => {
    setView(scope.current.projectId ? "project" : "standalone");
    await refreshGit(scope.current.projectId, true);
  }, [refreshGit, setView]);
  return { gitState, branches, selectedFile, diff, busy, loading, diffLoading, error, comparisonBase, selectDiff, refreshGit, switchBranch, stage, discardSelected, commitOrPush, openReview, compareBranch, closeReview };
}
