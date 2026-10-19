import { useSyncExternalStore } from "react";
import { Button, IconButton, Modal } from "../ui";

export type ConfirmTone = "default" | "danger";

export type ConfirmOptions = {
  title: string;
  message?: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type PendingConfirm = ConfirmOptions & { id: number; resolve: (confirmed: boolean) => void };

// Confirmation is requested from hooks and event handlers, which cannot render
// a dialog themselves. A tiny module-level queue lets any caller await a real
// Rux dialog while a single host keeps the markup in the React tree.
let pending: PendingConfirm[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => pending[0] ?? null;
const getServerSnapshot = () => null;

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    pending = [...pending, { ...options, id: nextId++, resolve }];
    emit();
  });
}

function settle(confirmed: boolean) {
  const [head, ...rest] = pending;
  pending = rest;
  emit();
  head?.resolve(confirmed);
}

type DialogProps = ConfirmOptions & { onCancel: () => void; onConfirm: () => void };

export function ConfirmDialog({ title, message, detail, confirmLabel = "确认", cancelLabel = "取消", tone = "default", onCancel, onConfirm }: DialogProps) {
  const danger = tone === "danger";
  return <Modal label={title} onClose={onCancel} alert={danger} className="confirm-modal">
    <div className="modal-header">
      <div className="modal-title-row"><h2>{title}</h2><IconButton label="关闭" icon="close" className="modal-close" onClick={onCancel} /></div>
      {message && <p>{message}</p>}
    </div>
    {detail && <p className="confirm-detail" data-tone={danger ? "danger" : undefined}>{detail}</p>}
    <form onSubmit={(event) => { event.preventDefault(); onConfirm(); }}>
      <div className="modal-footer">
        <Button variant="secondary" type="button" onClick={onCancel} data-autofocus={danger || undefined}>{cancelLabel}</Button>
        <Button variant={danger ? "danger" : "primary"} type="submit" data-autofocus={danger ? undefined : true}>{confirmLabel}</Button>
      </div>
    </form>
  </Modal>;
}

export function ConfirmHost() {
  const request = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!request) return null;
  return <ConfirmDialog key={request.id} {...request} onCancel={() => settle(false)} onConfirm={() => settle(true)} />;
}
