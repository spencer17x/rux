import { useCallback, useEffect, useState } from "react";

/**
 * Toasts are queued rather than replaced: a burst of errors used to overwrite
 * the previous message before it could be read.
 */
export function useToast(): { toast: string; notify: (message: string) => void } {
  const [queue, setQueue] = useState<string[]>([]);
  const current = queue[0] ?? "";
  const notify = useCallback((message: string) => {
    if (!message) return;
    setQueue((existing) => existing.at(-1) === message ? existing : [...existing, message].slice(-4));
  }, []);
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => setQueue((existing) => existing.slice(1)), 3000);
    return () => window.clearTimeout(timer);
  }, [current]);
  return { toast: current, notify };
}
