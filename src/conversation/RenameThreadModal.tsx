import { useRef, useState } from "react";
import { Button, IconButton, Input, Modal } from "../ui";

type Props = { currentTitle: string; onClose: () => void; onSubmit: (title: string) => Promise<void> };

export default function RenameThreadModal({ currentTitle, onClose, onSubmit }: Props) {
  const [title, setTitle] = useState(currentTitle);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = async () => { if (!title.trim() || busy) return; setBusy(true); try { await onSubmit(title); } finally { setBusy(false); } };
  return <Modal label="重命名会话" onClose={onClose} busy={busy} initialFocusRef={inputRef} className="rename-thread-modal">
    <div className="modal-header"><div className="modal-title-row"><h2>重命名会话</h2><IconButton label="关闭" icon="close" className="modal-close" disabled={busy} onClick={onClose} /></div><p>输入一个便于识别的会话名称</p></div>
    <label className="field-label">会话名称<Input ref={inputRef} value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }} /></label>
    <div className="modal-footer"><Button variant="secondary" disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" loading={busy} disabled={!title.trim()} onClick={() => void submit()}>{busy ? "保存中…" : "保存"}</Button></div>
  </Modal>;
}
