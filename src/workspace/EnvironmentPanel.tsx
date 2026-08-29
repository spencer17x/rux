import { useState } from "react";
import { ArrowSquareOut, CaretDown, File, FileText, GitBranch, GitCommit, GithubLogo, HardDrive, ListBullets, Paperclip, Plus } from "@phosphor-icons/react";
import type { GitState } from "../renderer/types";
import IconButton from "../components/IconButton";

type Props = {
  hasProject: boolean;
  gitState: GitState;
  branches: string[];
  sources: string[];
  busy: boolean;
  onOpenReview: () => void;
  onOpenPath: () => void;
  onSwitchBranch: (branch: string) => void;
  onCommitPush: () => void;
  onAddSource: () => void;
};

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export default function EnvironmentPanel(props: Props) {
  const [branchOpen, setBranchOpen] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const plus = props.gitState.files.reduce((total, file) => total + file.plus, 0);
  const minus = props.gitState.files.reduce((total, file) => total + file.minus, 0);
  const visibleSources = showAllSources ? props.sources : props.sources.slice(0, 3);
  const disabled = !props.hasProject;
  return <aside className="environment-panel" aria-label="环境信息">
    <div className="panel-heading"><span>环境信息</span><IconButton label="添加来源" onClick={props.onAddSource}><Plus size={17} /></IconButton></div>
    <button type="button" className="environment-row" disabled={disabled} onClick={props.onOpenReview}><FileText size={18} /><span>变更</span><span className="change-count"><b>+{plus}</b> <em>−{minus}</em></span></button>
    <button type="button" className="environment-row" disabled={disabled} onClick={props.onOpenPath}><HardDrive size={18} /><span>本地</span><CaretDown className="row-end" size={15} /></button>
    <div className="environment-menu-wrap"><button type="button" className="environment-row" disabled={disabled || props.gitState.branch === "—"} aria-expanded={branchOpen} onClick={() => setBranchOpen((open) => !open)}><GitBranch size={18} /><span>{props.gitState.branch || "—"}</span><CaretDown className="row-end" size={15} /></button>{branchOpen && <div className="branch-popover" role="menu">{props.branches.length ? props.branches.map((branch) => <button type="button" role="menuitem" className={branch === props.gitState.branch ? "is-selected" : ""} key={branch} onClick={() => { setBranchOpen(false); props.onSwitchBranch(branch); }}>{branch}</button>) : <span>没有可切换的本地分支</span>}</div>}</div>
    <button type="button" className={`environment-row ${disabled || props.gitState.branch === "—" ? "is-disabled" : ""}`} disabled={disabled || props.gitState.branch === "—" || props.busy} onClick={props.onCommitPush}><GitCommit size={18} /><span>提交或推送</span></button>
    <button type="button" className="environment-row" disabled={disabled} onClick={props.onOpenReview}><GithubLogo size={18} /><span>比较分支</span><ArrowSquareOut className="row-end" size={15} /></button>
    <div className="environment-divider" />
    <div className="panel-heading environment-sources-heading"><span>来源</span><IconButton label="添加来源文件" onClick={props.onAddSource}><Plus size={17} /></IconButton></div>
    <div className="environment-sources">{visibleSources.length ? visibleSources.map((path) => <div className="environment-source" title={path} key={path}><span className="source-file-icon">{/\.(png|jpe?g|gif|webp)$/i.test(path) ? <File size={16} /> : <Paperclip size={16} />}</span><span>{fileName(path)}</span></div>) : <div className="environment-source-empty"><ListBullets size={16} /><span>本次会话暂无来源文件</span></div>}</div>
    {props.sources.length > 3 && <button type="button" className="environment-show-all" onClick={() => setShowAllSources((show) => !show)}><ListBullets size={16} />{showAllSources ? "收起来源" : `查看全部 ${props.sources.length} 项`}</button>}
  </aside>;
}
