import { useMemo, useRef, useState } from "react";
import { Button, Checkbox, IconButton, Modal, Switch, Textarea } from "../ui";
import { File, GitBranch, WarningCircle } from "../ui/icons";
import type { CommitRequest } from "../renderer/hooks/useGitController";

type Props = {
  request: CommitRequest;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (input: { message: string; push: boolean; rulesAcknowledged: boolean }) => Promise<void>;
};

const RULE_PREVIEW_LIMIT = 8_000;

export default function CommitModal({ request, busy, error, onCancel, onSubmit }: Props) {
  const [message, setMessage] = useState("");
  const [push, setPush] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const rules = useMemo(() => request.rules.map((rule) => ({
    path: rule.path,
    content: rule.content.slice(0, RULE_PREVIEW_LIMIT).trim(),
    truncated: rule.content.length > RULE_PREVIEW_LIMIT,
  })), [request.rules]);

  const hasStagedFiles = request.stagedPaths.length > 0;
  const canCommit = Boolean(message.trim());
  const canPush = push && request.hasRemote;
  const blockedByStaging = canCommit && !hasStagedFiles;
  const needsRules = rules.length > 0;
  const missingAcknowledgement = needsRules && !acknowledged;
  const canSubmit = !busy && (canCommit || canPush) && !blockedByStaging && !missingAcknowledgement;

  const submit = async () => { if (!canSubmit) return; await onSubmit({ message, push, rulesAcknowledged: needsRules ? acknowledged : true }); };
  const submitLabel = busy ? "正在提交…" : canCommit && canPush ? "提交并推送" : canPush ? "推送" : "提交";

  return <Modal label="提交或推送" onClose={onCancel} busy={busy} initialFocusRef={messageRef} className="commit-modal">
    <div className="modal-header">
      <div className="modal-title-row"><h2>提交或推送</h2><IconButton label="关闭" icon="close" className="modal-close" disabled={busy} onClick={onCancel} /></div>
      <p><GitBranch size="sm" />当前分支 <strong>{request.branch || "—"}</strong> · {hasStagedFiles ? `${request.stagedPaths.length} 个文件已暂存` : "没有已暂存的文件"}</p>
    </div>

    {hasStagedFiles && <div className="commit-staged" aria-label="已暂存的文件">
      {request.stagedPaths.map((path) => <span key={path}><File size="xs" />{path}</span>)}
    </div>}

    {rules.length > 0 && <section className="commit-rules" aria-label="项目规则">
      <div className="commit-rules-heading"><strong>提交前请阅读项目规则</strong><small>{rules.length} 个文件 · 适用本次提交</small></div>
      <div className="commit-rules-body" tabIndex={0} role="group" aria-label="项目规则内容">
        {rules.map((rule) => <article key={rule.path}>
          <h3>{rule.path}</h3>
          <pre>{rule.content}</pre>
          {rule.truncated && <p className="commit-hint">内容过长，仅显示前 {RULE_PREVIEW_LIMIT} 个字符。</p>}
        </article>)}
      </div>
      <label className="commit-acknowledge"><Checkbox aria-label="我已阅读并遵循项目规则" checked={acknowledged} onCheckedChange={(checked) => setAcknowledged(checked === true)} disabled={busy} /><span>我已阅读并遵循以上项目规则</span></label>
    </section>}

    <label className="field-label commit-message">提交信息<Textarea ref={messageRef} rows={3} maxLength={20_000} value={message} disabled={busy} placeholder="feat: 描述本次改动" onChange={(event) => setMessage(event.target.value)} /></label>
    {blockedByStaging && <p className="commit-hint is-warning" role="status"><WarningCircle size="sm" />没有已暂存的文件，请先在审查页暂存要提交的内容；留空提交信息可只推送当前分支。</p>}

    <div className="commit-push-row">
      <span><strong>推送到 origin</strong><small>{request.hasRemote ? "提交完成后把当前分支推送到远程仓库" : "当前项目没有 origin 远程仓库"}</small></span>
      <Switch aria-label="推送到 origin" checked={push} disabled={busy || !request.hasRemote} onCheckedChange={setPush} />
    </div>

    {error && <p className="commit-hint is-error" role="alert">{error}</p>}

    <div className="modal-footer">
      <Button variant="secondary" disabled={busy} onClick={onCancel}>取消</Button>
      <Button variant="primary" loading={busy} disabled={!canSubmit} onClick={() => void submit()}>{submitLabel}</Button>
    </div>
  </Modal>;
}
