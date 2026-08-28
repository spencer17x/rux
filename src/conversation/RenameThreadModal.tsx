import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import IconButton from "../components/IconButton";

type Props = { currentTitle: string; onClose: () => void; onSubmit: (title: string) => Promise<void> };

export default function RenameThreadModal({ currentTitle, onClose, onSubmit }: Props) {
  const [title, setTitle] = useState(currentTitle);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const backdrop = backdropRef.current;
    const siblings = backdrop?.parentElement ? [...backdrop.parentElement.children].filter((element) => element !== backdrop) as HTMLElement[] : [];
    for (const sibling of siblings) { sibling.inert = true; sibling.setAttribute("aria-hidden", "true"); }
    inputRef.current?.focus(); inputRef.current?.select();
    return () => { for (const sibling of siblings) { sibling.inert = false; sibling.removeAttribute("aria-hidden"); } requestAnimationFrame(() => previousFocus?.focus()); };
  }, []);
  const submit = async () => { if (!title.trim() || busy) return; setBusy(true); try { await onSubmit(title); } finally { setBusy(false); } };
  return <div ref={backdropRef} className="modal-backdrop" role="presentation">
    <section ref={dialogRef} className="modal rename-thread-modal" role="dialog" aria-modal="true" aria-labelledby="rename-thread-title" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); return; } if (event.key !== "Tab") return; const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") || [])]; const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }}>
      <div className="modal-header"><div className="modal-title-row"><h2 id="rename-thread-title">重命名会话</h2><IconButton label="关闭" className="modal-close" onClick={onClose}><X size={20} /></IconButton></div><p>输入一个便于识别的会话名称</p></div>
      <label className="field-label">会话名称<input ref={inputRef} value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }} /></label>
      <div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="button" className="primary-button" disabled={!title.trim() || busy} onClick={() => void submit()}>{busy ? "保存中…" : "保存"}</button></div>
    </section>
  </div>;
}
