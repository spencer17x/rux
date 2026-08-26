import { useCallback, useEffect, useRef, useState } from "react";

export function useToast(): { toast: string; notify: (message: string) => void } {
  const [toast, setToast] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(""), 3000);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { toast, notify };
}
