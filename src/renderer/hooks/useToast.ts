import { useCallback, useEffect, useRef, useState } from "react";

/**
 * `error` is for actions that failed, `info` for hints about why an action was
 * blocked, `success` for everything that actually went through. The tone only
 * changes the icon and its color — the copy is the caller's job.
 */
export type ToastTone = "success" | "error" | "info";

export type Toast = { id: number; text: string; tone: ToastTone };

export type Notify = (message: string, tone?: ToastTone) => void;

/**
 * Toasts are queued rather than replaced: a burst of errors used to overwrite
 * the previous message before it could be read.
 */
export function useToast(): { toast: Toast | null; notify: Notify } {
  const [queue, setQueue] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const current = queue[0] ?? null;
  const notify = useCallback<Notify>((message, tone = "success") => {
    if (!message) return;
    // The id is assigned outside the updater so the updater stays pure under
    // StrictMode's double invocation.
    const entry: Toast = { id: nextId.current++, text: message, tone };
    setQueue((existing) => {
      const last = existing.at(-1);
      return last?.text === message && last.tone === tone ? existing : [...existing, entry].slice(-4);
    });
  }, []);
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => setQueue((existing) => existing.slice(1)), 3000);
    return () => window.clearTimeout(timer);
  }, [current]);
  return { toast: current, notify };
}
