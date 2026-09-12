import { Button, Menu, MenuItem } from "../ui";
import { useState } from "react";
import { CaretDown, File, FileText, GitBranch, GitCommit, GithubLogo, HardDrive, ListBullets, Paperclip, Plus } from "../ui/icons";
import type { GitState } from "../renderer/types";
import IconButton from "../components/IconButton";

type Props = {
  hasProject: boolean;
  gitState: GitState;
  branches: string[];
  sources: string[];
  busy: boolean;
  readOnly?: boolean;
  onOpenReview: () => void;
  onOpenPath: () => void;
  onSwitchBranch: (branch: string) => void;
  onCompareBranch: (branch: string) => void;
  onCommitPush: () => void;
  onAddSource: () => void;
};

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export default function EnvironmentPanel(props: Props) {
  const [branchOpen, setBranchOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const plus = props.gitState.files.reduce((total, file) => total + file.plus, 0);
  const minus = props.gitState.files.reduce((total, file) => total + file.minus, 0);
  const visibleSources = showAllSources ? props.sources : props.sources.slice(0, 3);
  const disabled = !props.hasProject;
  return <aside className="environment-panel" aria-label="环境信息">
    <div className="panel-heading"><span>环境信息</span><IconButton label="添加来源" onClick={props.onAddSource}><Plus size="sm" /></IconButton></div>
    <Button variant="plain" type="button" className="environment-row" disabled={disabled} onClick={props.onOpenReview}><FileText size="md" /><span>变更</span><span className="change-count"><b>+{plus}</b> <em>−{minus}</em></span></Button>
    <Button variant="plain" type="button" className="environment-row" disabled={disabled} onClick={props.onOpenPath}><HardDrive size="md" /><span>本地</span><CaretDown className="row-end" size="sm" /></Button>
    <Menu label="切换分支" open={branchOpen} onOpenChange={(open) => { setBranchOpen(open); if (open) setCompareOpen(false); }} align="start" trigger={<Button variant="plain" className="environment-row" disabled={disabled || props.busy || props.readOnly || props.gitState.branch === "—"}><GitBranch /><span>{props.gitState.branch || "—"}</span><CaretDown className="row-end" size="xs" /></Button>}>{props.branches.length ? props.branches.map((branch) => <MenuItem key={branch} onSelect={() => props.onSwitchBranch(branch)}>{branch}</MenuItem>) : <MenuItem disabled>没有可切换的本地分支</MenuItem>}</Menu>
    <Button variant="plain" type="button" className={`environment-row ${disabled || props.gitState.branch === "—" ? "is-disabled" : ""}`} disabled={disabled || props.gitState.branch === "—" || props.busy || props.readOnly} onClick={props.onCommitPush}><GitCommit size="md" /><span>提交或推送</span></Button>
    <Menu label="比较分支" open={compareOpen} onOpenChange={(open) => { setCompareOpen(open); if (open) setBranchOpen(false); }} align="start" trigger={<Button variant="plain" className="environment-row" disabled={disabled || props.gitState.branch === "—" || props.branches.filter((branch) => branch !== props.gitState.branch).length === 0}><GithubLogo /><span>比较分支</span><CaretDown className="row-end" size="xs" /></Button>}>{props.branches.filter((branch) => branch !== props.gitState.branch).map((branch) => <MenuItem key={branch} onSelect={() => props.onCompareBranch(branch)}>{branch}</MenuItem>)}</Menu>
    <div className="environment-divider" />
    <div className="panel-heading environment-sources-heading"><span>来源</span><IconButton label="添加来源文件" onClick={props.onAddSource}><Plus size="sm" /></IconButton></div>
    <div className="environment-sources">{visibleSources.length ? visibleSources.map((path) => <div className="environment-source" title={path} key={path}><span className="source-file-icon">{/\.(png|jpe?g|gif|webp)$/i.test(path) ? <File size="sm" /> : <Paperclip size="sm" />}</span><span>{fileName(path)}</span></div>) : <div className="environment-source-empty"><ListBullets size="sm" /><span>本次会话暂无来源文件</span></div>}</div>
    {props.sources.length > 3 && <Button variant="plain" type="button" className="environment-show-all" onClick={() => setShowAllSources((show) => !show)}><ListBullets size="sm" />{showAllSources ? "收起来源" : `查看全部 ${props.sources.length} 项`}</Button>}
  </aside>;
}
