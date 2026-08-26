import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { RuxApi } from "../../electron/preload";
import { loadLegacyMessages, persistentMessages, type MessageStore } from "../messages";

export function usePersistentMessages(api: RuxApi, ready: boolean, onError: (message: string) => void): [MessageStore, Dispatch<SetStateAction<MessageStore>>] {
  const [messages, setMessages] = useState<MessageStore>(loadLegacyMessages);
  useEffect(() => {
    if (!ready) return undefined;
    const snapshot = persistentMessages(messages);
    const timer = window.setTimeout(() => {
      api.messages.save(snapshot).then(() => localStorage.removeItem("rux.messages.v1")).catch((error) => onError(error instanceof Error ? error.message : String(error)));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [api, messages, onError, ready]);
  return [messages, setMessages];
}
