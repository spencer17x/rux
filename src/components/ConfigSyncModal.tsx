import { useState } from "react";
import { Button, Modal } from "../ui";
import type { ConfigSyncStatus } from "../electron/agent-config-sync";
import { userFacingError } from "../renderer/errors";

export type ConfigSyncDecision = "import" | "later" | "never-ask";

export default function ConfigSyncModal({ agentName, status, onDecision }: {
  agentName: string;
  status: ConfigSyncStatus;
  onDecision: (decision: ConfigSyncDecision) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const decide = async (decision: ConfigSyncDecision) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await onDecision(decision); }
    catch (cause) { setError(userFacingError(cause)); }
    finally { setBusy(false); }
  };
  return <Modal label="同步 Agent 配置" onClose={() => void decide("later")} busy={busy} className="config-sync-modal">
    <div className="modal-header"><h2>同步 {agentName} 配置？</h2><p>检测到外部配置有更新。选择导入后，Rux 会使用这些文件的副本。</p></div>
    <div className="config-sync-source"><span>来源</span><code>{status.sourceRoot}</code></div>
    <ul className="config-sync-files">{status.files.map((file) => <li key={file.name}>{file.name}</li>)}</ul>
    <p className="config-sync-note">登录凭据不会随此次配置导入。</p>
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="modal-footer"><Button variant="plain" disabled={busy} onClick={() => void decide("never-ask")}>不再询问</Button><Button variant="secondary" disabled={busy} onClick={() => void decide("later")}>暂不导入</Button><Button variant="primary" loading={busy} onClick={() => void decide("import")}>导入配置</Button></div>
  </Modal>;
}
