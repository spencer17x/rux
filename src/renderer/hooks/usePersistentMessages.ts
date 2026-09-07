import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { RuxApi } from "../../electron/preload";
import { loadLegacyMessages, persistentMessages, type MessageStore } from "../messages";
import { SnapshotWriter } from "../snapshot-writer";

export function usePersistentMessages(api: RuxApi, ready: boolean, onError: (message: string) => void): [MessageStore, Dispatch<SetStateAction<MessageStore>>] {
  const [messages, setMessages] = useState<MessageStore>(loadLegacyMessages);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const writer = useMemo(() => new SnapshotWriter<MessageStore>(async (value) => {
    // Traverse history only when a write is due, never for each streamed token.
    await api.messages.save(persistentMessages(value));
    localStorage.removeItem("rux.messages.v1");
  }, (error) => errorRef.current(error instanceof Error ? error.message : String(error))), [api]);
  useEffect(() => {
    if (ready) writer.schedule(messages);
  }, [messages, ready, writer]);
  useEffect(() => {
    const flush = () => { void writer.flush(); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [writer]);
  return [messages, setMessages];
}
